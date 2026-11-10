# Context district production brief

Six imported textured buildings around the command center, in reference-sheet order: conversation archive, instruction complex, knowledge library, tool registry, standby depot, compaction facility. Preserve the existing AI tool buildings, UI, traffic, and town port.

The district belongs on the island's **paved upper ring around the cannon**, between the plaza's surveyed inner and outer radii. Its foundations sit at the paving height. Fit all six complete footprints inside that annulus with clearance around the cannon seat; scale the energy line to their rooftop hoops. Return to cannon frames the whole island, while View context district provides a closer view of the upper ring.

Reference: `references/context-district/context-district-sheet-v1.png`. White layered shells, dark recessed mechanical bays, blue/amber/green/purple/cyan paint, vertical rooftop hoops. The reference energy wisps are a runtime effect, not exported geometry. Original front is Blender -Y; original up is +Z. Camera baseline uses an orthographic front-right elevated view, comparable to the reference.

## Inspected source

One bridge import named `futuristic building 3d model`, 179 rigid mesh parts, 542,937 triangles, with all six buildings in a two-row assembly. The original UVs and packed base-color, normal, metallic, and roughness textures are present. The six hoop interiors are reconstructed solid discs; remove these on working copies and verify unobstructed passages. Other unrelated scenes include the town port and Perilune pad.

Untouched snapshot: `viewer/assets/rigged/context-district/context-district-source.blend`. Do not overwrite the town-port file. The working scene and editable controls are saved separately.

## Texture and mesh budget

Atlas original pixels without resampling: six 1024px material sets, each retaining base color, tangent-space normals, and packed roughness/metallic. Original packed JPEGs are retained separately. Exact decoded-pixel comparisons passed for all 716 maps across 179 source parts (`texture-validation.json`). No generated replacements or new credits. Initial 15–30k triangle estimate is revised to around 42k per building to retain the imported silhouette and paint, with roughly 6k static distant LODs. All cleanup is on copies; original UVs remain in the untouched backup. Working construction meshes have remapped atlas UVs and editable reduction modifiers.

## Rig and behavior

Rigid empty controls with named in-place NLA clips: cartridge trays, sliding doors, registry arms, depot cart, compression lock and rams. Hoops remain static; each has `Hoop_Center` with oriented Blender-local +Z normal through the opening. After Blender's glTF basis conversion, use marker-local +Y (`gltf_normal_axis`) for the passage normal. One continuous app-rendered energy line passes through these markers. No persistent floating labels.

Occupancy uses only aggregate context tokens and the reported optional limit. Category token allocation is unavailable in current provider events; show that explicitly on selection. Tool calls are activity, not evidence of tool-definition token sizes. Standby capabilities are excluded from occupied-context counts. Compaction animation requires a real compaction event; manual mechanism previews are labeled as previews.

## Verified delivery, 2026-10-14

The actual `npm run desktop` window was reloaded and inspected on the codebase-viz project. Return to cannon frames the district; selecting the instruction complex opens its source/usage details and mechanical preview. Project explorer and chat controls remain available. This unsigned-in review profile truthfully displays unavailable context usage.

The isolated Electron check loads all six textured models, measures zero alignment error at the six hoop centers (within floating-point tolerance), selects a building, displays exact synthetic fixture usage, plays a mechanical preview, handles an explicit compaction event, and rebuilds/disposes the district without renderer errors. Fixture values are verification inputs and are not shown as production telemetry. Existing Electron chat/composer and town-port traffic checks passed. Build, TypeScript, seven targeted offline checks, and whitespace validation passed.

Screenshots: `screenshots/context-district-desktop.png` and `screenshots/context-district-selection.png`. Asset editing/export details: `viewer/assets/rigged/context-district/README.md`.
