# Analyzer commands

Electron analyzes opened folders through the workspace service, which runs these
commands in child processes. Run them directly to inspect or debug an analysis.
Install repository dependencies first with `npm install`; no separate TypeScript
checkout is required.

## JavaScript and TypeScript

```sh
node engine/analyzer/analyze.mjs example /path/to/project src --symbols --out=/tmp/galaxy-data
```

This writes `example.js` (the graph and its overview) and `example.symbols/` (one JSON shard
per file) into the `--out` directory from one project snapshot. Graph records include dependency-resolution and coverage diagnostics.
The analyzer reads project configuration, inherited path aliases and discoverable
workspace package exports. Only in-scope targets become graph edges.

The full graph command accepts explicit configuration and an optional module map:

```sh
node engine/analyzer/analyze.mjs <name> <repoRoot> <scanDir> [tsconfig.json or -] [module-map.json] --symbols --out=<dir>
```

`engine/analyzer/symbols.mjs` writes only the symbols, with an optional TypeScript module path and module map:

```sh
node engine/analyzer/symbols.mjs <name> <scanDir> [typescript module path or -] [module-map.json] --out=<dir>
```

Use `--scope-root=<repoRoot>` and `--tsconfig=<path>` when a subdirectory needs
explicit project context.

Dependencies, build/cache directories, ignore rules and service output are
excluded consistently by `engine/shared/scope.cjs`. `.galaxyignore` adds project rules;
excluded parents must be included before their children. Unsupported extensions
and unresolved references remain diagnostics rather than fabricated graph nodes.

See [Source models and semantic planets](semantic-planets.md) for recognized
callables, operations, pattern evidence, identities and fallback behavior.

## Java

```sh
node engine/analyzer/analyze.mjs example-java /path/to/project src/main/java --java
node engine/analyzer/symbols.mjs example-java /path/to/project/src/main/java --java
```

Comma-separated source roots support multiple modules. Java uses the vendored
`web-tree-sitter` and `tree-sitter-java` runtime under `source-model/vendor/tree-sitter/`;
no Java toolchain is needed to analyze or view a dataset. Desktop combines Java
and JS/TS results for mixed folders.

Java resolution uses package/type names and imports rather than a type checker.
Overload targets are matched by name/arity, so equal-arity candidates can remain
ambiguous. Inherited methods, method references and external types have limited
coverage. Java does not use the new JS/TS compiler model.

## Other languages

Python, Go, Rust, C, C++, C#, Ruby, PHP, Kotlin, Scala and Lua share one tree-sitter
model (`source-model/syntax.js`); `source-model/languages.js` maps extensions to
languages and grammars, which are vendored under `source-model/vendor/tree-sitter/`.
Desktop merges them into the same dataset as JS/TS and Java
(`engine/analyzer/merge-sources.mjs --syntax`), so mixed repositories form one galaxy.

Planets get their types and functions as regions, and towns get control flow
(branches, loops, switches, try/catch, returns and throws). Methods declared outside
their type join it: Go receivers, Rust `impl` blocks, C++ `Type::method`, Lua tables.
In a project with C++ sources, `.h` headers are parsed as C++.

Edges come only from evidence in the source, resolved to files inside the opened folder:

| Language | Edges from |
| --- | --- |
| Python | `import` / `from … import`, absolute and relative, through `__init__.py` packages |
| Go | imported package members and same-package names, using `go.mod` module paths |
| Rust | `mod` declarations and `use crate::` / `self::` / `super::` paths |
| C, C++ | `#include`, relative first, then the nearest matching path |
| C#, Kotlin, Scala, PHP | type names through namespaces, packages and imports |
| Ruby | `require` / `require_relative`, and constants declared in one file |
| Lua | `require("a.b")` |

Resolution is by name, without types: imports of standard libraries and packages
stay outside the graph, and Ruby core classes such as `Array` never resolve to a
project file that reopens them. Swift has no grammar build compatible with the
vendored runtime yet.

[Verification](verification.md) lists the parser and scope checks.
