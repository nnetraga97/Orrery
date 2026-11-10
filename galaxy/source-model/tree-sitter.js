// Loads web-tree-sitter once and each grammar on first use, in Node (the analyzer) and the browser (the viewer).
// Grammars are the .wasm files in vendor/tree-sitter/, named in languages.js.

const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const DEFAULT_BASE = new URL(/* @vite-ignore */ './vendor/tree-sitter/', import.meta.url);

let runtime = null;
const grammars = new Map();

async function locate(base, name) {
  const url = new URL(name, base);
  return IS_NODE ? (await import('node:url')).fileURLToPath(url) : url.href;
}
function load(base) {
  runtime ||= (async () => {
    const module = await import(/* @vite-ignore */ new URL('web-tree-sitter.js', base).href);
    const wasm = await locate(base, 'web-tree-sitter.wasm');
    await module.Parser.init({ locateFile: () => wasm });
    return module;
  })();
  return runtime;
}

/**
 * A parser for one grammar file. The bundled viewer passes base explicitly: its chunks do not sit next to
 * vendor/tree-sitter/. Trees must be released with tree.delete().
 */
export async function createParser(grammar, base = DEFAULT_BASE) {
  const { Parser, Language } = await load(base);
  if (!grammars.has(grammar))
    grammars.set(
      grammar,
      locate(base, grammar).then(file => Language.load(file)),
    );
  const parser = new Parser();
  parser.setLanguage(await grammars.get(grammar));
  return { parse: source => parser.parse(source) };
}
