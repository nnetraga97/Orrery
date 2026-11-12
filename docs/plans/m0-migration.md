# M0 Migration Implementation Plan

> **How to use this plan.** Do the tasks in order, one step at a time. Run each command exactly as written, compare
> its output with "Expected", and tick the step's checkbox (`- [ ]` to `- [x]`) only when it matches. No plugin, skill
> or workflow tool is required. When something does not match, follow rule 8 under "Rules": stop and report.

**Goal:** Turn this repository into a building IWSDK project in which the galaxy code copied from the desktop app runs in a browser from baked data and optimized assets.

**Architecture:** An IWSDK (WebXR) starter is scaffolded at the repository root and left untouched as the future XR entry (`index.html`). The copied scene code lives in `galaxy/` and is proven by a second page, the flat reference view (`flat.html`), which runs the constellation with a mouse, static dataset files and no server. Code, datasets and assets are already committed; this plan adds the project around them.

**Tech Stack:** Node 22, Vite 7, IWSDK 1.1.0-rc.2 (three.js as `super-three@0.185.0`), d3, graphology, glTF-Transform, sharp, Playwright (headless Chromium).

**Design:** `docs/design.md`. Read sections 1, 3 and 4 before starting.

---

## Read this first

### What is already done

The `main` branch already contains, tested:

| Path | What it is |
| --- | --- |
| `galaxy/` | Scene code, source models, analyzer and offline checks copied from the desktop app, with patches applied. See `galaxy/README.md`. |
| `reference/` | Read-only desktop code for later milestones. |
| `public/assets/` | 369 model and map files, 115 MB, already optimized. |
| `public/data/sample/` | A 13-file test dataset. |
| `public/data/editor-core/` | The demo dataset: 229 files of the VS Code editor's text model (MIT licence, source commit in its `manifest.json`). |
| `flat.html`, `src/flat/` | The flat reference view. |
| `src/README.md` | The folder structure for the XR app and its import rules. No XR code exists yet. |
| `tools/setup-after-scaffold.mjs` | Applies this project's settings to a freshly generated IWSDK starter. |
| `tools/run-checks.mjs`, `tools/check-boundaries.mjs` | Offline checks, and the import rules of the code structure. |
| `tools/smoke-flat.mjs` | Serves `dist/`, loads the flat view in headless Chromium, fails on errors, saves a screenshot. |
| `tools/bake-dataset.mjs`, `tools/assets/`, `tools/migrate/`, `tools/copy-runtime.mjs` | How the committed data, assets and copied code were produced. You do not run the first three. |
| `docs/migration/*.png` | What the smoke runs looked like when this plan was written. |

**You do not need any other repository.** Everything the desktop app contributed is
already here.

Your job: scaffold the IWSDK starter, apply the project settings, install
dependencies, and prove that everything builds and runs.

### What was tested, and what was not

This plan was run end to end on Linux against a simulation of the generator's
output, built from the files in its published package with its real dependencies
installed. Typecheck, both page builds, the checks and all three smoke runs passed.

Two things could not be tested and are where to be careful:

- **Running the generator itself** (Task 1, Step 1). Its files and settings are known;
  its command-line behaviour was not exercised.
- **macOS.** The scripts use only Node and portable shell, but were not run on a Mac.

### Time

About forty-five minutes if nothing goes wrong.

### Rules

1. **Do not edit files under `galaxy/` by hand**, except `galaxy/README.md`,
   `galaxy/viewer/app/static-data.js` and `galaxy/viewer/app/project-store.ts`.
2. **Do not change the scripts in `tools/`.** They were tested against these exact
   inputs. If one fails, stop and report (rule 8).
3. **Do not start XR work.** Leave the scaffold's `src/index.ts`, `src/panel.ts`,
   `src/robot.ts` and its scene exactly as generated. The next milestone has its own plan.
4. **Do not edit generated or committed data by hand:** `public/assets/`,
   `public/data/`, `reference/`.
5. **Commit after every task** with the message the task gives. Work on the branch
   `m0-migration`. Do not merge into `main` and do not open a pull request; the owner
   decides that.
6. **This plan outranks the scaffold's guidance.** The generator installs an
   `AGENTS.md` and skills written for starting a new experience. They say to begin
   implementing at once and not to write planning files. Follow this plan instead:
   read that guidance for how IWSDK's tools work, not for what to build.
7. **No task in this plan needs an API key or any other secret.** Do not ask for one,
   do not create `.env` files, and do not call any model API.
8. **Stop and report instead of improvising** when: a command's output does not match
   "Expected"; a script in `tools/` errors or prints `STOPPED`; a permission prompt
   blocks a command and the owner is not there to approve it; or a step would need
   you to edit copied code. Say which task and step, paste the output, and wait.

### Things that will look wrong but are not

| You see | Why | What to do |
| --- | --- | --- |
| `wc -l` prints its number with leading spaces | macOS pads it | Compare the number only. |
| `Module "node:url" has been externalized for browser compatibility` during the build | A parser used only for non-JavaScript languages | Nothing. It is a warning. |
| `(!) Some chunks are larger than 500 kB` during the build | The starter's bundle is large | Nothing. |
| The XR starter page logs a failed load of a `robot` model when offline | The starter fetches its sample robot from a public CDN | Nothing. The robot is removed in the next milestone. |
| The scaffold's `AGENTS.md` says to start building the experience | It is written for new projects | Rule 6: follow this plan. |
| A smoke run with `--land` takes a minute or more | It waits for the planet's towns to finish building | Nothing. It stops as soon as they are done. |

---

## File structure after this plan

```
index.html, vite.config.ts, tsconfig.json, iwsdk.config.json, package.json   IWSDK scaffold (Task 1), adjusted by the setup script
AGENTS.md, CLAUDE.md, .claude/, .agents/, .codex/                              scaffold guidance, with this project's section added
src/index.ts, src/panel.ts, src/robot.ts, ...                                  scaffold starter, untouched
src/flat/, flat.html                                                           flat reference view (exists)
galaxy/, reference/, tools/, docs/, public/assets/, public/data/               exist
public/ui/, public/scenes/, public/audio/                                      scaffold (Task 1)
public/vendor/runtime/typescript.js                                            copied on install, not committed (Task 2)
```

---

### Task 0: Set up the working folder

**Files:** none.

- [ ] **Step 1: Check the tools**

Run: `node -v && npm -v && git --version`
Expected: Node `v22.12.0` or newer in the 22 line, or `v24`. (The generator accepts
`>=20.19.0 <21`, `>=22.12.0 <23` or `>=24`.) If Node is older, install Node 22 first,
for example with `brew install node@22` or `nvm install 22`, and check again.

- [ ] **Step 2: Clone into the empty folder**

The current folder must be empty. Run: `ls -A`
Expected: no output.

Then:
```bash
git clone https://github.com/nnetraga97/orrery.git .
git checkout -b m0-migration
git log --oneline -1
```
Expected: the clone finishes (about 90 MB to download) and you are on a new branch `m0-migration`.

- [ ] **Step 3: Check the contents**

Run:
```bash
ls
ls tools public/data src
find public/assets -type f | wc -l
```
Expected: the first `ls` shows `README.md docs flat.html galaxy public reference src tools`.
`tools` holds `assets bake-dataset.mjs check-boundaries.mjs copy-runtime.mjs migrate run-checks.mjs scaffold setup-after-scaffold.mjs smoke-flat.mjs`;
`public/data` holds `editor-core sample`; `src` holds `README.md flat`. The count is `369`.

---

### Task 1: Scaffold the IWSDK project

**Files:**
- Create (by the generator): `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `iwsdk.config.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.codex/`, `src/index.ts`, `src/panel.ts`, `src/robot.ts`, `src/robot-component.ts`, `src/assets.ts`, `src/components.ts`, `src/vite-env.d.ts`, `src/scene-assets/`, `public/ui/`, `public/audio/`, `public/scenes/main.iwsdk.scene.json`
- Overwritten by the generator, then restored: `README.md`
- Modify (by the setup script): `package.json`, `.gitignore`, `vite.config.ts`, `AGENTS.md`, `index.html`

- [ ] **Step 1: Run the generator into the repository**

Run:
```bash
npm create @iwsdk@1.1.0-rc.2 . -- --yes --force --target vr --no-git --no-locomotion --grabbing --no-physics
```

`.` scaffolds into the current directory. `--force` is required because the directory
is not empty; it overwrites only files the generator itself writes and keeps
everything else. `--no-git` because the repository exists. `--no-locomotion` because
the app is seated and the world moves, not the user.

Expected: it prints the resolved settings (target VR, TypeScript, grabbing on,
locomotion off, physics off), writes files, and installs dependencies. This takes a
few minutes.

- If npm says that version does not exist, use `@iwsdk@latest` and say so in the final report.
- If dependency installation fails on a network error, run `npm install` once more.
- If only a "reference warmup" step fails, continue: it is an optional documentation index.

- [ ] **Step 2: Confirm nothing of ours was touched, and restore the README**

Run:
```bash
git checkout -- README.md
git status --short | grep -v '^??'
```
Expected: no output. (The generator replaces `README.md`; the first command puts ours
back. `git status` then shows only new, untracked files, which the `grep` hides.)

If any line appears, a tracked file was changed. Run `git checkout -- <path>` for it
and note the path in the final report.

- [ ] **Step 3: Apply the project settings**

Run: `node tools/setup-after-scaffold.mjs`
Expected:
```
applied:
  package.json: name and scripts
  .gitignore: screenshots/ and public/vendor/runtime/
  vite.config.ts: two pages, bundles in dist/bundle/
  AGENTS.md: project section
  index.html: title
features: locomotion=false grabbing=true physics=false
```

What it did: named the package `orrery` and added the `check`, `bake`, `assets`,
`smoke` and `postinstall` scripts; ignored two generated folders; made the build
produce `flat.html` beside `index.html` and put bundles in `dist/bundle/` (because
`dist/assets/` is where the models are copied); put this project's rules at the top of
`AGENTS.md`; and set the page title.

If it prints `STOPPED`, do what the message says or report it. Running the script
again is safe.

- [ ] **Step 4: Confirm the pinned versions**

Run: `npm pkg get dependencies.three dependencies.@iwsdk/core overrides.three`
Expected: `three` and `overrides.three` are `npm:super-three@0.185.0`; `@iwsdk/core`
is `1.1.0-rc.2` or newer.

If `three` is a different version, do not change it. Continue, and say so in the
final report.

- [ ] **Step 5: Typecheck the starter**

Run: `npm run typecheck`
Expected: it exits without errors. (Do not build yet: the flat view's dependencies are
installed in Task 2, and the first build is in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Scaffold the IWSDK starter and apply the project settings"
```

---

### Task 2: Add dependencies

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

Expected: each command prints `added N packages` and no `ERR!` lines. Lines about
`npm audit` or deprecated packages are normal; do not run `npm audit fix`.

| Package | Used by |
| --- | --- |
| `d3`, `graphology`, `graphology-communities-louvain` | `galaxy/viewer` (layout, colours, import clusters) |
| `typescript`, `ignore` | The analyzer; `typescript` is also copied for the browser |
| `@gltf-transform/*`, `sharp` | `tools/assets/build-assets.mjs` |

- [ ] **Step 2: Check there is one copy of three.js**

Run: `find node_modules -path '*node_modules/three/package.json' | wc -l`
Expected: `1`.

If it is greater than 1, stop and report: a dependency brought its own three.js,
which breaks the scene code.

- [ ] **Step 3: Copy the browser runtime**

Run: `npm run postinstall && ls public/vendor/runtime`
Expected: `Copied the TypeScript runtime to public/vendor/runtime/.` and then
`typescript.LICENSE  typescript.js`.

(npm runs this script by itself on a plain `npm install`, but not when packages are
named on the command line, as they were in Step 1.)

- [ ] **Step 4: Install the test browser**

Run: `npx playwright install chromium`
Expected: it downloads Chromium, or reports it is already installed.

If the command says `playwright` is not found, run
`npm install --save-dev playwright` and then the command again.

- [ ] **Step 5: Run the offline checks**

Run: `npm run check`
Expected: `import boundaries hold across N files` (N is about 150), ten lines starting
`ok`, then `all 10 checks passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add the galaxy code's dependencies"
```

`public/vendor/runtime/` is ignored and must not appear in `git status`.

---

### Task 3: Verify what was committed is intact

**Files:** none changed.

- [ ] **Step 1: The copied code**

Run:
```bash
cat galaxy/SOURCE_COMMIT
grep -rn "/api/projects" galaxy/viewer galaxy/source-model src | wc -l
grep -rliE "$(echo YnVnYXR0aXxhdmVudGFkb3J8bGFtYm9yZ2hpbmk= | base64 -d)" galaxy/viewer src flat.html public/assets | wc -l
```
Expected: `88c68743e48da7784cb2bb6f5071c8471a48994a`, then `0`, then `0`.

- [ ] **Step 2: The datasets**

Run:
```bash
node -e "for (const n of ['sample','editor-core']) { const m=require('./public/data/'+n+'/manifest.json'); console.log(n, m.files, m.scanDir) }"
ls public/data/editor-core/symbols | wc -l
head -1 public/data/editor-core/LICENSE.txt
```
Expected:
```
sample 13 .
editor-core 229 src/vs/editor/common
```
then `229`, then `MIT License`.

The licence file must stay beside the dataset: the MIT licence requires its notice to
travel with copies of the code. Do not remove copyright headers from the files under
`public/data/editor-core/source/`.

- [ ] **Step 3: The assets**

Run:
```bash
ls public/assets
ls public/assets/rigged
find public/assets -type f | wc -l
find public/assets -type f -size +10M | wc -l
```
Expected:
```
buildings  cannon  island  kit  planets  rigged  vehicles
arc  arrow  cargo  context-district  factory  satellite  terminal-moon  town-port
```
then `369`, then `0`.

No commit: nothing changed.

---

### Task 4: Build both pages and prove the copied code runs

**Files:**
- Modify: `docs/migration/flat-overview.png`, `docs/migration/flat-town.png`, `docs/migration/flat-editor-core.png`

`tools/smoke-flat.mjs` serves `dist/` itself on a free local port, opens `flat.html`
in headless Chromium, waits, and fails on any page error, console error or missing
file. It prints a summary, the list of asset files requested, and `SMOKE PASSED` or
`SMOKE FAILED`.

- [ ] **Step 1: Build**

Run:
```bash
npm run typecheck && npm run build
ls dist/index.html dist/flat.html && ls dist/bundle | head -3
```
Expected: `✓ built in`; both HTML files exist; `dist/bundle/` contains hashed `.js` files.

- [ ] **Step 2: Smoke-test the overview**

Run: `npm run smoke -- --settle=12000 --out=docs/migration/flat-overview.png`
Expected, in the JSON summary: `"files": 13`, `"canvases": 1`, `"webgl": true`,
`"sceneError": false`, and the last line `SMOKE PASSED`. The requested assets include
`assets/cannon/meshy/agent-cannon.glb` and `assets/rigged/arc/arc-lod.glb`.

- [ ] **Step 3: Smoke-test landing on a planet**

Run:
```bash
npm run smoke -- --land=layout-memory.js --line=20 --settle=300000 --size=900x600 --out=docs/migration/flat-town.png
```
Expected: `"landed": true`, `"loading": ""`, `"labels"` above 50, and `SMOKE PASSED`.
It finishes when the planet is ready, usually well under the five-minute limit.

- [ ] **Step 4: Smoke-test the demo dataset**

Run: `npm run smoke -- --dataset=editor-core --settle=25000 --out=docs/migration/flat-editor-core.png`
Expected: `"files": 229` and `SMOKE PASSED`.

- [ ] **Step 5: Look at the three screenshots**

Open the three files in `docs/migration/`.

- Overview: a starfield, a black hole with small planets around it and file-name
  labels (`java.js`, `code-model.js`), and near the middle a station, a satellite and
  a cratered moon.
- Town: a planet with a town on it, the function label `validLayoutMemory`, and a
  label beginning `L20 · Return ·`. With the camera close you also see roads with lane
  markings and small buildings along them.
- Demo dataset: many small systems spread across the view, with group labels such as
  `cursor`, `model`, `languages` and `diff`, and file labels such as `range.ts`.

`git diff --stat docs/migration` will show the files changed: rendering is not
pixel-identical between runs or machines. That is expected. If a screenshot is black,
or shows only stars, stop and report.

- [ ] **Step 6: If a smoke run fails**

Read the lines under `missing files` and `errors`.

| Output | Cause | Fix |
| --- | --- | --- |
| `WebGL is unavailable in this browser; rerun with SMOKE_GL=software` | Headless Chromium did not get a GPU | Put `SMOKE_GL=software` before the command: `SMOKE_GL=software npm run smoke -- ...` |
| `Executable doesn't exist` | The test browser is not installed | Task 2, Step 4. Or set `CHROMIUM_PATH=/path/to/chrome` before the command. |
| `Playwright is not installed` | Neither `playwright` nor `playwright-core` can be found | `npm install --save-dev playwright`, then Task 2, Step 4. |
| `dist/flat.html does not exist` | The build did not produce it | `npm run build`. If it is still missing, run `node tools/setup-after-scaffold.mjs` and build again. |
| `404 /vendor/runtime/typescript.js` | The runtime was not copied | `npm run postinstall`, then `npm run build`. |
| `404 /assets/...` or `404 /data/...` | A committed file is missing from the working tree | `git status`; restore with `git checkout -- public`. If it is still missing, report the path. |
| `Cannot read properties of null` | The scene code looked up a page element that `flat.html` lacks | Report the stack trace. Do not edit `galaxy/`. |

- [ ] **Step 7: Commit**

```bash
git add docs/migration
git commit -m "Record the flat reference view after migration"
```

---

### Task 5: Deploy a preview — DEFERRED, do not do this now

The owner will set up hosting later. Skip this task. The steps stay here so they are
ready when hosting is decided.

- [ ] **Step 1 (later):** Read `.claude/skills/iwsdk-hosting/SKILL.md` and its `references/vercel.md`.
- [ ] **Step 2 (later):** Deploy the branch as a **preview**, with build command
  `npm run build` and output directory `dist`. Do not create accounts or projects
  yourself; the owner links them.
- [ ] **Step 3 (later):** `npm run smoke -- --base=https://<preview-host>/ --settle=20000 --out=screenshots/preview.png`
  Expected: `SMOKE PASSED`.

---

### Task 6: Final verification and report

**Files:** none.

- [ ] **Step 1: Run everything once more from a clean build**

```bash
rm -rf dist
npm run typecheck && npm run check && npm run build && npm run smoke -- --settle=12000
git status --short
```
Expected: `all 10 checks passed`, `✓ built in`, `SMOKE PASSED`, and an empty `git status`.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin m0-migration`
If it fails on a network error, try again up to four times, waiting 2, 4, 8 and 16
seconds. Do not push to `main`.

- [ ] **Step 3: Measure**

```bash
du -sh .git public/assets public/data dist | cat
```

- [ ] **Step 4: Report to the owner**

Give, in this order:

1. Which tasks passed, and any that did not, with the failing output.
2. The branch name and its last commit.
3. The four sizes from Step 3.
4. Anything that differed from "Expected" (for example a different `three` version,
   a generator version other than the pinned one, or `SMOKE_GL` being needed).
5. How the generator behaved in Task 1, since that step could not be tested ahead of time.

Then stop. Do not start the next milestone, do not ask for an API key, and do not
merge.

---

## Notes on how this plan was checked

- **Coverage.** The milestone's outcome in `docs/design.md` §7 is "repo builds; copied
  code runs in a browser from baked data; assets built". Tasks 1 and 2 make it build,
  Task 3 confirms the committed code, data and assets, and Task 4 proves the run.
- **Verified ahead of time**, on Linux, against the generator's published template
  with its real dependencies: the setup script, typecheck, both page builds with the
  IWSDK plugin, one copy of three.js, the offline checks, and all three smoke runs.
- **Not verified ahead of time:** the generator's own command line, and macOS. Both
  have stop conditions or fallbacks in the steps above.
- **Keys.** This plan uses none (rule 7). The project guidance the setup script writes
  says how and when keys are asked for.
