# Source models and semantic planets

A planet maps one source file. Its geography should explain ownership and relationships; its buildings
should explain what statements do. The shared model keeps that meaning independent of rendering.

## Analysis and evidence

`engine/analyzer/project-model.mjs` creates a TypeScript project snapshot for JavaScript, TypeScript, JSX and TSX
(including `.mjs`, `.cjs`, `.mts` and `.cts`). Both `engine/analyzer/analyze.mjs` and `engine/analyzer/symbols.mjs` use it.
Workspace analysis requests dependency edges and symbols together. Java continues through the separate
legacy parser; this is not a universal language frontend.

Imports come from syntax nodes, including re-exports, type imports, literal dynamic imports and supported
`require` calls. Comments and strings do not create edges. Resolution reads project configuration,
inherited `paths`/`baseUrl`, explicit module maps and discoverable workspace package exports. Only targets
inside the selected analysis scope become graph edges. External, out-of-scope and unresolved references
remain metadata; a non-literal import is explicitly unresolved. The project checker supplies callable
bindings where it can establish them, and navigable targets must have an emitted callable identity.

`source-model/code-model.js` produces a JSON-compatible version 2 source model without compiler nodes:

| Record | Meaning |
| --- | --- |
| File | Source fingerprint, declarations, import-use summaries and analysis diagnostics. |
| Callable | Identity, declaration owner, source span, visibility, calls, state references, operations, roles and control flow. |
| Operation | Identity, kind, source range and evidence for an action such as a call, write, await, return or render. |
| Role | A supported pattern, confidence value and source excerpts/lines that support it. |
| Analysis | Project or syntax mode, binding scope, resolved/unresolved counts, diagnostics and limitations. |

Callable identities use file, owner, name and declaration kind rather than line numbers. Duplicate
implementations receive disambiguation suffixes; overload signatures do not become duplicate executable
towns. A rename or ownership change can change identity. Source offsets and lines remain available for
inspection. Operations retain their own identities so expressions on one line need not collapse together.

Ordinary functions, arrows, function expressions, object methods, callable class properties, accessors,
constructors, unambiguous wrappers and registration callbacks retain executable bodies. Nested callback
bodies become separate flow neighborhoods. Small methods are never combined into an invented accessor.

Recognizers use explicit syntax, imported APIs or unshadowed platform APIs. Current examples include JSX,
React state/lifecycle hooks, supported route registrations/decorators, events, storage/database APIs,
filesystem/network I/O, object construction and delegation. These are bounded source heuristics, not a
claim to understand every design pattern. Unrecognized callables retain a tentative computation role
with an explanation that no supported pattern was established. An unresolved call is not connected to a
same-named method merely because the names match.

Analysis tracks unsupported source extensions, parse/configuration diagnostics and failed files. Files
without executable bodies retain a whole-file region. If a town has no extracted flow, it displays flow
as unavailable rather than manufacturing a declaration or an empty successful analysis.

## Geography

`source-model/semantic-layout.js` creates one region per callable. Class and object owners define districts.
Module functions can share a district when resolved calls or shared state establish a relationship.
Within a district, stronger call/shared-state relationships form bounded neighborhoods; a ubiquitous
backing field does not, by itself, pull every method into one neighborhood. Detected roles can break ties
between already connected methods, but a shared label alone does not create an edge.

District, neighborhood and member anchors are reproducible from identities. Adding unrelated code does
not globally reseed the map by method count or source-length rank.

**Landed planets hash persistent layout keys** (`source-model/layout-identity.js`), not analyzer ids. Galaxy memory stores a key for every file and town:
- **File keys:** a renamed or moved file is matched by identical text, then by identical symbols. It keeps its key, look, orbit and cluster.
- **Town keys:** a renamed method or one moved to another class is matched by its body with the name blanked.
- **Ambiguous matches** get fresh keys.
- **Anchors:** a district or neighborhood is anchored by its oldest member, so a new method never re-anchors existing towns. `viewer/planet/planet-terrain.js` fits a
hierarchical partition around those anchors. Borders, fitted positions and neighborhood membership can
still adapt when the code's relationships or packing needs change; exact coordinates are not guaranteed.

District color communicates ownership/grouping. Region area is a packing budget for statements and
decision junctions, with a sublinear source-span fallback. It does not measure performance, importance or
execution frequency. Water, shoreline and decoration remain visual presentation.

## Buildings and inspection

`viewer/towns/industrial-kit.js` selects the main building from operation evidence. A network call stays a
network building whether it appears as a standalone expression, initializes a variable or is returned.
Static roof fixtures preserve the additional binding/write, return, await and throw effects. Multiple
operations can therefore be represented without letting statement syntax erase the primary action.

`viewer/towns/town-preparation.js` consumes the serialized flow instead of independently reparsing JS/TS. JSON duplicates
objects referenced in both the main flow and neighborhood lists; hydration reconnects statement IDs
before layout adds roads and lots. Picking, source selection and structural traffic then share the same
statement objects. Locally resolved target identities produce transport links; missing targets remain
unknown. Java retains its legacy flow extraction and name/arity matching.

The inspector groups town search by district, searches recognized patterns, explains district membership,
and shows pattern confidence, source evidence, unresolved calls and analysis coverage. Selecting evidence
opens its source line. Building details explain the main structure and roof fixtures.

## Saved snapshots and validation

When landing on an older saved snapshot, or when its source fingerprint changed, `viewer/planet/planet.js` runs
the same source model in the renderer. This explicitly labeled syntax fallback has lexical
bindings and limited relative-module lookup; it does not have project type information. Opening or
reanalyzing a project supplies compiler context. Matching version 2 snapshots reuse their serialized model.

Generate a dependency graph and matching semantic symbols with:

```sh
node engine/analyzer/analyze.mjs example /path/to/project src --symbols --out=/tmp/galaxy-data
```

See [Analyzer commands](analysis.md) for configuration overrides. Offline checks require installed dependencies:

```sh
node checks/semantic-model.mjs
node checks/workspace-scope.cjs
```

The semantic check exercises source forms, shadowing, pattern evidence, identity/layout behavior,
building classification and the workspace compiler/resolver path. Navigation and geometry still
need separate UI checks, including Electron for the primary app. None of the source model, buildings or simulated traffic proves runtime
execution, actual branch outcomes or measured frequency; recorded failure evidence remains distinct.
