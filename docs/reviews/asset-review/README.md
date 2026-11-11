# Asset review: look, feel and quality

Date: 2026-11-11. Scope: every model under `public/assets/`, judged on look and build quality only (not triangles or
budget; those are in `docs/migration/m1-notes.md`, "Draw budget"). Two independent passes were made on the same renders,
the second by a separate reviewer given the images and the app's context but not the first pass's conclusions. They
agree on almost everything; the differences are listed at the end.

Nothing has been changed yet. This page is the plan to pick up from.

## How to reproduce the images

```
node tools/asset-review/inspect-models.mjs public/assets/buildings/*/*.glb       # parts, lod, backing pieces, clips
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/asset-review/render-models.mjs \
  --out=screenshots/asset-review --mode=hero buildings/gate/gate.glb               # also --mode=grid|close, --wire, --lod
```

Renders are studio-lit (neutral room environment, ACES), not the app's lighting. Scene shots come from the built flat
view (`flat.html?dataset=editor-core&land=core/range.ts`, about 300 s to settle under software rendering) and the XR
page in a browser tab. Note: the town lots and context-district models carry a distant mesh (`extras.lod`) inside the
same file. `render-models.mjs` hides it by default; the `sheet-main-*` and `pair-*` images below were made before that
fix and draw both meshes on top of each other. The `nolod-*` images re-render the lots without it and show the same
defects, so the findings hold.

## Images

| File | What |
| --- | --- |
| `img/pair-00.jpg` … `img/pair-18.jpg` | Two models per sheet: left a full 3/4 view, right a close-up of the same model |
| `img/pair-kit.jpg` | Samples of the low-poly town kit |
| `img/sheet-main-00.jpg` … `08` | Every model from front, 3/4, side and high 3/4 |
| `img/sheet-wire-00.jpg` | Wireframes of the dense scans |
| `img/nolod-cmp1.jpg`, `img/nolod-cmp2.jpg` | Lots re-rendered with their distant mesh hidden |
| `img/scene-f1-landed.jpg`, `img/scene-f4-orbit-high.jpg` | Landed on `core/range.ts`, flat view |
| `img/scene-g-ship-a.jpg` | The context district behind the globe, flat view |
| `img/scene-07-landed-close.jpg` | The XR page in a browser tab |

Sheet contents: pair-00 barrels, block · 01 constructor, crater · 02 gate, house · 03 interface, network · 04 plant,
relay · 05 tower, cannon · 06 island architecture, island base · 07 landmarks a, b · 08 landmarks c, arc · 09 arc-lod,
arrow · 10 arrow-lod, cargo · 11 cargo-lod, archive · 12 compaction, instructions · 13 knowledge, registry ·
14 standby, factory · 15 factory-lod, satellite · 16 terminal moon, town port · 17 courier, hauler ·
18 interceptor, utility.

## Overall verdict

There is no single art direction. The scene mixes:

1. **Image-to-3D scans** (all town lots, road vehicles, factory, context district, cannon, town port, terminal moon,
   ships): white, teal and mustard sci-fi industrial. A recognisable family, but the textures are smeared, edges look
   melted, lighting is painted into the colour, whites are blown out, and the meshes are triangle soup
   (`sheet-wire-00`).
2. **Storybook Mediterranean** (island base and landmark sheets): ivory walls, terracotta and teal domes, cypresses.
   The best-textured work in the set, but it belongs to a fantasy game.
3. **Flat-shaded low-poly kit** (town kit, cars, trees, space props): clean and readable at any size, but toy-like and
   untextured next to the scans.
4. **Clean geometric pieces**: the satellite dish, `island/architecture`, vehicle wheels.
5. **Photographic planets** in the scene.

None of these is the app's own look (`docs/visual-style.md`: cool cyan light on dark glass).

**In the scene** (`scene-f1-landed`, `scene-f4-orbit-high`) the scanned lots shrink to grey-white lumps. Their teal and
yellow are lost and lot types are hard to tell apart. The kit trees on the horizon are taller than the buildings and
in another style. The flat vector roads are the crispest, most on-style thing in view.

**What survives at that size is silhouette, not surface.** The models that work have a bold shape: the cannon's
glowing eye, the tower, the network spire, the constructor crane, the town port's three lobes, the satellite dish.
The ones that fail depend on texture detail the scans cannot hold.

## Per model

| Model | Works | Wrong (visible) | Verdict |
| --- | --- | --- | --- |
| `buildings/barrels` | Three drums on a cradle reads | Dark slab `SM_Drum_Tray_Backing` sticks out past the base; drums smeared (pair-00) | fix (remove slab) or replace |
| `buildings/block` | Small-building silhouette, fan, yellow band | Melted parapet, loose chips floating on the roof, iridescent noise (pair-00) | fix / replace |
| `buildings/constructor` | Crane is the most readable lot shape | Crane texture is mush, faceted lattice, moiré windows (pair-01) | keep shape, retexture |
| `buildings/crater` | Concept | Four tall dark panels `SM_Rim_*_Backing` box the ring in every view; rainbow noise (pair-01) | replace |
| `buildings/gate` | Portal shape | Dark slab `SM_Lintel_Backing` floats through the frame; waxy yellow parts (pair-02) | fix (slab) / retexture |
| `buildings/house` | Chunky mass, red beacons | Roof blown out to flat white, wobbly panels, broken roof hatches (pair-02) | fix / replace |
| `buildings/interface` | Tall slab | Worst texture in the set: vertical smear over the whole facade (pair-03) | replace |
| `buildings/network` | Best lot: spire, pipe, dish | Crown of needle spikes reads as shattered glass (pair-03) | keep, trim spikes |
| `buildings/plant` | Flywheel and tanks read at hero size | Pipes and valves are lumpy blobs close up (pair-04) | fix / replace |
| `buildings/relay` | Arch silhouette | Truss is jagged triangle noise; smudged windows (pair-04) | replace |
| `buildings/tower` | Clean rings, teal core; best-modelled lot | Cables look like rope (pair-05) | keep |
| `cannon/meshy/agent-cannon` | Strong hero: glowing eye, clear turret (pair-05) | Soft detail; white texture rather than the cyan-light language | keep; add emissive cyan trims |
| `island/island-base` | Rich terraces, good mass (pair-06) | Moss and vines read as noisy green clumps; odd gold ring feet | keep only if the storybook style is kept |
| `island/architecture` | Rings and market stalls | Looks like a placeholder: tiny 128 px tiling texture, gaps between blocks, stray props hanging below (pair-06) | replace |
| `island/meshy/landmarks-a,b,c` | Most polished models in the set (pair-07, pair-08) | Different genre; the pergola and lattice tower are fussy at small size | keep if storybook |
| `island/trellis/houses-1,2`, `island/parts` | — | Too small on the sheets to judge | not judged |
| `rigged/arc`, `rigged/arrow` | Smooth hull; aggressive silhouette | **Real brands.** Both were keyed by car brand names in the source repo (`tools/migrate/apply-patches.mjs:239`) and are still those cars' shapes; smeared paint (pair-08, pair-09) | replace |
| `rigged/cargo` | Most readable ship | Reads as a classic two-tone camper van (pair-10) | replace or restyle |
| `rigged/*-lod` (what the headset shows) | — | Shattered shards, a floating wing, a crushed box (pair-09, 10, 11) | replace |
| `rigged/context-district/*` (6) | Shared ring-on-pylons crown; tidy stepped masses | Frosted look (white blotches, grey streaks); the six bodies look alike (pair-11 to 14) | fix: give each a distinct colour and glow |
| `rigged/factory` | Busy industrial teal and yellow (pair-14) | Smeared trims, heavy baked shading | keep / retexture |
| `rigged/factory-lod` | — | Texture collapses into pastel blotches (pair-15) | replace |
| `rigged/satellite` | Clean, attractive dish (pair-15) | Two styles in one model: crisp dish on a grimy scanned body | fix: restyle the body |
| `rigged/terminal-moon` | Crater relief convincing; outpost reads (pair-16) | Grey cobweb highlight pattern; tone differs from the white-teal family | keep |
| `rigged/town-port` | Clean three-lobed plan; reads as the town hall (pair-16) | Slightly soft | keep |
| `vehicles/road-v1/*` (4) | Fun designs; palette matches the lots (pair-17, 18) | Clean wheels on long legs look spidery; smeared bodies; specks in the scene | keep (off on the headset) |
| `kit/*` | Coherent, clean, readable (pair-kit) | Clashes with the scans; trees far too large in the scene | keep as the basis of a unified style |
| Planets (scene) | — | Photographic; clash with stylised towns and the hologram UI | restyle if time allows |

## Animation and rigging

- **No skinned meshes anywhere.** Moving parts hang from named control nodes (`CTRL_*`), which is the right setup for
  machines.
- **Clips are well named** and loop in 2–8 s: Hover, Docking, Boarding, Relay scan, `AN_Cannon_Demo`.
- **Town lots move through extras** (`hinge`, `slide`, `spin`, `swing`) read by `galaxy/viewer/towns/lot-motion.js`.
  A replacement lot needs those extras or it stands still.
- **Moving parts are cut out of fused scans, and the cuts are hidden with dark `*_Backing` caps.** That is where the
  slabs in barrels, crater and gate come from, and a moving part opens a dark void. Expect the same behind the cargo
  ship's sliding doors.
- **Context-district and town-port motions are too small to see** from the seat: trays, doors and clamps move 0.02–0.05
  units on models about 1 unit across.

## Top changes, ranked

1. **Replace `arc`, `arrow` and `cargo` and all three `-lod` versions** with original, simple craft. Recoloured
   `kit/space/craft_*` ships are a stopgap already in the repo.
2. **One style for the planet surface.** Flat-colour stylised shapes from a small palette, tinted to the app's tokens
   with cyan emissive trims, read far better at a few centimetres than scans. Keep tower, network, constructor and
   town port as shape references.
3. **Remove the backing slabs** from barrels, crater and gate, and check every other `*_Backing` cap. These are the
   most obviously broken things a judge would see.
4. **Fix scale in the scene.** Kit trees shorter than the lots; town port about 1.5 lots wide, not 2–3.
5. **Decide the island's genre and make every piece match it.** Remake `island/architecture` at the same finish as the
   base. Give the six context-district buildings distinct colours and glows.

## The free village pack

`docs/visual-style.md` says "The competition requires original work and forbids commercial artwork." **Check the
competition rules before using any marketplace pack, free or not.** If it is allowed:

- **Where it helps:** the planet towns (house, mill, well, gate and market map naturally onto statement types),
  trees and props (replacing the oversized kit trees), or the storybook island.
- **Where it hurts:** next to the sci-fi hero objects (cannon, terminal moon, satellite, town port), unless it
  replaces a whole layer. Adding it beside the kit and the remaining scans would make a sixth style.
- **Practical points:**
  - Prefer a flat-coloured pack with a palette texture; it retints into the app's palette trivially.
  - Check for signage or logos with real names, and rename files to neutral names.
  - Some marketplace packs are licensed for one engine only.

## Where the two reviews differed

- **`cargo`:** the first pass says replace; the second calls it the most readable ship and would restyle it.
- **`island/architecture`:** the first pass kept it; the second showed it is placeholder quality. The second is right.
- **Satellite:** only the second pass noticed the crisp dish on a grimy body.
- **Planets:** only the second pass judged them, and would restyle them.
