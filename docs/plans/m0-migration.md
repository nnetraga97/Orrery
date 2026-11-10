# M0 Migration Implementation Plan

> **How to use this plan.** Do the tasks in order, one step at a time. Run each command exactly as written, compare
> its output with "Expected", and tick the step's checkbox (`- [ ]` to `- [x]`) only when it matches. No plugin, skill
> or workflow tool is required. When something does not match, follow rule 8 under "Rules": stop and report.

**Goal:** Turn `metavrviz` into a building IWSDK project in which the galaxy code copied from `codebase-viz` runs in a browser from baked data and optimized assets.

**Architecture:** An IWSDK (WebXR) starter is scaffolded at the repository root and left untouched as the future XR entry (`index.html`). The copied scene code lives in `galaxy/` and is proven by a second page, the flat reference view (`flat.html`), which runs the constellation with a mouse, static dataset files and no server. Datasets and assets are produced by scripts in `tools/`, so nothing large or hand-made is committed.

**Tech Stack:** Node 22, Vite 7, IWSDK 1.1.0-rc.2 (three.js as `super-three@0.185.0`), d3, graphology, glTF-Transform, sharp, Playwright (headless Chromium).

**Design:** `docs/design.md`. Read sections 1, 3 and 4 before starting.

---

## Read this first

### What is already done

The `main` branch already contains, tested:

| Path | What it is |
| --- | --- |
| `galaxy/` | Code copied from `codebase-viz` at commit `88c68743e48da7784cb2bb6f5071c8471a48994a`, with patches applied. See `galaxy/README.md`. |
| `reference/` | Read-only desktop code for later milestones. |
| `tools/migrate/copy-code.sh`, `tools/migrate/apply-patches.mjs` | Re-create `galaxy/` and `reference/` from a `codebase-viz` checkout. |
| `tools/bake-dataset.mjs` | Analyzes a project into `public/data/<name>/`. |
| `tools/assets/build-assets.mjs` | Builds `public/assets/` from `codebase-viz/viewer/assets`. |
| `tools/copy-runtime.mjs` | Copies the TypeScript compiler the browser loads. |
| `tools/run-checks.mjs` | Runs the offline checks in `galaxy/checks/`. |
| `tools/check-boundaries.mjs` | Fails when an import crosses a boundary of the code structure (`docs/design.md` §4.0). |
| `tools/smoke-flat.mjs` | Serves `dist/`, loads the flat view in headless Chromium, fails on errors, saves a screenshot. |
| `src/README.md` | The folder structure for the XR app and its import rules. No XR code exists yet. |
| `flat.html`, `src/flat/main.js`, `src/flat/flat-host.js` | The flat reference view. |
| `public/data/editor-core/` | The demo dataset, already baked: 229 files of the VS Code editor's text model (`src/vs/editor/common` of `microsoft/vscode`, MIT licence, commit in its `manifest.json`). You do not need a VS Code checkout. |
| `docs/migration/flat-overview.png`, `flat-town.png`, `flat-editor-core.png` | What the smoke runs looked like when this plan was written. |

Your job is everything those files need around them: the IWSDK scaffold, dependencies,
build wiring, the baked test sample, the built assets, verification and guidance
files. Deployment is deferred (Task 9).

### Time

About an hour and a half of work if nothing goes wrong: Task 1 fifteen minutes, Task 2
ten, Task 3 five, Task 4 ten, Task 5 five, Task 6 fifteen plus the push, Task 7
fifteen (one run takes three minutes), Task 8 ten, Task 10 ten.

### Rules

1. **Do not edit files under `galaxy/` by hand**, except `galaxy/README.md`,
   `galaxy/viewer/app/static-data.js` and `galaxy/viewer/app/project-store.ts`. A
   change to copied code goes into `tools/migrate/apply-patches.mjs`.
2. **Do not change the scripts in `tools/`** unless a step tells you to. They were
   tested against these exact inputs. If one fails, stop and report (rule 8).
3. **Do not start XR work.** Leave the scaffold's `src/index.ts`, `src/panel.ts`,
   `src/robot.ts` and its scene exactly as generated. M1 has its own plan.
4. **Do not use `rsync`.** It is not installed in the cloud environment. Use `cp`.
5. **Commit after every task** with the message the task gives. Do not open a pull
   request unless the owner asks.
6. **This plan outranks the scaffold's guidance.** The generator in Task 1 installs an
   `AGENTS.md` and skills written for starting a new experience. They say to begin
   implementing at once and not to write planning files. Here, follow this plan
   instead: read that guidance for how IWSDK's tools work, not for what to build.
7. **No task in this plan needs an API key or any other secret.** Do not ask for one,
   do not create `.env` files, and do not call any model API. The owner supplies a
   Claude key later, when a later milestone asks for it (`docs/design.md` §4.5).
8. **Stop and report instead of improvising** when: a command's output does not match
   "Expected"; a script in `tools/` errors; a permission prompt or classifier blocks
   a command; or a step would need you to edit copied code. Say which task and step,
   paste the output, and wait.

### Paths used in commands

Every command is run from the `metavrviz` repository root unless it says otherwise.
Set this once per shell:

```bash
export CBV=/home/user/codebase-viz        # absolute path to a codebase-viz checkout
```

On a different machine, change the path. All later commands use `"$CBV"`.

### Things that will look wrong but are not

| You see | Why | What to do |
| --- | --- | --- |
| The flat view runs at 1–3 FPS in the smoke test | Headless Chromium renders with software WebGL | Nothing. Use the `--settle` values given. |
| `Module "node:url" has been externalized for browser compatibility` during `vite build` | `galaxy/source-model/tree-sitter.js` is only used for non-JavaScript languages | Nothing. It is a warning. |
| Landing on a planet shows "Placing towns and connecting roads…" for over a minute | Town construction is spread across frames, and frames are slow in software | Nothing. `--settle=150000` covers it. |
| `browserType.launch: Executable doesn't exist` | Playwright wants a browser build that is not installed | Run with `CHROMIUM_PATH=/path/to/chrome`. In the cloud environment the script already uses `/opt/pw-browsers/chromium`. |
| The scaffold's `AGENTS.md` says to start building the experience | It is written for new projects | Rule 6: follow this plan. |
| Re-running `copy-code.sh` prints `5 applied` | It restores the originals and patches them again | Nothing. `git status` should still be clean. |

---

## File structure after this plan

```
metavrviz/
  index.html, vite.config.ts, tsconfig.json, iwsdk.config.json, package.json   IWSDK scaffold (Task 1)
  AGENTS.md, CLAUDE.md, .claude/, .agents/, .codex/                              scaffold guidance (Task 1), extended (Task 8)
  src/index.ts, src/panel.ts, src/robot.ts, ...                                  scaffold starter, untouched
  src/flat/                                                                      flat reference view (exists)
  flat.html                                                                      flat reference view page (exists)
  galaxy/, reference/, tools/, docs/                                             exist
  public/ui/, public/scenes/, public/audio/                                      scaffold (Task 1)
  public/data/editor-core/                                                       demo dataset (exists)
  public/data/sample/                                                            small test dataset (Task 5)
  public/assets/                                                                 built models and maps (Task 6)
  public/vendor/runtime/typescript.js                                            copied on install, not committed (Task 2)
```

---

### Task 0: Preconditions

**Files:** none.

- [ ] **Step 1: Check Node**

Run: `node -v`
Expected: `v22.12.0` or newer in the 22 line (the scaffold accepts `>=20.19.0 <21`, `>=22.12.0 <23` or `>=24`).

- [ ] **Step 2: Check the starting point**

Run:
```bash
git fetch origin main
git log --oneline -1 origin/main
git status --short
ls galaxy tools src flat.html docs/plans public/data
```
Expected: `git status` prints nothing, and the `ls` lists `galaxy/` (with `viewer`,
`source-model`, `engine`, `checks`, `README.md`, `SOURCE_COMMIT`), `tools/` (five
scripts and the folders `assets` and `migrate`), `src/` (`README.md` and `flat`),
`flat.html`, this plan, and `editor-core`.

Work on the branch your session designates, created from `origin/main`:
`git checkout -b <your-branch> origin/main`. If none is designated, use `m0-migration`.

- [ ] **Step 3: Check the codebase-viz checkout**

Run:
```bash
export CBV=/home/user/codebase-viz
git -C "$CBV" rev-parse HEAD
cat galaxy/SOURCE_COMMIT
test -f "$CBV/viewer/assets/planets/library.json" && echo assets-present
```
Expected: both hashes are `88c68743e48da7784cb2bb6f5071c8471a48994a`, then `assets-present`.

If `HEAD` differs, run `git -C "$CBV" checkout 88c68743e48da7784cb2bb6f5071c8471a48994a`
(a shallow clone may need `git -C "$CBV" fetch --depth=200 origin main` first). If
that commit cannot be reached, stop and report.

---

### Task 1: Scaffold the IWSDK project

**Files:**
- Create (by the generator): `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `iwsdk.config.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.codex/`, `src/index.ts`, `src/panel.ts`, `src/robot.ts`, `src/robot-component.ts`, `src/assets.ts`, `src/components.ts`, `src/vite-env.d.ts`, `src/scene-assets/`, `public/ui/`, `public/audio/`, `public/scenes/main.iwsdk.scene.json`
- Modify: `.gitignore`

This step was **not** pre-tested: the generator could not be run where this plan was
written. Its files were read from the published package, so the names above are right,
but treat its output carefully.

- [ ] **Step 1: Run the generator into the existing repository**

Run:
```bash
npm create @iwsdk@1.1.0-rc.2 . -- --yes --force --target vr --no-git --no-locomotion --grabbing --no-physics
```

The version is pinned to the one this plan was checked against. If npm reports that
version does not exist, use `@iwsdk@latest` and say so in the final report.

`.` scaffolds into the current directory. `--force` is required because the directory
is not empty; it overwrites only files the generator itself writes (here: the one-line
`README.md`) and keeps everything else. `--no-git` because the repository exists.
`--no-locomotion` because the app is seated and the world moves, not the user.

Expected: it prints the resolved settings (target VR, TypeScript, grabbing on,
locomotion off, physics off), writes files, and installs dependencies.

If a permission prompt or classifier blocks the command, stop and ask the owner to
approve or run that one command, then continue from Step 2.

If dependency installation fails on a network error, run `npm install` once more. If
only the "reference warmup" part fails, continue: it is an optional documentation
index.

- [ ] **Step 2: Confirm nothing of ours was touched**

Run: `git status --short`
Expected: new untracked scaffold files, `README.md` modified, and **no** line
mentioning `galaxy/`, `reference/`, `tools/`, `src/flat/`, `flat.html` or `docs/`.

If any of those paths appears as modified or deleted, run `git checkout -- <path>`
for it and report what happened.

- [ ] **Step 3: Confirm the pinned versions**

Run:
```bash
npm pkg get dependencies.three dependencies.@iwsdk/core overrides.three
```
Expected: `three` and `overrides.three` are `npm:super-three@0.185.0`; `@iwsdk/core`
is `1.1.0-rc.2` or newer.

If `three` is a different version, do not change it. Continue, and say so in the
final report: the dry run that validated the copied code used `0.185.0`.

- [ ] **Step 4: Confirm the features**

Run:
```bash
node -e "const c=require('./iwsdk.config.json'); console.log(JSON.stringify(c.world?.features ?? c.features ?? c, null, 1))"
```
Expected: the printed settings show locomotion off, grabbing on and physics off.
The exact key names are the generator's; do not edit the file. If locomotion is on,
stop and report: an unused locomotion feature makes the player fall through a scene
with no floor component.

- [ ] **Step 5: Ignore generated folders**

Append to `.gitignore`:

```gitignore

# This project
screenshots/
public/vendor/runtime/
```

- [ ] **Step 6: Verify the untouched starter builds**

Run:
```bash
npm run typecheck
npm run build
ls dist/index.html
```
Expected: `typecheck` prints nothing and exits 0; `build` ends with `✓ built in`;
`dist/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Scaffold the IWSDK virtual reality starter"
```

---

### Task 2: Add dependencies and scripts

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install what the copied code and the tools need**

Run:
```bash
npm install d3@^7.9.0 graphology@^0.25.4 graphology-communities-louvain@^2.0.2
SHARP="$(npm pkg get overrides.sharp | tr -d '"{}')"
npm install --save-dev typescript@^5.9.3 ignore@^7.0.12 @types/d3@^7.4.3 \
  @gltf-transform/core@^4 @gltf-transform/extensions@^4 @gltf-transform/functions@^4 \
  "sharp${SHARP:+@$SHARP}"
```

The `SHARP` line reads the version the scaffold pins in `overrides` and installs
exactly that, because npm refuses a direct dependency that conflicts with an override.

Expected: both commands end with `added N packages` and no `ERR!` lines.

| Package | Used by |
| --- | --- |
| `d3`, `graphology`, `graphology-communities-louvain` | `galaxy/viewer` (layout, colours, import clusters) |
| `typescript`, `ignore` | `galaxy/engine/analyzer` when baking; `typescript` is also copied for the browser |
| `@gltf-transform/*`, `sharp` | `tools/assets/build-assets.mjs` |

- [ ] **Step 2: Check there is one copy of three.js**

Run: `npm ls three 2>&1 | grep -c "super-three@0.185.0" ; find node_modules -path '*node_modules/three/package.json' | wc -l`
Expected: the first number is 1 or more; the second is exactly `1`.

If the second number is greater than 1, stop and report: a dependency brought its own
three.js, which breaks `instanceof` checks between the scene code and IWSDK.

- [ ] **Step 3: Add the scripts**

Run:
```bash
npm pkg get scripts.postinstall
```
Expected: `{}` (the scaffold defines none). If it prints a command instead, stop and report.

Then:
```bash
npm pkg set scripts.check="node tools/check-boundaries.mjs && node tools/run-checks.mjs" \
  scripts.bake="node tools/bake-dataset.mjs" \
  scripts.assets="node tools/assets/build-assets.mjs" \
  scripts.smoke="node tools/smoke-flat.mjs" \
  scripts.postinstall="node tools/copy-runtime.mjs"
npm run postinstall
ls public/vendor/runtime
```
Expected: `Copied the TypeScript runtime to public/vendor/runtime/.` then
`typescript.LICENSE  typescript.js`.

- [ ] **Step 4: Run the offline checks**

Run: `npm run check`
Expected: `import boundaries hold across N files` (N is about 140), ten lines starting
`ok`, then `all 10 checks passed`.

If the boundary check fails on a scaffold file under `src/` importing `three`
directly, do not edit the scaffold file: report it. (The starter imports three.js
from `@iwsdk/core`, so this is not expected.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add the galaxy code's dependencies and the project scripts"
```

`public/vendor/runtime/` is ignored and must not appear in `git status`.

---

### Task 3: Verify the copied code is reproducible

**Files:** none changed if everything matches.

- [ ] **Step 1: Re-run the copy**

Run: `tools/migrate/copy-code.sh "$CBV"`
Expected:
```
Copied from codebase-viz at 88c68743e48da7784cb2bb6f5071c8471a48994a
patches: 5 applied, 0 already present; brand keys renamed in 7 files
```

- [ ] **Step 2: Confirm it produced exactly what is committed**

Run: `git status --short galaxy reference`
Expected: no output.

If files differ, `codebase-viz` is not at the commit in Task 0 Step 3. Run
`git checkout -- galaxy reference`, fix the checkout, and repeat this task.

- [ ] **Step 3: Confirm the desktop API and brand names are gone from shipped code**

Run:
```bash
grep -rn "/api/projects" galaxy/viewer galaxy/source-model src | wc -l
grep -rliE "bugatti|aventador|lamborghini" galaxy/viewer src flat.html | wc -l
```
Expected: `0` and `0`.

No commit: nothing changed.

---

### Task 4: Build both pages

**Files:**
- Modify: `vite.config.ts`

The scaffold builds only `index.html`. The flat view is a second page. Vite's default
output folder for bundles is `dist/assets/`, which is also where `public/assets/` is
copied; bundles move to `dist/bundle/` so the two never mix.

- [ ] **Step 1: Edit the build section of `vite.config.ts`**

Find:
```ts
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
```
Replace with:
```ts
  build: {
    outDir: 'dist',
    // Not "assets": public/assets/ holds the models and maps the scene fetches at run time.
    assetsDir: 'bundle',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    chunkSizeWarningLimit: 8192,
    // index.html is the XR app. flat.html is the flat reference view (src/flat/).
    rollupOptions: { input: { index: './index.html', flat: './flat.html' } },
  },
```

If the generated `build` section differs from the "Find" text, keep every line the
generator wrote and make only these three changes: add `assetsDir: 'bundle'`, add
`chunkSizeWarningLimit: 8192`, and change `rollupOptions.input` to the object above.

- [ ] **Step 2: Build**

Run:
```bash
npm run typecheck && npm run build
ls dist/index.html dist/flat.html && ls dist/bundle | head -3
```
Expected: both HTML files exist and `dist/bundle/` contains hashed `.js` files. The
`node:url` warning from the table at the top is fine.

If the build fails **only** after adding `assetsDir`, remove that one line, rebuild,
and note it in the final report. Everything else still works; the smoke test's asset
list will simply include bundle files.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "Build the flat reference view beside the XR app"
```

---

### Task 5: Bake the sample dataset

**Files:**
- Create: `public/data/sample/` (`graph.js`, `symbols-index.json`, `manifest.json`, `symbols/*.json`, `source/*.js`)

Two datasets exist after this task:

- `sample` — this repository's own `galaxy/source-model` folder, 13 JavaScript files.
  Small and fast; the smoke tests use it. You bake it here.
- `editor-core` — the demo project, already committed. Do **not** re-bake it. Step 3
  only checks it.

- [ ] **Step 1: Bake**

Run: `npm run bake -- sample galaxy/source-model`
Expected:
```
sample: 13 files, 3 imports, 1 unresolved module references
baked 13 files into public/data/sample (5.5 MB)
```
(The megabyte figure may differ by a few tenths.)

- [ ] **Step 2: Check the output**

Run:
```bash
ls public/data/sample
ls public/data/sample/symbols | wc -l
ls public/data/sample/source | wc -l
node -e "const i=require('./public/data/sample/symbols-index.json'); console.log(Object.keys(i).length, i['layout-memory.js'])"
```
Expected: `graph.js  manifest.json  source  symbols  symbols-index.json`, then `13`,
`13`, then `13` followed by a file name ending in `.json`.

- [ ] **Step 3: Check the committed demo dataset**

Run:
```bash
node -e "const m=require('./public/data/editor-core/manifest.json'); console.log(m.files, m.scanDir, m.sourceCommit.slice(0,8), m.licence)"
ls public/data/editor-core/symbols | wc -l
head -1 public/data/editor-core/LICENSE.txt
```
Expected: `229 src/vs/editor/common 316b9733 LICENSE.txt`, then `229`, then `MIT License`.

The licence file must stay beside the dataset: the MIT licence requires its notice to
travel with copies of the code. Do not remove copyright headers from the files under
`public/data/editor-core/source/`.

- [ ] **Step 4: Commit**

```bash
git add public/data/sample
git commit -m "Bake the sample dataset from the source models"
```

---

### Task 6: Build the assets

**Files:**
- Create: `public/assets/` (about 370 files, about 115 MB)

`tools/assets/build-assets.mjs` copies only what the scene loads, shrinks the textures
inside each model to at most 1024 px WebP, leaves geometry, node names and animations
alone, skips Blender sources, raw downloads and the 4K planet tier, and publishes two
brand-named ship rigs as `arc` and `arrow`.

- [ ] **Step 1: Build**

Run: `npm run assets -- "$CBV"`
Expected, within a few megabytes:
```
369 files: 191.6 MB in codebase-viz -> 115.1 MB in public/assets
```
and exit code 0. It exits 1 if the result is over 120 MB; if that happens, stop and
report the printed size.

- [ ] **Step 2: Check the layout and the names**

Run:
```bash
ls public/assets
ls public/assets/rigged
grep -rlaiE "bug+at+i|aventador|lamborghini" public/assets | wc -l
find public/assets -type f -size +10M | wc -l
find public/assets -name '*.blend*' -o -name '*-raw.glb' -o -path '*/close/*' | wc -l
```
Expected:
```
buildings  cannon  island  kit  planets  rigged  vehicles
arc  arrow  cargo  context-district  factory  satellite  terminal-moon  town-port
0
0
0
```

- [ ] **Step 3: Commit**

```bash
git add public/assets
git commit -m "Build the runtime assets from codebase-viz"
```

These files are generated, but they are committed so the host can deploy from git.
They are written once; rebuilding from the same inputs produces identical files.

- [ ] **Step 4: Push now**

Run: `git push -u origin HEAD`

This is the largest push in the plan. If it fails with HTTP 413 or a size error, undo
the commit and push the folders one at a time:

```bash
git reset --soft HEAD~1 && git reset -q
for d in buildings cannon island kit planets rigged vehicles; do
  git add "public/assets/$d" && git commit -q -m "Build the runtime assets: $d" && git push -u origin HEAD
done
```

Retry a push that fails on a network error up to four times, waiting 2, 4, 8 and 16 seconds.

---

### Task 7: Prove the copied code runs

**Files:**
- Modify: `docs/migration/flat-overview.png`, `docs/migration/flat-town.png`

`tools/smoke-flat.mjs` serves `dist/` itself on a free local port, opens `flat.html`
in headless Chromium, waits, and fails on any page error, console error or missing file. It prints a summary, the
list of asset files requested, and `SMOKE PASSED` or `SMOKE FAILED`.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `✓ built in`.

- [ ] **Step 2: Smoke-test the overview**

Run: `npm run smoke -- --settle=12000 --out=docs/migration/flat-overview.png`
Expected, in the JSON summary: `"files": 13`, `"canvases": 1`, `"sceneError": false`,
and the last line `SMOKE PASSED`. The requested assets include
`assets/cannon/meshy/agent-cannon.glb` and `assets/rigged/arc/arc-lod.glb`.

- [ ] **Step 3: Smoke-test landing on a planet**

Run:
```bash
npm run smoke -- --land=layout-memory.js --line=20 --settle=150000 --size=900x600 --out=docs/migration/flat-town.png
```
This takes about three minutes. Expected: `"landed": true`, `"loading": ""`,
`"labels"` above 50, and `SMOKE PASSED`.

If `"loading"` is not empty, the planet had not finished building: run again with
`--settle=300000`. If it still is not empty, stop and report.

- [ ] **Step 4: Smoke-test the demo dataset**

Run: `npm run smoke -- --dataset=editor-core --settle=25000 --out=docs/migration/flat-editor-core.png`
Expected: `"files": 229` and `SMOKE PASSED`.

- [ ] **Step 5: Look at the three screenshots**

Open `docs/migration/flat-overview.png`, `flat-town.png` and `flat-editor-core.png`.

- Overview: a starfield, a black hole with small planets around it and file-name
  labels (`java.js`, `code-model.js`), and near the middle a station, a satellite and
  a cratered moon.
- Town: a planet's surface filling the frame, roads with lane markings, small
  buildings along them, and a label beginning `L20 · Return ·`.
- Demo dataset: many small systems spread across the view, with group labels such as
  `cursor`, `model`, `languages` and `diff`, and file labels such as `range.ts`.

`git diff --stat docs/migration` will show the files changed (rendering is not
pixel-identical between runs). That is expected. If a screenshot is black, or shows
only stars, stop and report.

- [ ] **Step 6: If the smoke test fails**

Read the lines under `missing files` and `errors`.

| Output | Cause | Fix |
| --- | --- | --- |
| `404 /assets/...` | `public/assets/` is incomplete | Repeat Task 6. If the file is still missing, report its path; do not hand-copy it. |
| `404 /data/sample/...` | The dataset was not baked or not built into `dist/` | Repeat Task 5, then `npm run build`. |
| `404 /vendor/runtime/typescript.js` | `postinstall` did not run | `npm run postinstall`, then `npm run build`. |
| `Cannot read properties of null (reading 'value')` or `(reading 'addEventListener')` | The scene code looked up a DOM id that `flat.html` lacks | Report the stack trace. Do not edit `galaxy/`. |
| `Playwright is not installed` | Neither `playwright` nor `playwright-core` can be found | `npm install --save-dev playwright`, then set `CHROMIUM_PATH` to a Chrome or Chromium binary and rerun. |
| `dist/flat.html does not exist` | The build did not run or Task 4 was skipped | `npm run build`; if `flat.html` is still missing, redo Task 4. |

- [ ] **Step 7: Commit**

```bash
git add docs/migration
git commit -m "Record the flat reference view after migration"
```

---

### Task 8: Guidance for whoever works here next

**Files:**
- Modify: `AGENTS.md` (generated in Task 1)
- Modify: `README.md` (generated in Task 1)

- [ ] **Step 1: Add a project section to the top of `AGENTS.md`**

Insert this directly under the file's first heading line, above the generator's own
text:

```markdown
## This project

A voice-and-hands code editor for Meta Quest, built for the Meta VR Start Developer
Competition 2026 (deadline 2026-11-18 12:00 PT). Design:
`docs/design.md`.

| Folder | Rule |
| --- | --- |
| `src/` | New XR code, structured as `src/README.md` describes. Import three.js from `@iwsdk/core`. |
| `src/flat/`, `flat.html` | The flat reference view: the copied galaxy in a browser tab. A test page, not the product. |
| `galaxy/` | Copied from another repository. Do not hand-edit; see `galaxy/README.md`. Its files import `three`, which is aliased to the same build. |
| `reference/` | Read-only desktop code. Never import from it. |
| `public/assets/`, `public/data/` | Generated by `npm run assets` and `npm run bake`. Do not edit by hand. |
| `tools/` | Migration, baking, asset and test scripts. |

Hard requirements from the competition rules:

- Every interaction must work with hands only. No controller, no keyboard, no typing.
- Nothing may depend on a second device or a local server.
- No brand names, in text, file names or assets.
- Design for a seated user: all targets within about 60 cm of the resting hands.

Secrets live only on the server. Today that is the owner's Claude API key, read from
`ANTHROPIC_API_KEY`. People using the app never enter a key. Build and test against
the recorded fake first and ask the owner for the key only when a plan's step says a
live call is required, through a secure credential form, never pasted into a chat.
Never commit a key or put one in a file git tracks, in client code, or in a log.

The plans in `docs/plans/` say what to build next and outrank the generic IWSDK
guidance below, which is written for starting a new experience. Use that guidance for
how IWSDK's tools and APIs work.

Before claiming a change works: `npm run typecheck && npm run check && npm run build && npm run smoke`.
`npm run check` includes the import rules of the code structure (`docs/design.md` §4.0).
```

- [ ] **Step 2: Replace `README.md`**

Replace the whole file with:

````markdown
# metavrviz

A voice-and-hands code editor for Meta Quest. A codebase is a tabletop galaxy; an AI
agent shows you where a bug lives and you review its fix by hand and by voice.

Working title; the product name is not decided.

## Run

```sh
npm install
npm run dev          # the XR app with the IWSDK emulator
npm run dev:runtime  # plain Vite; open /flat.html for the flat reference view
```

## Build and check

```sh
npm run typecheck    # TypeScript in src/
npm run check        # import rules, then offline checks for the copied galaxy code
npm run build        # dist/index.html (XR app) and dist/flat.html (reference view)
npm run smoke        # loads dist/flat.html in headless Chromium
```

## Data and assets

```sh
npm run bake -- <name> <projectRoot> [scanDir]   # writes public/data/<name>/
npm run assets -- /path/to/codebase-viz          # rebuilds public/assets/
tools/migrate/copy-code.sh /path/to/codebase-viz # refreshes galaxy/ and reference/
```

## Layout

| Folder | Contents |
| --- | --- |
| `src/` | The XR app ([structure and import rules](src/README.md)) |
| `galaxy/` | Scene code, source models and analyzer copied from `codebase-viz` ([details](galaxy/README.md)) |
| `reference/` | Read-only desktop code for later work ([details](reference/README.md)) |
| `tools/` | Migration, baking, asset and test scripts |
| `docs/` | Design and plans |
````

- [ ] **Step 3: Check and commit**

Run: `npm run typecheck && npm run check`
Expected: no type errors; `import boundaries hold`; `all 10 checks passed`.

```bash
git add AGENTS.md README.md
git commit -m "Describe the project layout and its rules"
```

---

### Task 9: Deploy a preview — DEFERRED, do not do this now

The owner will set up hosting later. Skip this task and go to Task 10. The steps stay
here so they are ready when hosting is decided.

**Files (later):** possibly `vercel.json` or project settings, as the hosting skill directs.

- [ ] **Step 1 (later): Read the hosting guidance the scaffold installed**

Read `.claude/skills/iwsdk-hosting/SKILL.md` and its `references/vercel.md`.

- [ ] **Step 2 (later): Deploy a preview build**

Deploy the branch as a **preview** (not production), with build command
`npm run build` and output directory `dist`. Do not create accounts or projects
yourself; the owner links them.

- [ ] **Step 3 (later): Test the deployed flat view**

```bash
npm run smoke -- --base=https://<preview-host>/ --settle=20000 --out=screenshots/preview.png
```
Expected: `SMOKE PASSED`. If this machine cannot reach the host, give the owner
`https://<preview-host>/flat.html` and `https://<preview-host>/` to open.

---

### Task 10: Final verification and report

**Files:** none.

- [ ] **Step 1: Run everything once more from a clean build**

```bash
rm -rf dist
npm run typecheck && npm run check && npm run build && npm run smoke -- --settle=12000
git status --short
```
Expected: `all 10 checks passed`, `✓ built in`, `SMOKE PASSED`, and an empty `git status`.

Then push: `git push -u origin HEAD` (retry a network failure up to four times,
waiting 2, 4, 8 and 16 seconds).

- [ ] **Step 2: Measure**

```bash
du -sh .git public/assets public/data dist | cat
git count-objects -vH | grep size-pack
```

- [ ] **Step 3: Report to the owner**

Give, in this order:

1. Which tasks passed, and any that did not, with the failing output.
2. The four sizes from Step 2.
3. That deployment (Task 9) was skipped as instructed.
4. Anything that differed from "Expected" (for example a different `three` version,
   or `assetsDir` removed).
5. The open items from the design's section 9. Do not ask for the Claude key: no step
   here uses it.

Then stop. M1 is planned separately.

---

## Self-review notes

- **Coverage.** Design §7's M0 outcome is "repo builds; copied code runs in a browser
  from baked data; assets built": Tasks 1–4 build, 5 bakes, 6 builds assets, 7 proves
  the run. Deployment (Task 9) is deferred by the owner. Brand-name removal (design §1) is checked in
  Tasks 3 and 6. The legibility evidence (design §6) is the screenshot from Task 7.
- **Verified ahead of time**, in a scratch copy with the same dependency versions:
  the copy and patches, the ten checks, the Vite build of the copied code against
  `super-three@0.185.0` with one copy of three.js, baking, the asset build and its
  sizes, and all three smoke runs.
- **Review pass (second).** Changes from re-reading the plan against the tools and
  IWSDK's shipped guidance: the generator version is pinned; the feature flags are
  checked after scaffolding; the smoke test no longer depends on the build tool's
  preview server, which the scaffold's plugin could have altered; the scaffold's
  "start implementing" guidance is explicitly outranked; import boundaries are
  enforced by `npm run check`; the starting branch is `main`.
- **Keys.** The owner supplies one Claude key later; this plan uses none (rule 7), and
  the project guidance written in Task 8 says how and when to ask.
- **Not verified ahead of time:** Task 1 (the generator), the scaffold's interaction
  with the `vite.config.ts` edit in Task 4. Each has an explicit fallback or a stop
  condition.
