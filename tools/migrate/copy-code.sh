#!/usr/bin/env bash
# Copies the reusable code from a codebase-viz checkout into this repository, keeping the original relative layout
# under galaxy/ so the copied modules' relative imports keep resolving. Idempotent: re-running overwrites the copies.
# Usage: tools/migrate/copy-code.sh /absolute/path/to/codebase-viz
set -euo pipefail
SRC="${1:?usage: copy-code.sh /absolute/path/to/codebase-viz}"
DST="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$SRC/viewer/scene/scene3d.js" ] || { echo "not a codebase-viz checkout: $SRC" >&2; exit 1; }

copy_dir() { # copy_dir <relative source dir> <destination dir>
  rm -rf "$DST/$2"
  mkdir -p "$(dirname "$DST/$2")"
  cp -R "$SRC/$1" "$DST/$2"
}
copy_file() { # copy_file <relative source file> <destination file>
  mkdir -p "$(dirname "$DST/$2")"
  cp "$SRC/$1" "$DST/$2"
}

# 1. Scene code that runs in the browser (plain JavaScript ES modules).
for d in scene galaxy planet towns traffic agents debug shared; do copy_dir "viewer/$d" "galaxy/viewer/$d"; done
copy_file viewer/country/country-road-scale.js galaxy/viewer/country/country-road-scale.js
copy_file viewer/country/country-layers.js galaxy/viewer/country/country-layers.js
copy_file viewer/assets/planets/library.json galaxy/viewer/assets/planets/library.json

# 2. The parts of the desktop shell the scene code needs: state, graph preparation and layout memory.
for f in state.ts graph.ts types.ts snapshot-diff.ts galaxy-memory.ts; do copy_file "viewer/app/$f" "galaxy/viewer/app/$f"; done

# 3. Source models (shared by the analyzer and the browser). The tree-sitter WebAssembly runtime is left behind.
copy_dir source-model galaxy/source-model
rm -rf "$DST/galaxy/source-model/vendor"

# 4. The analyzer that bakes datasets (Node only).
copy_dir engine/analyzer galaxy/engine/analyzer
copy_dir engine/shared galaxy/engine/shared

# 5. Offline checks that cover the copied code and run without the desktop app.
rm -rf "$DST/galaxy/checks"
for f in call-routes camera-input galaxy-layout incremental-analysis layout-identity layout-memory planet-appearance \
  scene-picking source-index town-revision; do
  copy_file "checks/$f.mjs" "galaxy/checks/$f.mjs"
done

# 6. Read-only reference for later milestones. Nothing may import from reference/.
copy_dir engine/agent reference/desktop-app/engine/agent
copy_dir engine/debug reference/desktop-app/engine/debug
copy_dir viewer/app reference/desktop-app/viewer/app
copy_dir viewer/styles reference/desktop-app/viewer/styles
copy_file viewer/index.html reference/desktop-app/viewer/index.html
for f in nemotron-chat.cjs claude-chat.cjs codex-chat.cjs agent-show.cjs; do copy_file "desktop/$f" "reference/desktop-app/desktop/$f"; done
copy_dir docs reference/desktop-app/docs
rm -rf "$DST/reference/desktop-app/docs/design/references" "$DST/reference/desktop-app/docs/releases"
find "$DST/reference/desktop-app/docs" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' -o -name '*.heic' \) -delete

git -C "$SRC" rev-parse HEAD > "$DST/galaxy/SOURCE_COMMIT"
echo "Copied from codebase-viz at $(cat "$DST/galaxy/SOURCE_COMMIT")"
node "$DST/tools/migrate/apply-patches.mjs"
