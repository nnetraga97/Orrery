// Merge the tree-sitter languages into an existing JS/TS (or empty) workspace dataset, in a child process:
// Java (java-dataset.mjs) and the shared-model languages (syntax-dataset.mjs).
// Usage: merge-sources.mjs <name> <root> <dataset-directory> [--java] [--syntax]
import path from 'node:path';
import { buildJavaDataset } from './java-dataset.mjs';
import { buildSyntaxDataset } from './syntax-dataset.mjs';
import { addSymbols, readDatasetFile, writeDatasetFile } from './dataset-file.cjs';
import { mergeSources } from './merge.mjs';

const args = process.argv.slice(2);
const [name, root, directory] = args.filter(arg => !arg.startsWith('--'));
if (!directory) throw new Error('Usage: merge-sources.mjs <name> <root> <dataset-directory> [--java] [--syntax]');
const data = await readDatasetFile(directory, name, 'graph');
const parts = [];
if (args.includes('--java')) {
  const java = await buildJavaDataset([root], { symbols: true });
  parts.push({ part: java, languages: ['Java'], key: 'java', engine: 'java-source' });
}
if (args.includes('--syntax')) {
  const syntax = await buildSyntaxDataset(path.resolve(root), { symbols: true });
  parts.push({ part: syntax, languages: syntax.languages, key: 'syntax', engine: 'tree-sitter' });
}
await writeDatasetFile(directory, name, 'graph', mergeSources(data, parts));
for (const { part } of parts) await addSymbols(directory, name, part.symbols);
