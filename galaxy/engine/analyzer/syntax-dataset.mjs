// Tree-sitter front end for the languages in source-model/languages.js with frontEnd 'syntax' (Python, Go, Rust,
// C, C++, C#, Ruby, PHP, Kotlin, Scala, Lua): scans a root into the viewer's graph and symbol formats.
// Edges come only from evidence in the source, resolved to files inside the root:
//   file imports  — Python/Rust modules, C includes, Ruby/PHP/Lua requires
//   name lookups  — Go package members, and type names through C#/Kotlin/Scala/PHP namespaces and imports
// Anything that resolves outside the root (standard libraries, packages) is dropped, like node_modules for TypeScript.
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, languageOf } from '../../source-model/languages.js';
import { createSyntaxParser, syntaxSymbols } from '../../source-model/syntax.js';
import { createAnalysisScope } from '../shared/scope.cjs';
import { contentHash, fileRow } from './dataset-file.cjs';
import { sealOverview } from './overview.mjs';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const named = n => (n ? n.namedChildren.filter(c => !/comment/.test(c.type)) : []);
const field = (n, name) => n?.childForFieldName(name) || null;
const unquote = text => String(text || '').replace(/^[rbuf]*["'`<]+|["'`>]+$/gi, '');
const stringIn = n => {
  let found = null;
  (function visit(x) {
    if (found) return;
    if (/string_content|string_fragment|string_value/.test(x.type)) found = x.text;
    else if (/^(string|string_literal|interpreted_string_literal|encapsed_string)$/.test(x.type) && !x.namedChildCount)
      found = unquote(x.text);
    for (const c of x.namedChildren) visit(c);
  })(n);
  return found;
};
// The last string literal of an expression, so `__DIR__ . '/util.php'` yields '/util.php'.
const lastString = n => {
  let found = null;
  (function visit(x) {
    if (/^(string|encapsed_string)$/.test(x.type)) found = stringIn(x) ?? unquote(x.text);
    else for (const c of x.namedChildren) visit(c);
  })(n);
  return found;
};
// Ruby reopens core classes freely (pp.rb adds to Array, Hash and String); reopening is not owning, so these
// names never resolve to a project file.
const RUBY_CORE = new Set(
  (
    'Object BasicObject Kernel Module Class Comparable Enumerable Enumerator Array Hash String Symbol Integer Float ' +
    'Numeric Rational Complex Range Regexp MatchData Struct Time Dir File IO ENV Exception StandardError ' +
    'RuntimeError ArgumentError TypeError NameError NoMethodError NotImplementedError KeyError IndexError ' +
    'StopIteration Proc Method UnboundMethod Thread Mutex Queue Process Signal GC ObjectSpace Math Marshal ' +
    'Random Encoding NilClass TrueClass FalseClass Fiber Binding Data Set'
  ).split(' '),
);
const nonBlankLines = (text, comment) => text.split('\n').filter(l => l.trim() && !comment.test(l)).length;
const COMMENT_LINE = {
  python: /^\s*#/,
  ruby: /^\s*#/,
  lua: /^\s*--/,
};

// ---------- what each file declares and imports ----------
function header(tree, id) {
  const root = tree.rootNode,
    imports = [];
  let pkg = '';
  const walk = (n, visit) => {
    visit(n);
    for (const c of n.namedChildren) walk(c, visit);
  };
  switch (id) {
    case 'python':
      // Imports anywhere count, including inside functions and `if TYPE_CHECKING:` blocks.
      walk(root, c => {
        if (c.type === 'import_statement')
          for (const name of c.childrenForFieldName('name')) {
            const dotted = name.type === 'aliased_import' ? field(name, 'name') : name;
            const alias = name.type === 'aliased_import' ? field(name, 'alias')?.text : dotted.text.split('.')[0];
            imports.push({ module: dotted.text, alias });
          }
        else if (c.type === 'import_from_statement') {
          const module = field(c, 'module_name');
          const level = module?.type === 'relative_import' ? (module.text.match(/^\.+/) || [''])[0].length : 0;
          const dotted = module?.type === 'relative_import' ? module.text.replace(/^\.+/, '') : module?.text || '';
          const names = c
            .childrenForFieldName('name')
            .map(n =>
              n.type === 'aliased_import'
                ? { name: field(n, 'name').text, alias: field(n, 'alias').text }
                : { name: n.text, alias: n.text },
            );
          imports.push({ module: dotted, level, names });
        }
      });
      break;
    case 'go':
      pkg = root.namedChildren.find(c => c.type === 'package_clause')?.namedChildren[0]?.text || '';
      walk(root, n => {
        if (n.type === 'import_spec')
          imports.push({ path: unquote(field(n, 'path')?.text), alias: field(n, 'name')?.text || null });
      });
      break;
    case 'rust':
      walk(root, n => {
        if (n.type === 'mod_item' && !field(n, 'body')) imports.push({ mod: field(n, 'name').text, node: n });
        else if (n.type === 'use_declaration') {
          const text = field(n, 'argument')?.text || '';
          const [base, list] = text.split(/::\{/);
          const names = list
            ? list
                .replace(/[{}\s]/g, '')
                .split(',')
                .filter(Boolean)
            : [];
          imports.push({ use: base.replace(/\s+as\s+\w+$/, ''), names: names.map(n => n.replace(/\s*as\s+\w+$/, '')) });
        }
      });
      break;
    case 'c':
    case 'cpp':
      walk(root, n => {
        if (n.type === 'preproc_include') {
          const p = field(n, 'path');
          if (p) imports.push({ include: unquote(p.text), system: p.type === 'system_lib_string' });
        }
      });
      break;
    case 'csharp':
      walk(root, n => {
        if (n.type === 'using_directive') {
          const target = named(n).at(-1);
          if (target && !n.children.some(c => c.type === '='))
            imports.push({ namespace: target.text, static: /\bstatic\b/.test(n.text) });
        } else if ((n.type === 'namespace_declaration' || n.type === 'file_scoped_namespace_declaration') && !pkg)
          pkg = field(n, 'name')?.text || '';
      });
      break;
    case 'ruby':
      walk(root, n => {
        if (n.type === 'call' && !field(n, 'receiver')) {
          const method = field(n, 'method')?.text;
          if (['require', 'require_relative', 'load', 'autoload'].includes(method)) {
            const arg = stringIn(field(n, 'arguments') || n);
            if (arg) imports.push({ require: arg, relative: method === 'require_relative' });
          }
        }
      });
      break;
    case 'php':
      walk(root, n => {
        if (n.type === 'namespace_definition' && !pkg) pkg = field(n, 'name')?.text || '';
        else if (n.type === 'namespace_use_clause') {
          const name = named(n).find(c => /name/.test(c.type));
          if (name) imports.push({ use: name.text.replace(/^\\/, '') });
        } else if (/^(require|require_once|include|include_once)_expression$/.test(n.type)) {
          const arg = lastString(n);
          if (arg) imports.push({ require: arg, relative: true });
        }
      });
      break;
    case 'kotlin':
      for (const c of root.namedChildren) {
        if (c.type === 'package_header') pkg = named(c)[0]?.text || '';
        else if (c.type === 'import' || c.type === 'import_header') {
          const name = named(c).find(x => /identifier/.test(x.type))?.text;
          if (name) imports.push({ use: name, wildcard: /\.\*\s*$/.test(c.text) });
        }
      }
      break;
    case 'scala':
      walk(root, n => {
        if (n.type === 'package_clause' && !pkg) pkg = field(n, 'name')?.text || '';
        else if (n.type === 'import_declaration') {
          const parts = n.childrenForFieldName('path').map(p => p.text);
          const selectors = n.namedChildren.find(c => c.type === 'namespace_selectors');
          if (n.namedChildren.some(c => c.type === 'namespace_wildcard'))
            imports.push({ use: parts.join('.'), wildcard: true });
          else if (selectors)
            named(selectors).forEach(s => imports.push({ use: parts.concat(named(s)[0]?.text || s.text).join('.') }));
          else imports.push({ use: parts.join('.') });
        }
      });
      break;
    case 'lua':
      walk(root, n => {
        if (n.type === 'function_call' && field(n, 'name')?.text === 'require') {
          const arg = stringIn(field(n, 'arguments') || n);
          if (arg) imports.push({ require: arg });
        }
      });
      break;
  }
  return { pkg, imports };
}

// ---------- the dataset ----------
export async function buildSyntaxDataset(root, { symbols = false, scope = null } = {}) {
  scope ||= createAnalysisScope(root);
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink() || scope.ignored(path.relative(scope.root, p), e.isDirectory())) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && languageOf(e.name)?.frontEnd === 'syntax' && fs.statSync(p).size <= MAX_FILE_BYTES)
        files.push(p);
    }
  })(root);
  files.sort();
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const rels = files.map(rel);
  // C++ projects write their headers as .h too; the C++ grammar also reads plain C.
  const hasCpp = rels.some(r => languageOf(r).id === 'cpp');
  const lang = rels.map(r => (hasCpp && languageOf(r).id === 'c' && r.endsWith('.h') ? 'cpp' : languageOf(r).id));
  const parsers = new Map();
  const parserFor = async id => {
    if (!parsers.has(id)) parsers.set(id, await createSyntaxParser(id));
    return parsers.get(id);
  };

  // Pass 1: what each file declares and imports. Parsing failures leave the file as an unanalysed planet.
  const info = [];
  const failures = [];
  for (let i = 0; i < files.length; i++) {
    const text = fs.readFileSync(files[i], 'utf8');
    try {
      const tree = (await parserFor(lang[i])).parse(text);
      const h = header(tree, lang[i]);
      const s = syntaxSymbols(tree, lang[i]);
      const types = new Set();
      (function collect(decls) {
        for (const d of decls) if (d.kind !== 'function') types.add(d.name.split('.').pop());
      })(s.decls);
      const functions = new Set(s.decls.filter(d => d.kind === 'function').map(d => d.name));
      tree.delete();
      info.push({
        ...h,
        types,
        functions,
        loc: nonBlankLines(text, COMMENT_LINE[lang[i]] || /^\s*(\/\/|\/?\*)/),
        hash: contentHash(text),
      });
    } catch (error) {
      failures.push({ file: rels[i], message: error.message });
      info.push({
        pkg: '',
        imports: [],
        types: new Set(),
        functions: new Set(),
        loc: text.split('\n').length,
        hash: contentHash(text),
      });
    }
  }

  // Indexes: by path and path suffix (for module and include lookups), by directory, and declared names.
  const byRel = new Map(rels.map((r, i) => [r, i]));
  const suffixes = new Map();
  // Paths are also indexed under the root folder's own name, so a package opened as the root (pip/) still
  // resolves imports that name it (pip._internal.utils).
  const rootName = path.basename(root);
  rels.forEach((r, i) => {
    const parts = [rootName, ...r.split('/')];
    for (let k = 0; k < parts.length; k++) {
      const key = parts.slice(k).join('/');
      if (!suffixes.has(key)) suffixes.set(key, []);
      suffixes.get(key).push(i);
    }
  });
  const dirOf = i => path.posix.dirname(rels[i]);
  // The candidate nearest to the importing file: shared directory prefix, then the shortest path.
  const nearest = (from, candidates) => {
    if (!candidates?.length) return null;
    const here = dirOf(from).split('/');
    const score = j => {
      const there = rels[j].split('/');
      let k = 0;
      while (k < here.length && here[k] === there[k]) k++;
      return k * 1000 - there.length;
    };
    return candidates.filter(j => j !== from).sort((a, b) => score(b) - score(a))[0] ?? null;
  };
  const bySuffix = (from, suffix) => nearest(from, suffixes.get(suffix.replace(/^\/+/, '')));
  const inRoot = p => {
    const n = path.posix.normalize(p);
    return n.startsWith('../') ? null : n;
  };
  const tryPaths = (from, list) => {
    for (const p of list) {
      const n = p && inRoot(p);
      if (n && byRel.has(n) && byRel.get(n) !== from) return byRel.get(n);
    }
    return null;
  };
  const types = new Map(), // language → simple type name → [files]
    qualified = new Map(), // language → package.Type → file
    packageFiles = new Map(); // language → package → [files]
  info.forEach((h, i) => {
    const l = lang[i];
    if (!types.has(l)) (types.set(l, new Map()), qualified.set(l, new Map()), packageFiles.set(l, new Map()));
    for (const t of h.types) {
      if (!types.get(l).has(t)) types.get(l).set(t, []);
      types.get(l).get(t).push(i);
      qualified.get(l).set(h.pkg ? h.pkg.replace(/\\/g, '.') + '.' + t : t, i);
    }
    if (l === 'kotlin' || l === 'scala')
      for (const f of h.functions) qualified.get(l).set(h.pkg ? h.pkg + '.' + f : f, i);
    const key = l === 'go' ? dirOf(i) + '|' + h.pkg : h.pkg.replace(/\\/g, '.');
    if (!packageFiles.get(l).has(key)) packageFiles.get(l).set(key, []);
    packageFiles.get(l).get(key).push(i);
  });
  const uniqueType = (l, name) => {
    const hits = types.get(l)?.get(name);
    return hits?.length === 1 ? hits[0] : null;
  };

  // Go module paths, so `example.com/m/util` finds the util directory under that go.mod.
  const goModules = [];
  (function findGoMods(dir) {
    const mod = path.join(dir, 'go.mod');
    if (fs.existsSync(mod)) {
      const name = fs.readFileSync(mod, 'utf8').match(/^module\s+(\S+)/m)?.[1];
      if (name) goModules.push({ name, dir: path.relative(root, dir).split(path.sep).join('/') });
    }
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
      if (
        e.isDirectory() &&
        !e.isSymbolicLink() &&
        !scope.ignored(path.relative(scope.root, path.join(dir, e.name)), true)
      )
        findGoMods(path.join(dir, e.name));
  })(root);

  // Rust: a crate's root directory is the one holding lib.rs or main.rs above the file.
  const crateRoot = i => {
    for (let d = dirOf(i); ; d = path.posix.dirname(d)) {
      if (['lib.rs', 'main.rs'].some(f => byRel.has(d === '.' ? f : d + '/' + f))) return d;
      if (d === '.' || d === '/' || !d) return null;
    }
  };
  // The directory a Rust module's children live in: x.rs → x/, mod.rs/lib.rs/main.rs → their own directory.
  const rustChildDir = i => {
    const base = path.posix.basename(rels[i]);
    return ['mod.rs', 'lib.rs', 'main.rs'].includes(base) ? dirOf(i) : rels[i].replace(/\.rs$/, '');
  };
  const rustModule = (dir, segments) => {
    let target = null;
    for (let k = 1; k <= segments.length; k++) {
      const p = [dir, ...segments.slice(0, k)].filter(x => x && x !== '.').join('/');
      const hit = tryPaths(-1, [p + '.rs', p + '/mod.rs']);
      if (hit != null) target = hit;
      else if (target != null) break;
    }
    return target;
  };

  let unresolvedImports = 0;
  const resolvers = info.map((h, i) => {
    const l = lang[i],
      explicit = new Set(),
      names = new Map(),
      namespaces = [h.pkg.replace(/\\/g, '.')];
    let found = false;
    const add = (target, alias) => {
      if (target == null || target === i) return;
      found = true;
      explicit.add(target);
      if (alias) names.set(alias, target);
    };
    for (const imp of h.imports) {
      let target = null;
      found = false;
      switch (l) {
        case 'python': {
          const base = imp.level ? path.posix.join(dirOf(i), ...Array(imp.level - 1).fill('..')) : null;
          const moduleFile = dotted => {
            const p = dotted.replace(/\./g, '/');
            if (base != null)
              return tryPaths(i, [
                path.posix.join(base, p + '.py'),
                path.posix.join(base, p, '__init__.py'),
                path.posix.join(base, p + '.pyi'),
              ]);
            return p ? (bySuffix(i, p + '.py') ?? bySuffix(i, p + '/__init__.py') ?? bySuffix(i, p + '.pyi')) : null;
          };
          if (imp.names) {
            const own = imp.module || base != null ? moduleFile(imp.module) : null;
            for (const n of imp.names) add(moduleFile([imp.module, n.name].filter(Boolean).join('.')) ?? own, n.alias);
            if (!imp.names.length) add(own);
          } else {
            target = moduleFile(imp.module);
            add(target, imp.alias);
          }
          break;
        }
        case 'go': {
          const mod = goModules
            .filter(m => imp.path === m.name || imp.path.startsWith(m.name + '/'))
            .sort((a, b) => b.name.length - a.name.length)[0];
          if (mod) {
            const dir = [mod.dir, imp.path.slice(mod.name.length + 1)].filter(Boolean).join('/') || '.';
            const pkgFiles = [...packageFiles.get('go').entries()]
              .filter(([k]) => k.split('|')[0] === dir)
              .flatMap(([, f]) => f);
            if (pkgFiles.length) {
              found = true;
              names.set(imp.alias || imp.path.split('/').pop(), { package: pkgFiles });
            }
          }
          break;
        }
        case 'rust': {
          if (imp.mod) {
            const dir = rustChildDir(i);
            target = tryPaths(i, [dir + '/' + imp.mod + '.rs', dir + '/' + imp.mod + '/mod.rs']);
            add(target, imp.mod);
          } else {
            const segments = imp.use.split('::').filter(Boolean);
            let dir = null;
            if (segments[0] === 'crate') ((dir = crateRoot(i)), segments.shift());
            else if (segments[0] === 'self') ((dir = rustChildDir(i)), segments.shift());
            else if (segments[0] === 'super') {
              dir = path.posix.basename(rels[i]) === 'mod.rs' ? path.posix.dirname(dirOf(i)) : dirOf(i);
              segments.shift();
              while (segments[0] === 'super') ((dir = path.posix.dirname(dir)), segments.shift());
            } else dir = crateRoot(i); // 2018 paths name the crate's own modules directly
            if (dir != null) target = rustModule(dir, segments);
            add(target, segments.at(-1));
            for (const n of imp.names) if (target != null) names.set(n, target);
          }
          break;
        }
        case 'c':
        case 'cpp':
          target = imp.system
            ? bySuffix(i, imp.include)
            : (tryPaths(i, [path.posix.join(dirOf(i), imp.include)]) ?? bySuffix(i, imp.include));
          add(target);
          break;
        case 'csharp':
          namespaces.push(imp.namespace);
          found = packageFiles.get(l).has(imp.namespace);
          break;
        case 'kotlin':
        case 'scala':
          if (imp.wildcard) {
            namespaces.push(imp.use);
            found = packageFiles.get(l).has(imp.use);
          } else {
            const parts = imp.use.split('.');
            for (let k = parts.length; k > 0 && target == null; k--)
              target = qualified.get(l).get(parts.slice(0, k).join('.')) ?? null;
            add(target, parts.at(-1));
          }
          break;
        case 'php':
          if (imp.use) {
            const fq = imp.use.replace(/\\/g, '.');
            target = qualified.get('php').get(fq) ?? null;
            add(target, fq.split('.').pop());
          } else {
            const p = imp.require.replace(/^\/+/, '');
            target = tryPaths(i, [path.posix.join(dirOf(i), p)]) ?? bySuffix(i, p);
            add(target);
          }
          break;
        case 'ruby': {
          const p = imp.require.replace(/\.rb$/, '') + '.rb';
          target = imp.relative ? tryPaths(i, [path.posix.join(dirOf(i), p)]) : bySuffix(i, p);
          add(target);
          break;
        }
        case 'lua': {
          const p = imp.require.replace(/\./g, '/');
          target = bySuffix(i, p + '.lua') ?? bySuffix(i, p + '/init.lua');
          add(target);
          break;
        }
      }
      // Imports of standard libraries and packages are expected not to resolve inside the root.
      if (!found) unresolvedImports++;
    }
    const samePackage =
      l === 'go'
        ? packageFiles.get('go').get(dirOf(i) + '|' + h.pkg) || []
        : ['csharp', 'kotlin', 'scala', 'php'].includes(l)
          ? namespaces.flatMap(ns => packageFiles.get(l).get(ns) || [])
          : [];
    const memberOf = (list, name) =>
      list.find(j => j !== i && (info[j].types.has(name) || info[j].functions.has(name))) ?? null;
    const resolve = name => {
      if (h.types.has(name) || h.functions.has(name)) return null;
      const alias = names.get(name);
      if (typeof alias === 'number') return alias;
      if (alias?.package) return null; // a Go package name; its members resolve below
      if (l === 'go') {
        const own = memberOf(samePackage, name);
        if (own != null) return own;
        for (const v of names.values())
          if (v?.package) {
            const hit = memberOf(v.package, name);
            if (hit != null) return hit;
          }
        return null;
      }
      if (['python', 'rust', 'c', 'cpp', 'lua'].includes(l)) return memberOf([...explicit], name);
      // Namespaced and Ruby constant lookups: imports and namespaces first, then a type declared only once.
      if (!/^[A-Z]/.test(name) || (l === 'ruby' && RUBY_CORE.has(name))) return null;
      return memberOf(samePackage, name) ?? memberOf([...explicit], name) ?? uniqueType(l, name);
    };
    return { resolve, explicit };
  });

  const rows = rels.map((r, i) => fileRow(r, info[i].loc, info[i].hash)),
    edges = [],
    out = {};
  for (let i = 0; i < files.length; i++) {
    const targets = new Set(resolvers[i].explicit);
    let fileSymbols = null;
    try {
      const text = fs.readFileSync(files[i], 'utf8');
      const tree = (await parserFor(lang[i])).parse(text);
      const s = syntaxSymbols(tree, lang[i], {
        resolve: name => {
          const t = resolvers[i].resolve(name);
          return t == null || t === i ? null : rels[t];
        },
      });
      tree.delete();
      for (const r of Object.keys(s.refs)) targets.add(byRel.get(r));
      fileSymbols = { lines: text.split('\n').length, language: lang[i], decls: s.decls, calls: s.calls, refs: s.refs };
    } catch {
      fileSymbols = null;
    }
    targets.delete(i);
    for (const t of targets) {
      edges.push([i, t]);
      rows[t][2]++;
    }
    if (symbols && fileSymbols) out[rels[i]] = fileSymbols;
  }
  const byLanguage = {};
  lang.forEach(l => (byLanguage[l] = (byLanguage[l] || 0) + 1));
  return {
    ...sealOverview(rows, edges, out),
    symbols: out,
    languages: LANGUAGES.filter(l => byLanguage[l.id]).map(l => l.label),
    stats: { files: files.length, byLanguage, unresolvedImports, failures },
  };
}
