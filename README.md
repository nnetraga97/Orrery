# Orrery

A voice-and-hands code editor for Meta Quest. A codebase is a tabletop galaxy; an AI
agent shows you where a bug lives and you review its fix by hand and by voice.

Built for the Meta VR Start Developer Competition 2026. Design: [docs/design.md](docs/design.md).
Current work: [docs/plans/](docs/plans/).

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

`public/assets/` and `public/data/` are generated and committed, so a fresh clone
needs no other repository.

## Layout

| Folder | Contents |
| --- | --- |
| `src/` | The XR app ([structure and import rules](src/README.md)) |
| `galaxy/` | Scene code, source models and analyzer copied from the desktop app ([details](galaxy/README.md)) |
| `reference/` | Read-only desktop code for later work ([details](reference/README.md)) |
| `public/assets/` | Models and maps |
| `public/data/` | Baked datasets: `sample` (tests) and `editor-core` (the demo project) |
| `tools/` | Migration, baking, asset and test scripts |
| `docs/` | Design and plans |
