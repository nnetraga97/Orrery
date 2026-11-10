// Java front end for analyze.mjs / symbols.mjs: scan source roots into the viewer's graph + symbol formats.
// Types in one package reference each other without imports, so edges come from a package → type table:
//   explicit imports and static imports (always an edge), same-package mentions, and wildcard-import mentions.
// Types outside the scanned roots (JDK, third-party) are dropped, like node_modules for TypeScript.
import fs from 'node:fs';
import path from 'node:path';
import { createJavaParser, javaHeader, javaSymbols } from '../../source-model/java.js';
import { createAnalysisScope } from '../shared/scope.cjs';
import { contentHash, fileRow } from './dataset-file.cjs';
import { sealOverview } from './overview.mjs';

const SKIP_FILE = new Set(['package-info.java', 'module-info.java']);

function commonAncestor(dirs) {
  const parts = dirs.map(d => d.split(path.sep));
  let n = 0;
  while (parts.every(p => p[n] !== undefined && p[n] === parts[0][n]) && n < parts[0].length) n++;
  return parts[0].slice(0, n).join(path.sep) || path.sep;
}

// roots: source directories (absolute); returns rows/edges (graph) and, when asked, per-file symbols.
export async function buildJavaDataset(roots, { symbols = false, scope = null } = {}) {
  const scan = roots.length === 1 ? roots[0] : commonAncestor(roots);
  scope ||= createAnalysisScope(scan);
  const files = [];
  for (const root of roots)
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink() || scope.ignored(path.relative(scope.root, p), e.isDirectory())) continue;
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.java') && !SKIP_FILE.has(e.name)) files.push(p);
      }
    })(root);
  files.sort();
  const rel = f => path.relative(scan, f).split(path.sep).join('/');
  const jp = await createJavaParser();

  // Pass 1: what each file declares and mentions.
  const headers = files.map(f => {
    const text = fs.readFileSync(f, 'utf8'),
      tree = jp.parse(text),
      h = javaHeader(tree);
    tree.delete();
    return {
      ...h,
      loc: text.split('\n').filter(l => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length,
      hash: contentHash(text),
    };
  });
  const fqnToFile = new Map(),
    pkgTypes = new Map();
  let duplicateTypes = 0;
  headers.forEach((h, i) =>
    h.types.forEach(t => {
      fqnToFile.set(h.pkg ? h.pkg + '.' + t : t, i);
      if (!pkgTypes.has(h.pkg)) pkgTypes.set(h.pkg, new Map());
      if (pkgTypes.get(h.pkg).has(t)) duplicateTypes++;
      else pkgTypes.get(h.pkg).set(t, i);
    }),
  );
  // a.b.Outer.Inner and a.b.Outer.member both resolve to Outer's file by dropping trailing segments.
  const fileOfFqn = fqn => {
    for (let p = fqn.split('.'); p.length; p.pop()) {
      const hit = fqnToFile.get(p.join('.'));
      if (hit != null) return hit;
    }
    return null;
  };

  let ambiguous = 0;
  const resolvers = headers.map(h => {
    const explicit = new Map(),
      always = new Set(),
      wildcards = [];
    for (const imp of h.imports) {
      if (imp.isStatic) {
        const f = fileOfFqn(imp.name);
        if (f != null) always.add(f);
      } else if (imp.wildcard) {
        if (fqnToFile.has(imp.name)) always.add(fqnToFile.get(imp.name));
        else wildcards.push(imp.name);
      } else {
        const f = fileOfFqn(imp.name);
        if (f != null) {
          explicit.set(imp.name.split('.').pop(), f);
          always.add(f);
        }
      }
    }
    const samePackage = pkgTypes.get(h.pkg);
    const resolve = name => {
      if (h.localTypes.has(name)) return null;
      if (explicit.has(name)) return explicit.get(name);
      if (samePackage?.has(name)) return samePackage.get(name);
      let hit = null;
      for (const w of wildcards) {
        const f = pkgTypes.get(w)?.get(name);
        if (f != null && f !== hit) {
          if (hit != null) ambiguous++;
          else hit = f;
        }
      }
      return hit;
    };
    return { resolve, always };
  });

  const rows = files.map((f, i) => fileRow(rel(f), headers[i].loc, headers[i].hash)),
    edges = [];
  headers.forEach((h, i) => {
    const targets = new Set(resolvers[i].always);
    for (const name of h.refs) {
      const t = resolvers[i].resolve(name);
      if (t != null) targets.add(t);
    }
    targets.delete(i);
    for (const t of targets) {
      edges.push([i, t]);
      rows[t][2]++;
    }
  });

  const out = {};
  if (symbols)
    files.forEach((f, i) => {
      const text = fs.readFileSync(f, 'utf8'),
        tree = jp.parse(text);
      const { decls, calls, refs } = javaSymbols(tree, {
        resolve: name => {
          const t = resolvers[i].resolve(name);
          return t == null || t === i ? null : rows[t][0];
        },
      });
      tree.delete();
      out[rows[i][0]] = { lines: text.split('\n').length, decls, calls, refs };
    });
  return {
    scan,
    ...sealOverview(rows, edges, out),
    symbols: out,
    stats: { files: files.length, ambiguousWildcardMatches: ambiguous, duplicateTypeNames: duplicateTypes },
  };
}
