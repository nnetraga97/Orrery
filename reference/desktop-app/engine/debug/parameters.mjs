// Parameter names of the innermost function around a paused line, so the variables view can show parameters apart
// from locals. Adapters report one flat local scope; the frame's captured source says which names are parameters.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { languageOf } from '../../source-model/languages.js';
import { createParser } from '../../source-model/tree-sitter.js';

const require = createRequire(import.meta.url);
const parsers = new Map(),
  cache = new Map();
const CACHE = 256;

const firstColumn = (text, line) => {
  const row = text.split('\n')[line - 1] ?? '';
  return Math.max(0, row.search(/\S/));
};

function typescriptNames(file, text, line) {
  const ts = require('typescript');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = source.getLineStarts();
  if (line < 1 || line > lines.length) return null;
  const position = lines[line - 1] + firstColumn(text, line);
  let found = null;
  const visit = node => {
    if (position < node.getStart(source) || position >= node.getEnd()) return;
    if (ts.isFunctionLike(node) && node.parameters) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) return null;
  const names = [];
  const bind = name => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else name.elements?.forEach(e => e.name && bind(e.name));
  };
  found.parameters.forEach(p => bind(p.name));
  return names.filter(name => name !== 'this');
}

const IDENTIFIER = /^(identifier|simple_identifier|variable_name)$/;
function identifierIn(node) {
  if (IDENTIFIER.test(node.type)) return node;
  for (const child of node.namedChildren) {
    const found = identifierIn(child);
    if (found) return found;
  }
  return null;
}
async function syntaxNames(grammar, text, line) {
  if (!parsers.has(grammar)) parsers.set(grammar, createParser(grammar));
  const tree = (await parsers.get(grammar)).parse(text);
  try {
    let node = tree.rootNode.descendantForPosition({ row: line - 1, column: firstColumn(text, line) });
    for (; node; node = node.parent) {
      const list = node.childForFieldName('parameters') || node.namedChildren.find(c => /parameters$/.test(c.type));
      // A record's component list is not a callable's parameters.
      if (!list || node.type === 'record_declaration') continue;
      // A single-parameter lambda (`hold -> …`) names its parameter directly.
      if (IDENTIFIER.test(list.type)) return [list.text];
      return list.namedChildren
        .map(p => (p.childForFieldName('name') || p.childForFieldName('pattern') || identifierIn(p))?.text)
        .filter(Boolean);
    }
    return null;
  } finally {
    tree.delete();
  }
}

/** Names of the parameters of the function enclosing `line`, or null when the source has none there. */
export async function parameterNames(file, text, line) {
  if (typeof text !== 'string' || !(line >= 1)) return null;
  const language = languageOf(file);
  if (!language) return null;
  const key = `${file}\0${line}\0${createHash('sha1').update(text).digest('hex')}`;
  if (cache.has(key)) return cache.get(key);
  let names = null;
  try {
    names =
      language.frontEnd === 'typescript'
        ? typescriptNames(file, text, line)
        : language.grammar
          ? await syntaxNames(language.grammar, text, line)
          : null;
  } catch {
    names = null;
  }
  if (cache.size >= CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, names);
  return names;
}
