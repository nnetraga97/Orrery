// An incrementally updated project model (engine/analyzer/project-model.mjs) produces exactly what a full analysis of
// the same files produces, edit after edit, while re-analyzing only the files an edit can affect. Offline fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectModel, createProjectModel } from '../engine/analyzer/project-model.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'galaxy-incremental-')));
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const remove = rel => fs.rmSync(path.join(root, rel));
const report = {};
try {
  write('tsconfig.json', '{ "compilerOptions": { "strict": true } }\n');
  write('lib.ts', 'export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n');
  write('main.ts', "import { a, b } from './lib';\nexport function run() {\n  return a() + b();\n}\n");
  write('util/index.ts', 'export const u = 1;\nexport function help() {\n  return u;\n}\n');
  write('use.ts', "import { help } from './util';\nexport function go() {\n  return help();\n}\n");
  write('shapes.ts', 'export class Shape {\n  area() {\n    return 0;\n  }\n}\n');
  write('draw.ts', "import { Shape } from './shapes';\nexport function draw(s: Shape) {\n  return s.area();\n}\n");
  write(
    'legacy.cjs',
    "const { run } = require('./main.ts');\nfunction start() {\n  return run();\n}\nmodule.exports = { start };\n",
  );
  write('alias.ts', "import { u } from '@u';\nexport const w = u;\n");

  const model = createProjectModel({ root });
  let symbols = {};
  const step = (name, changed, expect = {}) => {
    const result = model.update(changed ? { paths: changed } : null);
    for (const rel of changed || []) if (!fs.existsSync(path.join(root, rel))) delete symbols[rel];
    symbols = result.full ? { ...result.symbols } : { ...symbols, ...result.symbols };
    const full = buildProjectModel({ root });
    assert.equal(
      JSON.stringify(result.graph),
      JSON.stringify(full.graph),
      `${name}: the graph matches a full analysis`,
    );
    const keys = Object.keys(full.symbols).sort();
    assert.deepEqual(Object.keys(symbols).sort(), keys, `${name}: the same files have symbols`);
    for (const key of keys)
      assert.equal(JSON.stringify(symbols[key]), JSON.stringify(full.symbols[key]), `${name}: ${key} matches`);
    if (expect.full != null) assert.equal(result.full, expect.full, `${name}: full analysis is ${expect.full}`);
    if (expect.most != null)
      assert.ok(result.stats.reanalyzed <= expect.most, `${name}: reanalyzed ${result.stats.reanalyzed}`);
    report[name] = { full: result.full, reanalyzed: result.stats.reanalyzed, files: result.stats.files };
  };

  step('initial', null, { full: true });
  step('nothing changed', ['main.ts'], { full: false, most: 0 });
  write('main.ts', "import { a, b } from './lib';\nexport function run() {\n  return b() + a();\n}\n");
  step('same-size semantic edit', ['main.ts'], { full: false, most: 2 });
  write('lib.ts', '\n\nexport function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n');
  step('lines shift under an importer', ['lib.ts'], { full: false, most: 3 });
  write('util.ts', 'export const u = 2;\nexport function help() {\n  return u * 2;\n}\n');
  step('a new file wins an import that resolved elsewhere', ['util.ts'], { full: false });
  remove('util.ts');
  step('the winning file is deleted', ['util.ts'], { full: false });
  write('lib.ts', '\n\nexport function a() {\n  return 1;\n}\nexport function c() {\n  return 2;\n}\n');
  step('a callable is renamed under its callers', ['lib.ts'], { full: false });
  write('shapes.ts', 'export class Shape {\n  area() {\n    return 1;\n  }\n  perimeter() {\n    return 0;\n  }\n}\n');
  step('a method is added to a class', ['shapes.ts'], { full: false });
  write('extra.ts', "import { a } from './lib';\nexport function more() {\n  return a();\n}\n");
  step('a new file', ['extra.ts'], { full: false, most: 2 });
  remove('lib.ts');
  step('an imported file is deleted', ['lib.ts'], { full: false });
  write(
    'tsconfig.json',
    '{ "compilerOptions": { "strict": true, "baseUrl": ".", "paths": { "@u": ["util/index.ts"] } } }\n',
  );
  step('configuration', ['tsconfig.json'], { full: true });
  write('globals.js', 'var shared = 1;\nfunction everywhere() {\n  return shared;\n}\n');
  step('a global script', ['globals.js'], { full: true });
  write(
    'legacy.cjs',
    "const { run } = require('./main.ts');\nfunction start() {\n  return run() + 1;\n}\nmodule.exports = { start };\n",
  );
  step('a CommonJS edit', ['legacy.cjs'], { full: false, most: 1 });
  console.log(JSON.stringify(report));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
