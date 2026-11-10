#!/usr/bin/env node
// Applies this project's settings on top of a freshly generated IWSDK starter. Run it once, right after the generator
// (docs/plans/m0-migration.md, Task 1). Every step is an exact, checked edit; running it again changes nothing. If a
// file the generator wrote does not look as expected, it stops and says which one, without half-applying that step.
// Usage: node tools/setup-after-scaffold.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = file => path.join(repo, file);
const read = file => fs.readFileSync(at(file), 'utf8');
const done = [];
const stop = message => {
  console.error(`\nSTOPPED: ${message}\nNothing else was changed after this point. Report this message.`);
  process.exit(1);
};
for (const file of ['package.json', 'vite.config.ts', 'index.html', 'AGENTS.md', '.gitignore', 'iwsdk.config.json'])
  if (!fs.existsSync(at(file))) stop(`${file} is missing. Run the IWSDK generator first (Task 1, Step 1).`);

// 1. package.json: the project's name and scripts.
{
  const pkg = JSON.parse(read('package.json'));
  const scripts = {
    check: 'node tools/check-boundaries.mjs && node tools/run-checks.mjs',
    bake: 'node tools/bake-dataset.mjs',
    assets: 'node tools/assets/build-assets.mjs',
    smoke: 'node tools/smoke-flat.mjs',
    postinstall: 'node tools/copy-runtime.mjs',
  };
  if (pkg.scripts?.postinstall && pkg.scripts.postinstall !== scripts.postinstall)
    stop(`package.json already has a postinstall script: ${pkg.scripts.postinstall}`);
  const before = JSON.stringify(pkg);
  pkg.name = 'orrery';
  pkg.scripts = { ...pkg.scripts, ...scripts };
  if (JSON.stringify(pkg) !== before) {
    fs.writeFileSync(at('package.json'), JSON.stringify(pkg, null, 2) + '\n');
    done.push('package.json: name and scripts');
  }
}

// 2. .gitignore: folders this project generates.
{
  const marker = '# This project';
  const text = read('.gitignore');
  if (!text.includes(marker)) {
    fs.writeFileSync(at('.gitignore'), `${text.replace(/\n*$/, '\n')}\n${marker}\nscreenshots/\npublic/vendor/runtime/\n`);
    done.push('.gitignore: screenshots/ and public/vendor/runtime/');
  }
}

// 3. vite.config.ts: build flat.html beside index.html, and keep bundles out of dist/assets/, where public/assets/
//    (the models and maps) is copied.
{
  let text = read('vite.config.ts');
  if (!text.includes("assetsDir: 'bundle'")) {
    const edits = [
      ["    outDir: 'dist',\n", "    outDir: 'dist',\n    assetsDir: 'bundle',\n    chunkSizeWarningLimit: 8192,\n"],
      ["rollupOptions: { input: './index.html' }", "rollupOptions: { input: { index: './index.html', flat: './flat.html' } }"],
    ];
    for (const [find] of edits)
      if (text.split(find).length !== 2)
        stop(`vite.config.ts does not contain exactly one ${JSON.stringify(find.trim())}. Edit it by hand as Task 1 describes.`);
    for (const [find, replace] of edits) text = text.replace(find, () => replace);
    fs.writeFileSync(at('vite.config.ts'), text);
    done.push('vite.config.ts: two pages, bundles in dist/bundle/');
  }
}

// 4. AGENTS.md: this project's section, above the generator's guidance.
{
  const start = '<!-- orrery:project:start -->',
    end = '<!-- orrery:project:end -->';
  const section = `${start}\n${fs.readFileSync(at('tools/scaffold/project-guidance.md'), 'utf8').trim()}\n${end}`;
  const text = read('AGENTS.md');
  let next;
  if (text.includes(start) && text.includes(end))
    next = text.slice(0, text.indexOf(start)) + section + text.slice(text.indexOf(end) + end.length);
  else {
    const firstLineEnd = text.indexOf('\n');
    if (!text.startsWith('# ') || firstLineEnd < 0) stop('AGENTS.md does not start with a heading line.');
    next = `${text.slice(0, firstLineEnd + 1)}\n${section}\n${text.slice(firstLineEnd + 1)}`;
  }
  if (next !== text) {
    fs.writeFileSync(at('AGENTS.md'), next);
    done.push('AGENTS.md: project section');
  }
}

// 5. index.html: the product's name as the page title.
{
  const text = read('index.html');
  const titles = text.match(/<title>[^<]*<\/title>/g) || [];
  if (titles.length !== 1) stop(`index.html has ${titles.length} <title> elements; expected one.`);
  const next = text.replace(titles[0], '<title>Orrery</title>');
  if (next !== text) {
    fs.writeFileSync(at('index.html'), next);
    done.push('index.html: title');
  }
}

// 6. Report the generated feature settings; they are checked, never edited.
const features = JSON.parse(read('iwsdk.config.json')).world?.features ?? {};
console.log(done.length ? `applied:\n  ${done.join('\n  ')}` : 'nothing to apply: already set up');
console.log(`features: locomotion=${JSON.stringify(features.locomotion)} grabbing=${features.grabbing} physics=${features.physics}`);
if (features.locomotion !== false || features.grabbing !== true || features.physics !== false)
  stop('Expected locomotion=false, grabbing=true, physics=false. The generator was run with different options.');
