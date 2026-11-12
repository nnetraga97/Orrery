#!/usr/bin/env node
// Builds public/assets/ from a codebase-viz checkout: copies only the files the app loads at run time and shrinks the
// textures inside each model (at most 1024 px, WebP). Geometry, node names and animations are left exactly as they are,
// because the rigs find their joints by name. Blender sources, raw downloads and 4K planet maps are never copied.
// With --tier=quest it writes the headset tier to public/assets-quest/ instead: textures at most 512 px for the kit,
// vehicles and buildings (town content, seen small) and 1024 px elsewhere, and only models and images (the app reads
// the JSON files from public/assets/ either way). It prints the total, and how much loads before a planet is opened.
// Usage: node tools/assets/build-assets.mjs /absolute/path/to/codebase-viz [--max-mb=120] [--tier=quest]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  prune,
  quantize,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source =
  process.argv[2] && path.resolve(process.argv[2], "viewer/assets");
const maxMb = Number(
  process.argv.find((a) => a.startsWith("--max-mb="))?.slice(9) ?? 120,
);
if (!source || !fs.existsSync(path.join(source, "planets/library.json"))) {
  console.error(
    "usage: node tools/assets/build-assets.mjs /absolute/path/to/codebase-viz [--max-mb=120]",
  );
  process.exit(1);
}
const quest = process.argv.includes("--tier=quest");
const out = path.join(repo, quest ? "public/assets-quest" : "public/assets");
/** Town content, loaded only when a planet is opened: the headset tier gives it the smallest textures. */
const LANDED_DIRS = ["kit", "vehicles/road-v1", "buildings"];
/** Also seen small: the island's building sheets, whose dozens of buildings stand on an island a few hand-widths wide. */
const SMALL_DIRS = [...LANDED_DIRS, "island/meshy", "island/trellis"];
const textureSize = (dir) =>
  quest && SMALL_DIRS.some((d) => dir === d || dir.startsWith(d + "/"))
    ? 512
    : 1024;
/** Static models whose geometry the headset tier stores quantized (KHR_mesh_quantization, read by three's GLTFLoader
 * without a decoder): the island's terrain and architecture and the cannon, which the scene uses whole. Quantizing
 * moves a scale onto each mesh's node, so a model qualifies only if the code never sets that node's scale. Not the
 * island's building sheets or parts (sky-island.js sizes each piece with scale.setScalar, which would drop the
 * dequantizing scale and draw it about 3.5 times too large), nor the rigs (animated, found by joint name), nor the town
 * kit and buildings (the town code bakes node transforms into their geometry, which would clamp normalized positions). */
const QUANTIZED = [/^island\/(island-base|architecture)\.glb$/, /^cannon\//];
const quantized = (dir, file) =>
  quest && QUANTIZED.some((re) => re.test(`${dir}/${file}`));
/** Models the headset tier simplifies to about this share of their triangles: the island's generated buildings, dense
 * scans (about 650,000 vertices in all) of buildings a couple of centimetres tall in the room. */
const SIMPLIFIED_DIRS = ["island/meshy", "island/trellis"];
const SIMPLIFY_RATIO = 0.2;
/** The largest change allowed, as a share of each mesh's size: 2% of a 2 cm building is under half a millimetre. */
const SIMPLIFY_ERROR = 0.02;
const simplified = (dir) => quest && SIMPLIFIED_DIRS.includes(dir);
/** The initial download (before a planet is opened) must stay under this on the headset tier. */
const INITIAL_MB = 40;

// What the scene code loads, relative to viewer/assets. A directory is copied whole unless `only` filters its files.
const INCLUDE = [
  {
    dir: "planets",
    only: (f) => !/(^|\/)(close|tripo)\//.test(f) && !/\.md$/.test(f),
  },
  {
    dir: "island",
    only: (f) =>
      /^(island-base\.glb|architecture\.glb|parts\.glb|layout\.json)$/.test(f),
  },
  { dir: "island/meshy", only: (f) => /^landmarks-[a-z]\.glb$/.test(f) },
  { dir: "island/trellis", only: (f) => /^houses-\d+\.glb$/.test(f) },
  { dir: "cannon/meshy", only: (f) => /\.glb$/.test(f) },
  { dir: "rigged", only: (f) => /\.glb$/.test(f) },
  { dir: "buildings", only: (f) => /^([a-z]+)\/\1\.glb$/.test(f) },
  { dir: "kit", only: (f) => /\.(glb|png)$/.test(f) },
  { dir: "vehicles/road-v1", only: (f) => /\.glb$/.test(f) },
];

// Two ship rigs were named after car brands. They are published under neutral names; tools/migrate/apply-patches.mjs
// renames the same keys in the code.
const RENAMED_KEYS = { bugatti: "arc", aventador: "arrow" };
const publishedPath = (file) =>
  file.replace(/\b(bugatti|aventador)\b/g, (word) => RENAMED_KEYS[word]);

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    );

/** Dark caps (`*_Backing`) meant to hide the cut behind a moving part. In these three lots they are larger than the
 * part and show from every side: a slab wider than the barrels' base, four walls through the crater's rim, a slab
 * through the gate (docs/reviews/asset-review). They are removed; the caps in block, house and tower sit hidden behind
 * their doors and stay. */
const REMOVED_NODES = {
  "buildings/barrels/barrels.glb": ["SM_Drum_Tray_Backing"],
  "buildings/crater/crater.glb": [
    "SM_Rim_Back_Backing",
    "SM_Rim_Front_Backing",
    "SM_Rim_Left_Backing",
    "SM_Rim_Right_Backing",
  ],
  "buildings/gate/gate.glb": ["SM_Lintel_Backing"],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function shrinkModel(
  from,
  to,
  size = 1024,
  quantizeGeometry = false,
  simplifyGeometry = false,
  removed = [],
) {
  const document = await io.read(from);
  for (const name of removed) {
    const node = document
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name);
    if (!node) throw new Error(`expected node ${name} to remove`);
    node.getMesh()?.dispose();
    node.dispose();
  }
  if (removed.length) await document.transform(prune());
  // Two models carry a car brand in their node, image and scene names. The code finds joints by their Joint_/CTRL_
  // prefixes and never by these names, so they are renamed in the published file.
  const root = document.getRoot();
  for (const property of [
    ...root.listNodes(),
    ...root.listTextures(),
    ...root.listScenes(),
    ...root.listMeshes(),
    ...root.listMaterials(),
  ]) {
    const name = property.getName();
    const clean = name
      .replace(/bug+at+i/gi, "Arc")
      .replace(/aventador/gi, "Arrow");
    if (clean !== name) property.setName(clean);
  }
  await document.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [size, size],
      quality: 82,
    }),
  );
  if (simplifyGeometry) {
    await MeshoptSimplifier.ready;
    await document.transform(
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: SIMPLIFY_RATIO,
        error: SIMPLIFY_ERROR,
      }),
    );
  }
  if (quantizeGeometry) await document.transform(quantize());
  await io.write(to, document);
}

fs.rmSync(out, { recursive: true, force: true });
let before = 0,
  after = 0,
  initial = 0,
  count = 0;
const failures = [];
for (const { dir, only } of INCLUDE) {
  const base = path.join(source, dir);
  if (!fs.existsSync(base)) {
    failures.push(`missing source directory: viewer/assets/${dir}`);
    continue;
  }
  for (const file of walk(base).filter(only).sort()) {
    // The headset tier holds models and images only; the JSON layouts stay in public/assets.
    if (quest && !/\.(glb|png|jpe?g|webp)$/.test(file)) continue;
    const from = path.join(base, file),
      to = path.join(out, dir, publishedPath(file));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (file.endsWith(".glb")) {
      try {
        await shrinkModel(
          from,
          to,
          textureSize(dir),
          quantized(dir, file),
          simplified(dir),
          REMOVED_NODES[`${dir}/${file}`],
        );
        // Keep the original when shrinking did not help (models that are already small or untextured).
        if (
          fs.statSync(to).size >= fs.statSync(from).size &&
          !REMOVED_NODES[`${dir}/${file}`]
        )
          fs.copyFileSync(from, to);
      } catch (error) {
        if (REMOVED_NODES[`${dir}/${file}`]) throw error;
        fs.copyFileSync(from, to);
        console.warn(
          `copied without shrinking (${error.message}): ${dir}/${file}`,
        );
      }
    } else fs.copyFileSync(from, to);
    before += fs.statSync(from).size;
    after += fs.statSync(to).size;
    if (!LANDED_DIRS.some((d) => dir === d || dir.startsWith(d + "/")))
      initial += fs.statSync(to).size;
    count++;
  }
}
const mb = (bytes) => (bytes / 1048576).toFixed(1);
const outName = path.relative(repo, out);
console.log(
  `${count} files: ${mb(before)} MB in codebase-viz -> ${mb(after)} MB in ${outName}`,
);
// An upper bound: not every file outside the town folders loads before a planet is opened (the island loads only the
// building sheets it uses, the planets only their kinds). The browser's resource timing is the measure that counts
// (docs/migration/m1-notes.md, "Headset tier").
console.log(
  `At most ${mb(initial)} MB could load before a planet is opened (everything but ${LANDED_DIRS.join(", ")}); the budget for what does is ${INITIAL_MB} MB`,
);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
if (after / 1048576 > maxMb) {
  console.error(`${outName} is ${mb(after)} MB, over the ${maxMb} MB budget.`);
  process.exit(1);
}
