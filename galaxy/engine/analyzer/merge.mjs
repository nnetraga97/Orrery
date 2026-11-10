// Combines the JS/TS graph (or an empty one) with the tree-sitter front ends' parts: Java (java-dataset.mjs), then the
// shared-model languages (syntax-dataset.mjs). Each part's rows follow the previous ones; no import crosses parts.
import { languageOf } from '../../source-model/languages.js';

// parts: [{ part: { rows, edges, stats, languages? }, languages, key, engine }]. Mutates and returns data.
export function mergeSources(data, parts) {
  data.analysis ||= {
    schemaVersion: 2,
    engine: 'tree-sitter',
    supportedLanguages: [],
    coverage: { analyzedFiles: 0, supportedFiles: 0, unsupportedFiles: [], unsupportedExtensions: {} },
  };
  const { analysis } = data,
    { coverage } = analysis;
  for (const { part, languages, key, engine } of parts) {
    const offset = data.f.length;
    data.f.push(...part.rows);
    data.e.push(...part.edges.map(([a, b, ...uses]) => [a + offset, b + offset, ...uses]));
    if (!part.rows.length) continue;
    analysis.supportedLanguages.push(...languages);
    analysis.engine = analysis.engine === 'tree-sitter' ? engine : `${analysis.engine}+${engine}`;
    coverage.analyzedFiles += part.rows.length;
    coverage.supportedFiles += part.rows.length;
    analysis[key] = { files: part.rows.length, ...part.stats };
  }
  // Files a front end now parses are no longer unsupported.
  coverage.unsupportedFiles = coverage.unsupportedFiles.filter(file => !languageOf(file));
  for (const ext of Object.keys(coverage.unsupportedExtensions))
    if (languageOf('x' + ext)) delete coverage.unsupportedExtensions[ext];
  return data;
}
