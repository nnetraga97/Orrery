#!/usr/bin/env node
// Checks the import rules that keep the code structure in docs/design.md honest. It reads every source file's
// import, export-from, dynamic import and require specifiers and fails when one crosses a boundary.
// Usage: node tools/check-boundaries.mjs   (part of `npm run check`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'galaxy', 'api', 'tools'];
const SOURCE = /\.(?:[cm]?js|tsx?)$/;

// Each rule: files under `from` (minus `except`) may not import a path under `forbid`, may import only paths under
// `only`, and may not import the bare packages in `packages`. Paths are repository-relative with forward slashes.
const RULES = [
  {
    name: 'copied code is independent of the app',
    from: ['galaxy/'],
    forbid: ['src/', 'api/', 'reference/', 'tools/'],
  },
  {
    name: 'reference/ is read-only material, never a dependency',
    from: ['src/', 'api/', 'tools/'],
    forbid: ['reference/'],
  },
  {
    name: 'only the bridge and the flat view touch copied code',
    from: ['src/'],
    except: ['src/galaxy-bridge/', 'src/flat/'],
    forbid: ['galaxy/'],
  },
  {
    name: 'core is pure: no rendering, framework or browser packages, and no imports outside core',
    from: ['src/core/'],
    only: ['src/core/'],
    packages: /.*/,
  },
  {
    name: 'ports are types over core',
    from: ['src/ports/'],
    only: ['src/core/', 'src/ports/'],
    packages: /.*/,
  },
  {
    name: 'adapters are wired in the composition root, not imported by features',
    from: ['src/'],
    except: ['src/adapters/', 'src/index.ts', 'src/flat/'],
    forbid: ['src/adapters/'],
  },
  {
    name: 'new code imports three.js from @iwsdk/core (one copy of three.js)',
    from: ['src/'],
    except: ['src/flat/'],
    packages: /^three(\/|$)/,
  },
  {
    name: 'server functions share only pure core code with the app',
    from: ['api/'],
    forbid: ['galaxy/', 'src/'],
    allow: ['src/core/'],
  },
];

const walk = dir =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile() && SOURCE.test(entry.name))
        .map(entry => path.join(entry.parentPath, entry.name))
    : [];

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
// `import type` is erased at build time, so it cannot create a runtime dependency. Those statements are removed
// before the file is scanned.
const TYPE_ONLY = /\bimport\s+type\b[^;]*?\bfrom\s*(['"])([^'"\n]+)\1;?/g;

const under = (file, prefixes) => prefixes.some(prefix => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix));

const violations = [];
let files = 0;
for (const root of ROOTS)
  for (const absolute of walk(path.join(repo, root))) {
    const file = path.relative(repo, absolute).split(path.sep).join('/');
    const text = fs.readFileSync(absolute, 'utf8').replace(TYPE_ONLY, '');
    files++;
    for (const [, , specifier] of text.matchAll(SPECIFIER)) {
      const relative = specifier.startsWith('.');
      const target = relative
        ? path.relative(repo, path.resolve(path.dirname(absolute), specifier.split('?')[0])).split(path.sep).join('/')
        : null;
      for (const rule of RULES) {
        if (!under(file, rule.from) || (rule.except && under(file, rule.except))) continue;
        let broken = false;
        if (target) {
          if (rule.allow && under(target, rule.allow)) continue;
          if (rule.forbid && under(target, rule.forbid)) broken = true;
          if (rule.only && !under(target, rule.only)) broken = true;
        } else if (rule.packages && !specifier.startsWith('node:') && rule.packages.test(specifier)) {
          broken = true;
        }
        if (broken) violations.push(`${file} imports '${specifier}'\n    rule: ${rule.name}`);
      }
    }
  }

if (violations.length) {
  console.error(`${violations.length} import boundary violation(s):\n\n${violations.join('\n')}`);
  console.error('\nThe rules and their reasons are in docs/design.md, section 4.');
  process.exit(1);
}
console.log(`import boundaries hold across ${files} files`);
