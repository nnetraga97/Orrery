// A compiler-backed project model supplies both the galaxy graph and planet symbols. It can be kept and updated: an
// update with the changed paths re-analyzes only the files whose output can differ, reusing the previous program's
// unchanged source files, and produces the same result a full analysis would.
// Resolved imports outside the selected scope stay in metadata; they never become invented graph edges.
//
// What one file's output depends on, and so what re-analyzes it:
//   - its own text;
//   - how its imports resolve: every lookup location TypeScript tried (a new file can win over the old target) and
//     the target itself;
//   - the text of every file whose declarations its analysis resolved (call targets carry their file and line);
//   - which call targets are modeled callables anywhere in the project (unmodeled ones are demoted).
// Configuration, package manifests, declaration files and global scripts reach every file; changing one re-runs the
// whole analysis.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createAnalysisScope } from '../shared/scope.cjs';
import { contentHash, detailHash, fileRow } from './dataset-file.cjs';
import { analyzeSource, declarationId } from '../../source-model/code-model.js';
import { buildRegions } from '../../source-model/semantic-layout.js';

const require = createRequire(import.meta.url);
export const SOURCE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const OTHER_SOURCE_PATTERN =
  /\.(?:java|py|pyi|go|rs|rb|php|swift|kt|kts|scala|c|h|cpp|hpp|cc|cs|vue|svelte|astro|lua|dart|ex|exs|elm|clj|cljs|fs|fsx|sh|bash|zsh|sql|r|R|m|mm)$/;
const RESOLUTION_INPUT = /(^|\/)((ts|js)config[^/]*\.json|package\.json)$/;
const slash = value => value.split(path.sep).join('/');
const inside = (root, file) => {
  const rel = path.relative(root, file);
  return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};
const statFile = file => {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
};
const existsFile = file => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
// Paths in the order a sorted directory walk visits them.
const walkOrder = (a, b) => {
  const x = a.split(path.sep),
    y = b.split(path.sep);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].localeCompare(y[i]);
  return x.length - y.length;
};
const extensionFor = (ts, file) =>
  file.endsWith('.d.ts')
    ? ts.Extension.Dts
    : file.endsWith('.d.mts')
      ? ts.Extension.Dmts
      : file.endsWith('.d.cts')
        ? ts.Extension.Dcts
        : {
            '.ts': ts.Extension.Ts,
            '.tsx': ts.Extension.Tsx,
            '.js': ts.Extension.Js,
            '.jsx': ts.Extension.Jsx,
            '.mts': ts.Extension.Mts,
            '.cts': ts.Extension.Cts,
            '.mjs': ts.Extension.Mjs,
            '.cjs': ts.Extension.Cjs,
            '.json': ts.Extension.Json,
          }[path.extname(file)] || ts.Extension.Ts;

export function buildProjectModel(options = {}) {
  const model = createProjectModel(options);
  const { graph, symbols } = model.update(null);
  return { graph, symbols, scan: model.scan };
}

export function createProjectModel({
  root,
  scan = root,
  outDir,
  tsPath,
  tsconfigPath,
  moduleMapPath,
  symbols = true,
} = {}) {
  root = path.resolve(root);
  scan = path.resolve(scan);
  const ts = require(tsPath && tsPath !== '-' ? tsPath : 'typescript');
  const output = outDir && slash(path.relative(root, outDir));
  const scope = createAnalysisScope(root, { exclude: output && inside(root, outDir) ? ['/' + output + '/'] : [] });
  const relative = file => slash(path.relative(scan, file));
  const defaults = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
  };
  const diagnostic = d => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    ...(d.file
      ? { file: relative(d.file.fileName), line: d.file.getLineAndCharacterOfPosition(d.start || 0).line + 1 }
      : {}),
  });
  const explicitConfig = tsconfigPath && tsconfigPath !== '-' ? path.resolve(root, tsconfigPath) : null;
  const inScope = (file, isDirectory = false) =>
    inside(scan, file) && !scope.ignored(path.relative(root, file), isDirectory);

  // Everything one analysis knows, kept for the next update. A full analysis starts it afresh.
  let s = null;
  function fresh() {
    const files = [],
      otherFiles = [],
      packageFiles = [],
      configFiles = new Set();
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink() || scope.ignored(path.relative(root, file), entry.isDirectory())) continue;
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) {
          if (SOURCE_PATTERN.test(entry.name)) files.push(file);
          else if (OTHER_SOURCE_PATTERN.test(entry.name)) otherFiles.push(file);
          if (entry.name === 'package.json') packageFiles.push(file);
          if (entry.name === 'tsconfig.json' || entry.name === 'jsconfig.json') configFiles.add(file);
        }
      }
    }
    walk(scan);
    return {
      files: new Set(files),
      otherFiles: new Set(otherFiles),
      packageFiles,
      configFiles,
      configDiagnostics: [],
      configurations: new Map(),
      fileConfigurations: new Map(),
      packages: new Map(),
      explicitModules: {},
      resolutions: new Map(), // containingFile \0 specifier -> { result, file }
      // Lookup lists -> the resolutions that made them. TypeScript shares one list between cached resolutions, so
      // lists are kept by identity, never copied.
      lookups: new Map(),
      tsCaches: new Map(),
      sources: new Map(), // file -> { hash, sf }
      records: new Map(), // file -> what its analysis produced and depended on
      callables: new Set(),
      program: null,
      options: null,
    };
  }

  function readConfiguration(file) {
    if (!file) return { options: defaults, path: null };
    if (s.configurations.has(file)) return s.configurations.get(file);
    // TypeScript handles JSONC, extends, project-relative baseUrl and paths semantics.
    const parsed = ts.getParsedCommandLineOfConfigFile(
      file,
      { noEmit: true },
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => s.configDiagnostics.push(diagnostic(d)) },
    );
    const value = {
      path: file,
      options: { ...defaults, ...(parsed?.options || {}), allowJs: true, noEmit: true, skipLibCheck: true },
      references: (parsed?.projectReferences || []).map(r => r.path),
      extends: parsed?.options?.configFile?.extendedSourceFiles || [],
    };
    s.configDiagnostics.push(
      ...(parsed?.errors || []).filter(d => d.code !== 18003 && d.code !== 18002).map(diagnostic),
    );
    s.configurations.set(file, value);
    return value;
  }
  function configurationFor(file) {
    if (s.fileConfigurations.has(file)) return s.fileConfigurations.get(file);
    let candidate = explicitConfig;
    if (!candidate)
      for (let dir = path.dirname(file); inside(root, dir); dir = path.dirname(dir)) {
        candidate = ['tsconfig.json', 'jsconfig.json']
          .map(name => path.join(dir, name))
          .find(p => s.configFiles.has(p) || existsFile(p));
        if (candidate || dir === root) break;
      }
    const config = readConfiguration(candidate || s.parentConfig);
    s.fileConfigurations.set(file, config);
    return config;
  }
  function readPackages() {
    const { packageFiles, packages } = s;
    // Include the workspace package itself when scanning one of its source subdirectories.
    for (let dir = scan; inside(root, dir); dir = path.dirname(dir)) {
      const manifest = path.join(dir, 'package.json');
      if (existsFile(manifest) && !packageFiles.includes(manifest)) packageFiles.push(manifest);
      if (dir === root) break;
    }
    for (let i = 0; i < packageFiles.length; i++) {
      const manifest = packageFiles[i];
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')),
          directory = path.dirname(manifest);
        if (pkg.name) packages.set(pkg.name, { ...pkg, directory });
        // A subdirectory scan still knows about sibling workspace exports. Discovery
        // is limited to declared workspace globs, and targets stay outside the graph.
        const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || [];
        const patterns = workspaces.filter(pattern => typeof pattern === 'string');
        const includes = patterns
          .filter(pattern => !pattern.startsWith('!'))
          .map(pattern => pattern.replace(/\/$/, '') + '/package.json');
        const excludes = [
          '**/node_modules/**',
          '**/.git/**',
          ...patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1)),
        ];
        if (includes.length)
          for (const discovered of ts.sys.readDirectory(directory, ['.json'], excludes, includes)) {
            if (
              inside(root, discovered) &&
              !scope.ignored(path.relative(root, discovered)) &&
              !packageFiles.includes(discovered)
            )
              packageFiles.push(discovered);
          }
      } catch {
        /* An invalid manifest cannot prove a package target. TS diagnostics still cover imports. */
      }
    }
  }

  // ---------- module resolution, with the lookups each result depends on ----------
  let probes = null; // the lookup lists of the resolution in progress
  const probe = file => {
    probes?.[0].push(file);
    return existsFile(file);
  };
  function candidates(target) {
    const noJS = target.replace(/\.(?:mjs|cjs|jsx|js)$/, '');
    const ext = path.extname(target),
      replacements =
        ext === '.mjs'
          ? ['.mts', '.mjs']
          : ext === '.cjs'
            ? ['.cts', '.cjs']
            : ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
    // Source substitutions must precede emitted JS, matching TypeScript resolution.
    return [
      ...(ext && noJS !== target ? replacements.map(suffix => noJS + suffix) : []),
      target,
      ...replacements.flatMap(suffix => [noJS + suffix, path.join(target, 'index' + suffix)]),
    ];
  }
  function chooseExport(value, suffix = '') {
    if (typeof value === 'string') return [value.replaceAll('*', suffix)];
    if (Array.isArray(value)) return value.flatMap(v => chooseExport(v, suffix));
    if (!value || typeof value !== 'object') return [];
    return ['source', 'development', 'import', 'require', 'node', 'browser', 'default', 'types'].flatMap(key =>
      chooseExport(value[key], suffix),
    );
  }
  function workspaceModule(specifier) {
    const packageName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const pkg = s.packages.get(packageName);
    if (!pkg) return null;
    const subpath = specifier.slice(packageName.length),
      key = subpath ? '.' + subpath : '.';
    let targets = [];
    if (pkg.exports) {
      if (
        typeof pkg.exports === 'string' ||
        Array.isArray(pkg.exports) ||
        !Object.keys(pkg.exports).some(k => k.startsWith('.'))
      ) {
        if (key === '.') targets = chooseExport(pkg.exports);
      } else if (Object.hasOwn(pkg.exports, key)) targets = chooseExport(pkg.exports[key]);
      else
        for (const pattern of Object.keys(pkg.exports)
          .filter(k => k.includes('*'))
          .sort((a, b) => b.length - a.length)) {
          const [prefix, suffix] = pattern.split('*');
          if (key.startsWith(prefix) && key.endsWith(suffix)) {
            targets = chooseExport(
              pkg.exports[pattern],
              key.slice(prefix.length, key.length - suffix.length || undefined),
            );
            break;
          }
        }
    } else
      targets = subpath
        ? ['.' + subpath]
        : [pkg.source, pkg.module, pkg.main, pkg.types, pkg.typings, './index'].filter(Boolean);
    const hit = targets
      .filter(t => typeof t === 'string' && t.startsWith('.'))
      .flatMap(t => candidates(path.resolve(pkg.directory, t)))
      .find(probe);
    return { hit, packageName };
  }
  function resolveModule(specifier, containingFile) {
    containingFile = path.isAbsolute(containingFile || '')
      ? containingFile
      : path.resolve(scan, containingFile || 'index.ts');
    const key = containingFile + '\0' + specifier;
    const cached = s.resolutions.get(key);
    if (cached) return cached.result;
    probes = [[]]; // our own lookups, then TypeScript's
    const result = resolveUncached(specifier, containingFile);
    if (result.resolvedFileName) probes[0].push(result.resolvedFileName);
    s.resolutions.set(key, { result, file: containingFile, lists: probes });
    for (const list of probes) {
      if (!list.length) continue;
      if (!s.lookups.has(list)) s.lookups.set(list, new Set());
      s.lookups.get(list).add(key);
    }
    probes = null;
    return result;
  }
  function resolveUncached(specifier, containingFile) {
    let hit,
      external = false,
      via = 'typescript';
    if (Object.hasOwn(s.explicitModules, specifier)) {
      hit = path.resolve(scan, s.explicitModules[specifier]);
      via = 'module-map';
    }
    const config = configurationFor(containingFile),
      options = config.options;
    if (!hit) {
      let cache = s.tsCaches.get(config.path);
      if (!cache) {
        cache = ts.createModuleResolutionCache(root, value => value, options);
        s.tsCaches.set(config.path, cache);
      }
      const resolution = ts.resolveModuleName(specifier, containingFile, options, ts.sys, cache);
      if (resolution.failedLookupLocations) probes.push(resolution.failedLookupLocations);
      const resolved = resolution.resolvedModule;
      if (resolved) {
        hit = path.resolve(resolved.resolvedFileName);
        external = !!resolved.isExternalLibraryImport;
      }
    }
    const localPackage = workspaceModule(specifier);
    // A workspace package's source export can be used even without node_modules links.
    if (localPackage?.hit && (!hit || external)) {
      hit = localPackage.hit;
      external = false;
      via = 'workspace-package';
    }
    if (!hit && specifier.startsWith('.')) {
      hit = candidates(path.resolve(path.dirname(containingFile), specifier)).find(probe);
      via = 'source-path';
    }
    if (hit) {
      try {
        const real = fs.realpathSync(hit);
        if (s.files.has(real)) hit = real;
      } catch {}
    }
    const alias = Object.keys(options.paths || {}).some(pattern => {
      const [prefix, suffix = ''] = pattern.split('*');
      return pattern.includes('*') ? specifier.startsWith(prefix) && specifier.endsWith(suffix) : pattern === specifier;
    });
    const packageSpecifier =
      !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') && !alias && !localPackage;
    if (hit) {
      const status = s.files.has(hit)
        ? 'resolved'
        : external || hit.includes(`${path.sep}node_modules${path.sep}`) || specifier.startsWith('node:')
          ? 'external'
          : 'out-of-scope';
      return { file: relative(hit), resolvedFileName: hit, status, external: status === 'external', via };
    }
    return {
      file: specifier,
      status: packageSpecifier ? 'external' : 'unresolved',
      external: packageSpecifier,
      reason: packageSpecifier ? 'package-or-platform-module-not-in-project' : 'module-target-not-found',
      via,
    };
  }
  // Drops the resolutions that looked at (or found) any of these paths; returns the files that made them.
  function forgetResolutions(paths) {
    const files = new Set();
    if (!paths.size) return files;
    // TypeScript reports lookups with forward slashes.
    const wanted = new Set([...paths].flatMap(p => [p, slash(p)]));
    for (const [list, keys] of s.lookups) {
      if (!list.some(location => wanted.has(location))) continue;
      for (const key of keys) {
        const entry = s.resolutions.get(key);
        if (!entry) continue;
        s.resolutions.delete(key);
        files.add(entry.file);
        // The index forgets this resolution under every list it used.
        for (const other of entry.lists) {
          const users = s.lookups.get(other);
          users?.delete(key);
          if (users && !users.size) s.lookups.delete(other);
        }
      }
    }
    s.tsCaches.clear();
    return files;
  }

  // ---------- one file's analysis ----------
  function executableBinding(node) {
    if (ts.isFunctionLike(node)) return !!node.body;
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
      let value = node.initializer;
      while (
        value &&
        (ts.isParenthesizedExpression(value) ||
          ts.isAsExpression(value) ||
          ts.isSatisfiesExpression?.(value) ||
          ts.isNonNullExpression(value))
      )
        value = value.expression;
      if (!value) return false;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return true;
      // A wrapper is modeled only when it visibly receives an implementation.
      if (ts.isCallExpression(value))
        return value.arguments.some(
          argument =>
            executableBinding(argument) ||
            (ts.isCallExpression(argument) && argument.arguments.some(executableBinding)),
        );
    }
    return false;
  }
  function analyzeFile(file, checker) {
    const sf = s.program.getSourceFile(file),
      text = sf?.text ?? fs.readFileSync(file, 'utf8');
    const deps = new Set(),
      touch = source => deps.add(path.resolve(typeof source === 'string' ? source : source.fileName));
    const record = {
      hash: contentHash(text),
      loc: text.split('\n').filter(line => line.trim() && !/^\s*(\/\/|\*|\/\*)/.test(line)).length,
      references: [],
      targets: [],
      deps,
      parseDiagnostics: [],
      failure: null,
      model: null,
      callables: new Set(),
      calls: new Set(),
    };
    if (!sf) return record;
    record.parseDiagnostics = (sf.parseDiagnostics || []).map(diagnostic);
    const seen = new Set();
    function add(specifier, node, kind, typeOnly = false) {
      const resolution =
        typeof specifier === 'string'
          ? resolveModule(specifier, file)
          : { status: 'unresolved', reason: 'non-literal-module-specifier' };
      const { resolvedFileName, ...publicResolution } = resolution;
      record.references.push({
        specifier: specifier ?? null,
        kind,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        typeOnly,
        ...publicResolution,
      });
      if (resolvedFileName) deps.add(resolvedFileName);
      if (resolution.status === 'resolved' && resolvedFileName !== file && !seen.has(resolvedFileName)) {
        seen.add(resolvedFileName);
        record.targets.push(resolvedFileName);
      }
    }
    function moduleRequireBinding(declaration) {
      if (
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer ||
        !ts.isCallExpression(declaration.initializer)
      )
        return false;
      const expression = declaration.initializer.expression;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
      let symbol = checker.getSymbolAtLocation(name);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      return (symbol?.declarations || []).some(target => {
        touch(target.getSourceFile());
        return (
          target.name?.getText() === 'createRequire' &&
          /[\\/]@types[\\/]node[\\/]module\.d\.ts$/.test(target.getSourceFile().fileName)
        );
      });
    }
    function visit(node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause,
          named = clause?.namedBindings;
        const typeOnly =
          !!clause?.isTypeOnly ||
          (!clause?.name &&
            named &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every(element => element.isTypeOnly));
        add(node.moduleSpecifier.text, node, 'import', !!typeOnly);
        return;
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const named = node.exportClause;
        const typeOnly =
          !!node.isTypeOnly ||
          (named &&
            ts.isNamedExports(named) &&
            named.elements.length > 0 &&
            named.elements.every(element => element.isTypeOnly));
        add(node.moduleSpecifier.text, node, 'export', !!typeOnly);
        return;
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        add(node.moduleReference.expression?.text, node, 'import-equals', !!node.isTypeOnly);
        return;
      }
      if (ts.isImportTypeNode(node)) {
        const arg = node.argument;
        add(
          ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal) ? arg.literal.text : null,
          node,
          'type-import',
          true,
        );
        return;
      }
      if (ts.isCallExpression(node)) {
        const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        let requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        if (requireCall) {
          const symbol = checker.getSymbolAtLocation(node.expression);
          requireCall = !(symbol?.declarations || []).some(d => {
            touch(d.getSourceFile());
            return !d.getSourceFile().isDeclarationFile && !moduleRequireBinding(d);
          });
        }
        if (dynamic || requireCall) {
          const arg = node.arguments[0];
          add(arg && ts.isStringLiteralLike(arg) ? arg.text : null, node, dynamic ? 'dynamic-import' : 'require');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (!symbols) return record;
    const resolveDeclaration = original => {
      let node = original;
      touch(node.getSourceFile());
      if (ts.isFunctionLike(node) && !node.body && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        node = symbol?.declarations?.find(declaration => declaration.body) || node;
      }
      const target = node.getSourceFile(),
        filename = path.resolve(target.fileName),
        rel = relative(filename);
      touch(target);
      const known = s.files.has(filename),
        executable = executableBinding(node);
      return {
        file: rel,
        id: known && executable ? declarationId(ts, node, { file: rel, sourceFile: target }) : null,
        line: target.getLineAndCharacterOfPosition(node.getStart(target)).line + 1,
        start: target.getLineAndCharacterOfPosition(node.getStart(target)).line + 1,
        end: target.getLineAndCharacterOfPosition(node.end).line + 1,
        status: known
          ? executable
            ? 'resolved'
            : 'unresolved'
          : filename.includes(`${path.sep}node_modules${path.sep}`)
            ? 'external'
            : 'out-of-scope',
      };
    };
    let model;
    try {
      model = analyzeSource(ts, text, {
        file: relative(file),
        resolveModule: specifier => resolveModule(specifier, file),
        resolveDeclaration,
        checker,
        sourceFile: sf,
        fileOf: source => {
          touch(source);
          return relative(typeof source === 'string' ? source : source.fileName);
        },
      });
    } catch (error) {
      record.failure = { file: relative(file), category: 'analysis', message: error.message };
      model = {
        schemaVersion: 2,
        lines: text.split('\n').length,
        decls: [],
        calls: [],
        refs: {},
        analysis: { status: 'failed', diagnostics: [record.failure] },
      };
    }
    model.analysis = {
      ...model.analysis,
      project: true,
      config: configurationFor(file).path ? relative(configurationFor(file).path) : null,
      moduleReferences: record.references,
      parseDiagnostics: record.parseDiagnostics,
    };
    eachCallable(model, declaration => {
      record.callables.add(declaration.id);
      for (const call of declaration.callTargets || []) if (call.id) record.calls.add(call.id);
    });
    record.model = model;
    return record;
  }
  // What other files' analyses can observe of a file: its declarations (kind, name and line span, where call targets
  // point), its imports, exports and top-level statements, and the text type inference reads where no annotation
  // stands in for it (an unannotated function's body, an untyped initializer). An edit that leaves this unchanged,
  // such as a comment or a change inside an annotated function that keeps its lines, affects only the file itself.
  function surfaceOf(sf) {
    if (!sf) return null;
    const parts = [],
      positions = [];
    let global = false;
    const line = position => sf.getLineAndCharacterOfPosition(position).line;
    const text = node => (node ? node.getText(sf) : '');
    for (const statement of sf.statements) {
      if (
        ts.isModuleDeclaration(statement) &&
        (statement.flags & ts.NodeFlags.GlobalAugmentation || ts.isStringLiteral(statement.name))
      )
        global = true;
      if (
        !ts.isFunctionDeclaration(statement) &&
        !ts.isClassDeclaration(statement) &&
        !ts.isVariableStatement(statement)
      )
        parts.push('s', text(statement));
    }
    const visit = node => {
      let shape = null;
      if (ts.isFunctionLike(node))
        shape = node.type ? node.parameters.map(text).join(',') + ':' + text(node.type) : text(node);
      else if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node))
        shape = node.type ? text(node.type) : text(node.initializer);
      else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) shape = text(node);
      else if (
        ts.isClassLike(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)
      )
        shape = ts.isClassLike(node) ? text(node.name) + (node.heritageClauses || []).map(text).join() : text(node);
      if (shape != null) {
        parts.push(node.kind, node.name ? text(node.name) : '', shape);
        positions.push(line(node.getStart(sf)), line(node.end));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return { shape: contentHash(parts.join('\u0000')), positions: positions.join(','), global };
  }
  // Declarations with a flow (the modeled callables), nested members included.
  function eachCallable(model, fn) {
    const visit = declaration => {
      if (declaration.flow) fn(declaration);
      for (const member of declaration.members || []) visit(member);
    };
    model.decls.forEach(visit);
  }
  // Compiler declarations can be nested callbacks or signatures with no emitted town. Keep their binding evidence,
  // but only publish navigable IDs that exist.
  function finish(record) {
    const model = record.model;
    const records = [];
    eachCallable(model, declaration => records.push(declaration));
    for (const declaration of records)
      for (const call of declaration.callTargets || [])
        if (call.id && !s.callables.has(call.id)) {
          delete call.id;
          call.resolution = 'unresolved';
          call.binding = 'compiler';
          call.targetStatus = 'unmodeled-callable';
        }
    model.analysis.resolvedCalls = records.reduce(
      (n, declaration) => n + (declaration.callTargets || []).filter(call => call.resolution === 'resolved').length,
      0,
    );
    model.analysis.unresolvedCalls = records.reduce(
      (n, declaration) => n + (declaration.callTargets || []).filter(call => call.resolution !== 'resolved').length,
      0,
    );
    record.detail = detailHash(model);
    const regions = buildRegions(model, { file: record.rel });
    record.regions = regions.length;
    record.callableCount = regions.filter(region => region.kind !== 'file').length;
    record.refs = model.refs || null;
  }

  // ---------- updates ----------
  // `changes` is null for a full analysis, or { paths: [root-relative paths that changed on disk] }. Returns the
  // graph, the symbols of the files whose output may have changed (all of them after a full analysis), and how much
  // was redone.
  function update(changes) {
    const started = performance.now();
    let full = !s || !changes;
    const created = new Set(),
      deleted = new Set(),
      modified = new Set();
    if (!full)
      for (const rel of changes.paths) {
        const file = path.resolve(root, rel),
          name = path.basename(file);
        if (
          RESOLUTION_INPUT.test(slash(rel)) ||
          s.inputs?.has(file) ||
          name === '.gitignore' ||
          name === '.galaxyignore'
        ) {
          full = true;
          break;
        }
        const stat = statFile(file),
          isFile = !!stat?.isFile() && !stat.isSymbolicLink() && inScope(file);
        if (SOURCE_PATTERN.test(name)) {
          if (/\.d\.[cm]?ts$/.test(name)) {
            full = true;
            break;
          }
          if (isFile && !s.files.has(file)) created.add(file);
          else if (!isFile && s.files.has(file)) deleted.add(file);
          else if (isFile) modified.add(file);
        } else if (OTHER_SOURCE_PATTERN.test(name)) {
          if (isFile) s.otherFiles.add(file);
          else s.otherFiles.delete(file);
        }
      }
    // A global script's declarations are visible everywhere.
    for (const file of [...modified, ...deleted]) if (s?.records.get(file)?.global) full = true;
    if (full) {
      s = fresh();
      s.parentConfig =
        explicitConfig ||
        ts.findConfigFile(scan, ts.sys.fileExists, 'tsconfig.json') ||
        ts.findConfigFile(scan, ts.sys.fileExists, 'jsconfig.json');
      for (const file of s.files) configurationFor(file);
      s.explicitModules = moduleMapPath ? JSON.parse(fs.readFileSync(path.resolve(moduleMapPath), 'utf8')) : {};
      for (const [specifier, source] of Object.entries(s.explicitModules)) {
        if (typeof source !== 'string' || !s.files.has(path.resolve(scan, source)))
          throw new Error(`Module mapping ${specifier} is not an analyzed source file: ${source}`);
      }
      readPackages();
    } else {
      for (const file of created) s.files.add(file);
      for (const file of deleted) {
        if (surfaceOf(s.sources.get(file)?.sf)?.global) return update(null);
        s.files.delete(file);
        s.sources.delete(file);
        s.records.delete(file);
        s.fileConfigurations.delete(file);
      }
      // A new file under a configuration nothing used yet reorders the configurations: analyze afresh.
      const configured = s.configurations.size;
      for (const file of created) configurationFor(file);
      if (s.configurations.size !== configured) return update(null);
      // Unchanged text is not a change.
      for (const file of modified)
        if (s.sources.get(file)?.hash === contentHash(fs.readFileSync(file, 'utf8'))) modified.delete(file);
    }
    const files = [...s.files].sort(walkOrder);
    const options = configurationFor(files[0] || path.join(scan, 'index.ts')).options;
    if (s.options && options !== s.options) return update(null);
    s.options = options;

    // What to re-analyze: the changed files and those whose imports may now resolve differently...
    const redo = new Set(full ? files : [...created, ...modified]);
    if (!full)
      for (const file of forgetResolutions(new Set([...created, ...deleted]))) if (s.files.has(file)) redo.add(file);
    const invalidated = new Set(redo),
      reparse = new Set([...created, ...modified]);
    // ...and, below, those depending on a file whose surface changed. What the old text showed other files:
    const surfaces = new Map([...modified].map(file => [file, surfaceOf(s.sources.get(file)?.sf)]));
    // Global augmentations and ambient modules reach every file.
    if ([...surfaces.values()].some(surface => surface?.global)) return update(null);

    // The program, reusing every unchanged source file of the previous one.
    const host = ts.createCompilerHost(options, true);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      // Library and out-of-scope files never change here; project files are reparsed only when their text did.
      const file = path.resolve(fileName),
        kept = s.sources.get(file);
      if (kept && !reparse.has(file)) return kept.sf;
      const sf = getSourceFile(fileName, languageVersion, onError, shouldCreate);
      if (sf) s.sources.set(file, { hash: s.files.has(file) ? contentHash(sf.text) : null, sf });
      return sf;
    };
    host.resolveModuleNames = (names, containingFile) =>
      names.map(name => {
        const resolution = resolveModule(name, containingFile);
        return resolution.resolvedFileName
          ? {
              resolvedFileName: resolution.resolvedFileName,
              extension: extensionFor(ts, resolution.resolvedFileName),
              isExternalLibraryImport: resolution.external,
            }
          : undefined;
      });
    host.hasInvalidatedResolutions = fileName => invalidated.has(path.resolve(fileName));
    s.program = ts.createProgram({ rootNames: files, options, host, oldProgram: full ? undefined : s.program });
    const checker = s.program.getTypeChecker();
    // A changed file that turned into a global script, or a new one, reaches every file.
    if (!full)
      for (const file of [...created, ...modified]) {
        const sf = s.program.getSourceFile(file);
        if (sf && !sf.externalModuleIndicator && !sf.commonJsModuleIndicator && !/\.json$/.test(file))
          return update(null);
      }
    if (!full) {
      // A changed position (a declaration's lines) reaches the files that resolved into this one. A changed shape
      // also reaches, through types, every file that imports it directly or indirectly, and whoever resolved into
      // those.
      const moved = new Set([...deleted, ...created]),
        reshaped = new Set(moved);
      for (const file of modified) {
        const now = surfaceOf(s.program.getSourceFile(file)),
          was = surfaces.get(file);
        if (now?.global) return update(null);
        if (now?.shape !== was?.shape) reshaped.add(file);
        if (now?.shape !== was?.shape || now?.positions !== was?.positions) moved.add(file);
      }
      const importers = new Map();
      for (const [file, record] of s.records)
        for (const target of record.targets) {
          if (!importers.has(target)) importers.set(target, []);
          importers.get(target).push(file);
        }
      const affected = new Set(moved),
        queue = [...reshaped];
      for (const file of queue) {
        affected.add(file);
        for (const importer of importers.get(file) || [])
          if (!reshaped.has(importer)) {
            reshaped.add(importer);
            queue.push(importer);
          }
      }
      for (const [file, record] of s.records)
        if (!redo.has(file) && [...record.deps].some(dep => affected.has(dep))) redo.add(file);
    }

    for (const file of redo) {
      const record = analyzeFile(file, checker);
      const sf = s.program.getSourceFile(file);
      record.rel = relative(file);
      record.global = !!sf && !sf.externalModuleIndicator && !sf.commonJsModuleIndicator;
      s.records.set(file, record);
    }
    // Callables that appeared or disappeared change the calls into them.
    const callables = new Set();
    for (const record of s.records.values()) for (const id of record.callables) callables.add(id);
    if (!full) {
      const flipped = new Set();
      for (const id of callables) if (!s.callables.has(id)) flipped.add(id);
      for (const id of s.callables) if (!callables.has(id)) flipped.add(id);
      if (flipped.size)
        for (const [file, record] of s.records)
          if (!redo.has(file) && [...record.calls].some(id => flipped.has(id))) {
            redo.add(file);
            const again = analyzeFile(file, checker);
            again.rel = record.rel;
            again.global = record.global;
            s.records.set(file, again);
          }
    }
    s.callables = callables;
    const outputSymbols = {};
    for (const file of redo) {
      const record = s.records.get(file);
      if (symbols) {
        finish(record);
        outputSymbols[record.rel] = record.model;
      }
      record.model = null; // detail lives in the caller's output, not here
    }

    // The graph, from every file's record.
    const index = new Map(files.map((file, i) => [file, i]));
    const rows = [],
      edges = [],
      allReferences = [],
      parseDiagnostics = [],
      analysisFailures = [];
    for (const file of files) {
      const record = s.records.get(file);
      const row = fileRow(record.rel, record.loc, record.hash);
      row[4] = record.detail ?? null;
      row[5] = record.regions ?? null;
      row[6] = record.callableCount ?? null;
      rows.push(row);
      parseDiagnostics.push(...record.parseDiagnostics);
      if (record.failure) analysisFailures.push(record.failure);
      for (const ref of record.references) allReferences.push({ from: record.rel, ...ref });
      for (const target of record.targets) {
        const t = index.get(target);
        if (t == null) continue;
        const refs = record.refs;
        if (!refs) edges.push([index.get(file), t]);
        else {
          const [runtime = 0, types = 0, reexports = 0] = refs[relative(target)] || [];
          edges.push([index.get(file), t, runtime, types, reexports]);
        }
      }
    }
    for (const [, target] of edges) rows[target][2]++;
    const unsupportedExtensions = {};
    const otherFiles = [...s.otherFiles].sort(walkOrder);
    for (const file of otherFiles) {
      const ext = path.extname(file).toLowerCase();
      unsupportedExtensions[ext] = (unsupportedExtensions[ext] || 0) + 1;
    }
    const inputs = [
      ...new Set(
        [...s.configurations.values()]
          .flatMap(c => (c.path ? [c.path, ...c.extends] : []))
          .concat(s.packageFiles)
          .map(file => slash(path.relative(root, file)))
          .filter(rel => rel && !rel.startsWith('..') && !path.isAbsolute(rel)),
      ),
    ].sort();
    s.inputs = new Set(inputs.map(rel => path.resolve(root, rel)));
    const analysis = {
      schemaVersion: 2,
      engine: 'typescript-project',
      supportedLanguages: ['JavaScript', 'TypeScript', 'JSX', 'TSX'],
      coverage: {
        analyzedFiles: files.length - analysisFailures.length,
        supportedFiles: files.length,
        failedFiles: analysisFailures.map(f => f.file),
        unsupportedFiles: otherFiles.map(relative),
        unsupportedExtensions,
        declarationFiles: files.filter(file => /\.d\.[cm]?ts$/.test(file)).length,
      },
      configurations: [...s.configurations.values()].map(c => ({
        file: relative(c.path),
        references: c.references.map(relative),
      })),
      // Non-source files this result depends on: saving one of them must re-run the analysis.
      inputs,
      configDiagnostics: s.configDiagnostics,
      parseDiagnostics,
      analysisFailures,
      references: allReferences,
      unresolvedReferences: allReferences.filter(ref => ref.status === 'unresolved'),
      externalReferences: allReferences.filter(ref => ref.status === 'external'),
      outOfScopeReferences: allReferences.filter(ref => ref.status === 'out-of-scope'),
    };
    return {
      graph: { f: rows, e: edges, analysis },
      symbols: outputSymbols,
      full,
      stats: { files: files.length, reanalyzed: redo.size, ms: Math.round(performance.now() - started) },
    };
  }
  return { update, scan };
}
