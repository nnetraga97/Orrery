# Industrial building briefs

These are authoring briefs, not generated assets. Lineup concept images were generated on 2026-10-19 (`references/building-lineup-v1.png`, `references/building-lineup-v2/`); no Tripo or 3D job has been submitted for this sheet. The roles are the keys of `BUILDING_TYPES` and `INDUSTRIAL_STYLES` in `viewer/towns/industrial-kit.js`; the kit props used by `viewer/towns/towns.js` are included below.

## Style sheet (agreed 2026-10-18)

Towns are compact settlements, and a building is a few dozen pixels across at landing distance. What reads at that size is silhouette, roof shape and colour, so the family is designed around those. Motion is reserved for state, and it is large.

- **Silhouette first.** Each role has one shape that can be told apart from above at a glance: a silo, a dish, an arch, a sunken bowl. Fine detail is for close inspection only and must never be what tells two roles apart.
- **One family.** Teal painted steel, warm ivory panels, ochre accents, concrete footings and dark recessed glazing. The same roof language, plinth height and material atlas across every role. No text or logos. (Surface detail now follows the detail-level decision below.)
- **Whole-building transformation for state.** A building is built from 2–6 large rigid parts, and changing state moves those parts: it rises, unfolds, opens, rotates or telescopes. There are no small moving parts.
  - **Idle:** the resting form, completely still.
  - **Active** (in the diff, hit by an agent, at a breakpoint or the paused position): the building transforms into its expanded form over 0.6–1.2 s.
  - **Hot** (repeated hits): the expanded form loops its large motion, slowly cooling back to idle.
- **Readable when paused (I-9).** A selected or paused building holds its expanded pose without looping. Motion never carries a selected target out of view. Picking bounds and evidence markers use the expanded envelope.
- **Detail level (2026-10-19).** The user rejected the simplified lineup (`references/building-lineup-v2/`) as too simple and blocky, and prefers the detailed 2026-10-12 concepts. The four generated buildings (tower, house, block, plant), the data store concept and the `office` factory stay as they are. New roles match their detail level and are generated with them as style references; each still keeps the silhouette and large transformation listed below.
- **Motion element and storeys (2026-10-19).** Every building has a clearly separate moving part that reads even in a still image. Several storeys are fine.
- **Skyscrapers (2026-10-19).** `network`, `interface` and `constructor` become slender skyscrapers on their 1×1 lots, about four times as tall as wide. Their Max Y and Expanded Y in the table below are superseded and get set when they are modelled. Their concepts are multi-view sheets (front and back, resting and active), which serve as modelling reference.
- **Order.** First, concepts of the eight roles that have none (network, relay, interface, constructor, gate, crater, barrels, overflow), in the detailed style, on two sheets showing each building resting and active (`references/building-lineup-v3/`). Then 3D for those roles, then the roof fixtures, and town infrastructure last.

## Shared Building contract

Coordinates are metres in the normalized prototype: +Y up, front −Z, origin at the centre of the foundation contact plane Y=0. Keep every vertex at or above the foundation plane except an explicitly separate socket. The footprint includes roof overhangs and every transformed pose. Entrance positions below are XYZ on Y=0, facing −Z unless specified. Max Y is the resting height; Expanded Y is the hard maximum in any pose.

Deliver GLB with named `foundation`, `entrance`, `roof_fixture` sockets, and the transforming parts as separately named nodes with `idle` and `active` poses (and an optional `hot` loop). Tight box picking bounds cover the expanded envelope. LOD0/1/2 of at most 4,000/1,200/250 triangles per main building; LOD2 keeps only the resting silhouette. Share one small sRGB base-colour atlas and linear roughness/normal maps; no emissive animation. Each instance fits the renderer's lot scale, without changing pads or source picking. Leave a clear roof mount for composable return/write/await/throw fixtures. One principal building represents a statement even when it has several effects. Missing assets retain procedural stand-ins.

## Statement buildings

| Role | Tripo brief | Footprint X×Z | Entrance XYZ | Max Y | Transformation (active) | Expanded Y |
|---|---|---|---|---|---|---|
| `office` — outside/unresolved call | Compact teal assembly hall, ivory loading portal and one ochre service gantry. A broad roof socket accepts independent semantic fixtures. | 1×1 | (0,0,−0.5) | 1.1 | Roof splits along its ridge and the gantry swings out past the front edge, reaching toward the outside. | 1.6 |
| `tower` — local call | Squat industrial relay tower with three clearly separated ivory floors, teal steel frame and ochre stair core. Readable at town scale without a needle spire. | 1×1 | (0,0,−0.5) | 1.5 | Telescopes: each floor rises out of the one below and the top floor turns a quarter turn. | 2.4 |
| `plant` — state write | Low teal production factory with two ivory sawtooth roof bays, an ochre intake duct and a front service door. | 1×1 | (0,0,−0.5) | 1.0 | Sawtooth bays lift as one, and the whole hall pumps down and up like a press. | 1.4 |
| `house` — binding | Small ivory utility store with a teal pitched roof, wide front door and one ochre material rack within its footprint. | 1×1 | (0,0,−0.5) | 0.8 | Pitched roof opens like a box lid; the rack slides out of the front. | 1.2 |
| `block` — value operation | Rectangular teal freight depot, ivory rolling door and ochre roof vent; simple uninterrupted silhouette. | 1×1 | (0,0,−0.5) | 0.7 | Depot splits into two blocks that rotate 90° against each other and lock back together. | 1.0 |
| `dataStore` — persistence | Ivory cylindrical storage silo nested in a low teal rectangular equipment base, with ochre pipe couplings. | 1×1 | (0,0,−0.5) | 1.1 | Silo rises out of its base and rotates; the base opens around it. | 1.7 |
| `network` — network | Teal communications exchange with a broad ivory roof dish and ochre feed horn, entirely inside the lot. | 1×1 | (0,0,−0.5) | 1.1 | Dish rises on an extending mast and sweeps a full turn. | 1.8 |
| `relay` — event | Ivory switching cabin with two short teal relay masts and a visible ochre cross-link; no signal effects. | 1×1 | (0,0,−0.5) | 1.0 | The two masts swing together into an arch and back. | 1.5 |
| `interface` — UI | Ivory display pavilion with a recessed dark front facade, heavy teal frame and an ochre sunshade. No screen text. | 1×1 | (0,0,−0.5) | 0.9 | Facade panels fold outward into a wide display wall. | 1.1 |
| `constructor` — construction | Teal fabrication workshop surrounding one ivory open assembly bay and an ochre overhead hoist arm. | 1×1 | (0,0,−0.5) | 1.1 | Walls fold down flat, revealing the bay; the hoist arm swings across. | 1.4 |
| `gate` — return | Freestanding ivory industrial exit arch with teal side housings and an ochre lintel; keep the central passage clear. | 1×0.6 | (0,0,−0.3) | 0.8 | Arch lifts on its side housings; the lintel rotates open. | 1.2 |
| `crater` — throw | Raised, contained industrial rupture bowl with a dark centre, teal broken rim and an ochre warning lip. No geometry cuts below the foundation. | 1×1 | (0,0,−0.5) | 0.35 | Rim plates burst outward like petals and settle back. | 0.6 |
| `barrels` — break/continue | Three stout ivory process drums in a teal containment tray, with an ochre transfer valve; unmistakable low control-transfer prop. | 1×0.7 | (0,0,−0.35) | 0.55 | Tray tilts and the three drums roll across it and back. | 0.8 |
| overflow town | Compact teal archive tower with ivory horizontal bands and an ochre front lift. Leave the statement-count label to the UI; clicking opens the complete flat plan. | 0.5×0.5 | (0,0,−0.25) | 0.7 | Stacked bands rotate in alternate directions, like a combination lock. | 0.9 |

## Composable roof fixtures

These mount at `roof_fixture`, are independently pickable with their owning statement, and never replace the principal building. They ride with the roof when the building transforms and do not move on their own. Each uses the same origin/contact convention, one material atlas, and at most 200 triangles. The entrance value denotes the attachment access side; these props have no human door.

| Role | Tripo brief | Footprint | Attachment access | Max Y |
|---|---|---|---|---|
| `effectReturn` | Ivory exit arrow on a short teal bracket, ochre arrow edge. | 0.3×0.3 | (0,0,−0.15) | 0.35 |
| `effectWrite` | Ochre valve and ivory short pipe elbow on a teal footplate. | 0.3×0.3 | (0,0,−0.15) | 0.3 |
| `effectAwait` | Static ivory two-prong holding fork in a teal yoke, ochre crossbar. No moving timer. | 0.3×0.3 | (0,0,−0.15) | 0.35 |
| `effectThrow` | Ochre split pressure cap in a teal protective cage with an ivory footplate. | 0.3×0.3 | (0,0,−0.15) | 0.3 |

## Town infrastructure

These maintain existing port access and docking sockets, and stay static. Do not generate replacement docking rigs until their socket transforms can be checked against `town-port-rig.js`. Ships, trees, junction signs, selection markers and construction cranes keep their current reusable/procedural implementations.

| Role | Tripo brief | Footprint | Entrance XYZ | Max Y |
|---|---|---|---|---|
| `padSmall` | Ivory landing deck with teal skirt, ochre edge strips and a clear unobstructed centre. | 1×1 | (0,0,−0.5) | 0.15 |
| `padLarge` | Broad ivory spaceport deck with teal service alcoves and ochre perimeter strips; no buildings in the docking circle. | 1×1 | (0,0,−0.5) | 0.18 |
| `hangar` | Low teal workshop hangar with ivory folding door and ochre jambs. | 1×1 | (0,0,−0.5) | 0.65 |
| `hangarLarge` | Double-bay teal cargo hangar, ivory roof and ochre loading lintel. | 1×1 | (0,0,−0.5) | 0.85 |
| `ctrlTower` | Ivory control room on a broad teal pedestal, dark wraparound windows and ochre service ladder. | 0.7×0.7 | (0,0,−0.35) | 1.3 |
| `rocketBase` | Teal launch engine plinth with ivory feet and ochre service connection; centred top stack socket. | 0.6×0.6 | (0,0,−0.3) | 0.4 |
| `rocketFuel` | Ivory cylindrical tank section with teal bands, ochre access panel and centred top/bottom stack sockets. | 0.6×0.6 | (0,0,−0.3) | 0.6 |
| `rocketTop` | Ivory blunt conical fairing, teal collar and ochre seam; centred bottom stack socket. | 0.6×0.6 | (0,0,−0.3) | 0.45 |
| `waterTower` | Ivory water tank on four thick teal legs with an ochre front ladder. | 0.8×0.8 | (0,0,−0.4) | 1.1 |
| `tank` | Low ivory process tank with teal base and ochre inlet manifold. | 1×1 | (0,0,−0.5) | 0.7 |
| `chimney` | Broad teal exhaust stack with an ivory collar and ochre access panel; no smoke in the mesh. | 0.5×0.5 | (0,0,−0.25) | 1.2 |

No monorail station asset is needed: directed call routes replace that system. Review each new asset on a real pad at landing distance, including its flat plan, fixtures, bounds and picking, before replacing its procedural equivalent.
