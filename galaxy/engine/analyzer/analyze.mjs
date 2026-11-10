// Scan a project once into graph and optional semantic symbols.
// Usage: node analyze.mjs <name> <repoRoot> <scanDir> [tsconfig.json or -] [module-map.json] --out=<dir> [--symbols]
import path from 'node:path';
import { createAnalysisScope } from '../shared/scope.cjs';
import { buildProjectModel } from './project-model.mjs';
import { writeDatasetFile } from './dataset-file.cjs';

const flags = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const flag = name => flags.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!flag('out')) throw new Error('analyze.mjs needs --out=<dir> for the dataset files.');
const outDir = path.resolve(flag('out'));
const [name, repoRoot, scanDir, tsconfigPath, moduleMapPath] = process.argv
  .slice(2)
  .filter(arg => !arg.startsWith('--'));
if (!scanDir)
  throw new Error(
    'usage: analyze.mjs <name> <repoRoot> <scanDir> [tsconfig] [module-map] [--symbols]   |   analyze.mjs <name> <repoRoot> <srcRoot,srcRoot,...> --java',
  );
const root = path.resolve(repoRoot),
  withSymbols = flags.includes('--symbols');
if (flags.includes('--java')) {
  const { buildJavaDataset } = await import('./java-dataset.mjs');
  const data = await buildJavaDataset(
    scanDir.split(',').map(dir => path.resolve(root, dir)),
    { scope: createAnalysisScope(root), symbols: withSymbols },
  );
  await writeDatasetFile(outDir, name, 'graph', { f: data.rows, e: data.edges });
  if (withSymbols) await writeDatasetFile(outDir, name, 'symbols', data.symbols);
  console.log(
    `${name}: ${data.rows.length} files, ${data.edges.length} imports (${data.stats.ambiguousWildcardMatches} ambiguous wildcard matches)`,
  );
} else {
  const result = buildProjectModel({
    root,
    scan: path.resolve(root, scanDir),
    outDir,
    tsPath: flag('typescript'),
    tsconfigPath,
    moduleMapPath,
    symbols: withSymbols,
  });
  await writeDatasetFile(outDir, name, 'graph', result.graph);
  if (withSymbols) await writeDatasetFile(outDir, name, 'symbols', result.symbols);
  console.log(
    `${name}: ${result.graph.f.length} files, ${result.graph.e.length} imports, ${result.graph.analysis.unresolvedReferences.length} unresolved module references${result.graph.analysis.analysisFailures.length ? `, ${result.graph.analysis.analysisFailures.length} files with incomplete analysis` : ''}`,
  );
}
