# Colour migration

Implemented for three.js r186; visual tuning in the actual Electron window is pending. No Electron launch, GPU shader compilation, screenshot comparison or brightness/hue match is claimed from this environment. Geometry, layout and interactions are unchanged; `viewer/towns/towns.js`, `engine/` and `source-model/` are untouched. Changes are intentionally uncommitted.

## Pipeline and calibration

`viewer/scene/color-space.js` runs before application/worker palette creation. Hex/CSS colours decode from sRGB through `THREE.Color`; shading and physical light accumulation use Linear-sRGB. The renderer uses `SRGBColorSpace` and `AgXToneMapping`.

All migration tuning is in the exported `COLOR` object:

| Setting | Value | Intent |
| --- | --- | --- |
| `exposure` | `1` | Neutral AgX exposure pending visual comparison. |
| `environmentIntensity` | `1` | PMREM radiance strength, shared with landed planets. |
| `lightScale` | `Math.PI` | Retains the existing light-unit conversion; every light uses `legacyIntensity`. |
| `hemisphereIntensity` | `0.65` | Reduced from `0.85` to leave room for environment fill (physical level about 2.042). |
| `directionalIntensity` | `0.85` | Retains the existing sun level (physical level about 2.670). |
| `planHemisphereIntensity` | `2.4 / Math.PI` | Preserves the town-plan inset's physical level of 2.4 at the initial shared scale. |
| `planDirectionalIntensity` | `2 / Math.PI` | Preserves the town-plan inset's physical sun level of 2 at the initial shared scale. |

Albedo/cloud textures and every colour canvas (including sprite glows and selection rings) are tagged sRGB. Normal/roughness maps are explicitly `NoColorSpace`; height, masks and geometry data remain data. GLTFLoader keeps its own albedo/emissive sRGB and normal/roughness/metalness/AO data tags; the legacy overrides in planet, context-district and town-port loading are removed. Other GLB loaders require no changes. CPU albedo samples, including polar-fill uniforms and terrain/shore colours, are decoded before being used as linear colours.

The existing sky implementation reads a cube render target back into CPU-cached faces, then creates a per-view CubeTexture. Its procedural display palette now decodes to linear radiance before baking; the render target, half-float cached faces and final cubemap are explicitly Linear-sRGB. Half-float storage avoids quantizing the dark nebula into 8-bit linear steps. Neither AgX nor display encoding is baked into it. `scene3d` generates one PMREM per view, including views that retain a solid background; `makePlanetHost` borrows the main scene's environment and intensity. The PMREM generator is disposed after generation, and its output target and sky are disposed with the view. The town-plan inset retains its independent lighting.

The fading detail target is half-float Linear-sRGB. Its source render receives neither display tone mapping nor output encoding. The blend pass unpremultiplies source coverage, applies opacity to alpha, then applies AgX and sRGB once with normal alpha blending. The fully opaque inset still draws directly. Compare fade endpoints during review.

These contracts follow the [three.js colour-management guidance](https://threejs.org/manual/pages/color-management.html) and [material tone-mapping rules](https://threejs.org/docs/pages/Material.html).

## Custom shader decisions

Every custom colour shader below ends with `tonemapping_fragment` followed by `colorspace_fragment`. There are eight ShaderMaterial constructors and no RawShaderMaterial constructors outside vendor code. `toneMapped: false` disables only the tone curve; output conversion remains present. Hex uniform values use `THREE.Color`'s automatic sRGB decode; numeric display palettes are explicitly decoded. Dusk and bounce-light multipliers remain linear shading factors.

| Shader | Tone mapping | Colour decision |
| --- | --- | --- |
| `planet-library.js` — `atmosphereMaterial` | Disabled | Additive analytic limb glow; hue is a linear `THREE.Color` uniform, with output encoding. |
| `constellation-orbits.js` — `diskMaterial` | Disabled | Additive accretion glow; hex tint and warm numeric display tint both decode to linear. |
| `context-district.js` — `strand` | Disabled | Unlit energy ring, braided strands and additive halos share linear tint uniforms and output conversion. |
| `sky-island.js` — `channelMaterial` | Disabled | Keeps the existing unlit energy-channel decision; ENERGY's numeric display colour explicitly decodes to linear. |
| `sky-island.js` — `waterfall` | Enabled | AgX for the water sheet; its blue-white display palette decodes before linear mixing. |
| `galaxy-sky.js` — `nebula` | Disabled | Bake linear radiance; colour-space chunk is identity when rendering to the linear target. Display sky gets AgX/sRGB later through the built-in background shader. |
| `galaxy-sky.js` — `starMaterial` | Disabled | Decode star display RGB before additive accumulation into the same linear target. |
| `app/scene3d.js` — `blendMaterial` | Enabled | Convert linear HDR inset colour to display once, after undoing premultiplied coverage; opacity affects alpha rather than exposure. |

The `onBeforeCompile` hooks in planet-library, planet-appearance, sky-island, asteroids, lot-motion, cannon-rig, road-ribbon and country-road-scale extend built-in materials and retain their built-in tone-mapping/output chunks. They do not implement separate display transforms.

## Expected visual shifts and review

- Textured planets, painted GLBs, cloud layers and saturated building colours: correct sRGB decoding changes midtones and the relationship between texture paint, palette colours and physical lighting. AgX compresses highlights and can reduce saturation.
- Dark hemispheres, metallic machinery, town ports and island undersides: new environment reflections/fill combine with lower hemisphere light. Town ports lose the old legacy-only emissive paint and vertex-colour re-encoding. Check their distant LOD and night-side readability.
- Island energy channels, waterfalls, atmosphere limbs, context rings and black-hole disks: linear mixing and sRGB output can change halo width, saturation and apparent intensity even when tone mapping is disabled.
- Sky: display-palette decoding preserves the intended dark starting palette, but linear additive stars, AgX and PMREM filtering change the final sky and reflections. Half-float storage doubles cached face pixel memory relative to RGBA8 (about 48 MiB at 1024-square faces).
- Land/orbit handoff and polar caps: the same environment and decoded ground samples should prevent a new mismatch; compare both sides of the handoff, pole-fill boundaries and shore tints.
- Town-plan fade and selection markers: check partial opacity against the opaque inset, and marker legibility against bright clouds and dark ground.

Tune `COLOR` together after checking island awake/asleep, orbital and landed planets, a populated town, night-side ports, the plan inset and the alternate solid-background views. Overall brightness/hue similarity remains a visual acceptance item.

## Verification

- `npx tsc -p .`: passed.
- `npm run build`: passed; Vite reports the existing browser externalization warning for `node:url` in `source-model/tree-sitter.js`.
- Targeted runtime assertions: renderer configuration, enabled colour management, shared light scaling and CPU albedo decoding passed.
- Source audit: all eight custom colour shaders have both output chunks in order; no RawShaderMaterial and no remaining `legacyOutput` or legacy GLB colour-space overrides.
- `node scripts/run-checks.mjs`: ran all 37 checks; 30 passed. Failures: `chat-features.cjs` (temporary-path image lookup), `workspace-files.cjs` and `workspace-service.cjs` (native watcher events), `country-roads.mjs` (synthetic network 2059.2 ms over its 2000 ms limit), and `agent-runtime.cjs`, `codex-integration.cjs`, `codex-drones.cjs` (`EMFILE` from native watchers).
- Retrying with a worktree-local `TMPDIR` fixed `chat-features.cjs`; that full retry passed 29/37, retaining watcher/timing failures and adding mock-provider failures in `codex-app-server.cjs` and `claude-chat.cjs` (both passed in the original run). A separate minimal `fs.watch` on the worktree also emitted `EMFILE`, with an open-file limit of 1048576. The full offline suite is therefore **not green** here; no engine/check changes or weakened assertions were made.
- Electron visual review and actual GPU compilation remain unverified, as requested.

## Changed line inventory

Ranges below come from `git diff --unified=0` against HEAD. Current ranges identify added/replacement lines; HEAD ranges identify removed/replaced lines. An `@` entry marks the adjacent anchor for a pure deletion/insertion. The inventory includes every tracked source/doc change; this new report is listed separately in full.

| File | Current lines | HEAD lines |
| --- | --- | --- |
| `docs/design/planet-towns.md` | 168 | 168 |
| `docs/planet-loading.md` | 87–90 | @86 |
| `viewer/scene/scene3d.js` | 5, 41, 48–58, 63–64, 155, 385–387, 394–401, @402, 771–772 | 5, 41, 48–49, 54–55, @145, 375, 382–383, 385, 754 |
| `viewer/scene/color-space.js` | 1, 4, 6–15, 17–22 | 1–3, 6, 8–9, 11–12 |
| `viewer/galaxy/constellation.js` | 86, 90–91, 96 | 86, @89, @93 |
| `viewer/agents/context-district.js` | @118, 222, 247–248 | 119–125, @228, @252 |
| `viewer/scene/galaxy-sky.js` | 12–17, 22, 69–72, 113, 128–130, 137, 157–164, 166–167 | 12, @16, 63, @103, 118, 125, 145, @146 |
| `viewer/galaxy/planet-library.js` | 50–51, 56, 62, 215, @290 | @49, @53, 59–61, 214, 290–291 |
| `viewer/planet/planet-terrain.js` | 145, 484, 487 | 145, 484, 487 |
| `viewer/planet/planet.js` | 35–36 | @34 |
| `viewer/agents/sky-island.js` | 19, 154–155, 181–183 | 19, @153, 179 |
| `viewer/scene/textures.js` | 8–10, 32–34 | 8, 30 |
| `viewer/towns/town-plan.js` | 3, 65–66 | @2, 64–65 |
| `viewer/towns/town-port-rig.js` | @47, @82, 85, @194 | 48–49, 85–97, 100–110, 220–221 |
| `docs/design/colour-migration.md` | 1–87 | New file |
