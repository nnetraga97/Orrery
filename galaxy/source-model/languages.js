// Every source language Galaxy turns into planets, and the front end that parses it. Shared by the engine
// (CommonJS requires this ES module) and the viewer, so both agree on which files are source.
//   typescript: the TypeScript compiler (engine/analyzer/project-model.mjs, source-model/code-model.js)
//   java:       tree-sitter with Java-specific resolution (source-model/java.js)
//   syntax:     tree-sitter with the shared model in source-model/syntax.js
export const LANGUAGES = [
  {
    id: 'typescript',
    label: 'JavaScript/TypeScript',
    frontEnd: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  },
  { id: 'java', label: 'Java', frontEnd: 'java', grammar: 'tree-sitter-java.wasm', extensions: ['.java'] },
  {
    id: 'python',
    label: 'Python',
    frontEnd: 'syntax',
    grammar: 'tree-sitter-python.wasm',
    extensions: ['.py', '.pyi'],
  },
  { id: 'go', label: 'Go', frontEnd: 'syntax', grammar: 'tree-sitter-go.wasm', extensions: ['.go'] },
  { id: 'rust', label: 'Rust', frontEnd: 'syntax', grammar: 'tree-sitter-rust.wasm', extensions: ['.rs'] },
  { id: 'c', label: 'C', frontEnd: 'syntax', grammar: 'tree-sitter-c.wasm', extensions: ['.c', '.h'] },
  {
    id: 'cpp',
    label: 'C++',
    frontEnd: 'syntax',
    grammar: 'tree-sitter-cpp.wasm',
    extensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.ipp', '.tpp'],
  },
  { id: 'csharp', label: 'C#', frontEnd: 'syntax', grammar: 'tree-sitter-c_sharp.wasm', extensions: ['.cs'] },
  { id: 'ruby', label: 'Ruby', frontEnd: 'syntax', grammar: 'tree-sitter-ruby.wasm', extensions: ['.rb', '.rake'] },
  { id: 'php', label: 'PHP', frontEnd: 'syntax', grammar: 'tree-sitter-php.wasm', extensions: ['.php'] },
  {
    id: 'kotlin',
    label: 'Kotlin',
    frontEnd: 'syntax',
    grammar: 'tree-sitter-kotlin.wasm',
    extensions: ['.kt', '.kts'],
  },
  { id: 'scala', label: 'Scala', frontEnd: 'syntax', grammar: 'tree-sitter-scala.wasm', extensions: ['.scala', '.sc'] },
  { id: 'lua', label: 'Lua', frontEnd: 'syntax', grammar: 'tree-sitter-lua.wasm', extensions: ['.lua'] },
];

const byExtension = new Map(LANGUAGES.flatMap(language => language.extensions.map(ext => [ext, language])));

/** The language of a path, or null when Galaxy does not parse it. Type declaration files are TypeScript. */
export function languageOf(path) {
  const name = String(path || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > name.lastIndexOf('/') ? byExtension.get(name.slice(dot)) || null : null;
}
export const isSource = path => !!languageOf(path);
