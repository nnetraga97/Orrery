// Standalone semantic symbol extraction uses the same project compiler/resolver as analyze.mjs.
// Usage: node symbols.mjs <dataset> <scanDir> [typescript module path or -] [module-map.json] --out=<dir>
import path from 'node:path';
import { createAnalysisScope } from '../shared/scope.cjs';
import { buildProjectModel } from './project-model.mjs';
import { writeDatasetFile } from './dataset-file.cjs';

const flags = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const flag = name => flags.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!flag('out')) throw new Error('symbols.mjs needs --out=<dir> for the dataset file.');
const outDir = path.resolve(flag('out'));
const [dataset, scanArg, tsPath, moduleMapPath] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!scanArg)
  throw new Error(
    'usage: symbols.mjs <dataset> <scanDir> [typescript] [module-map] [--tsconfig=path]   |   symbols.mjs <dataset> <srcRoot,srcRoot,...> --java',
  );
let symbols, scan;
if (flags.includes('--java')) {
  const { buildJavaDataset } = await import('./java-dataset.mjs');
  const result = await buildJavaDataset(
    scanArg.split(',').map(dir => path.resolve(dir)),
    { symbols: true, ...(flag('scope-root') ? { scope: createAnalysisScope(path.resolve(flag('scope-root'))) } : {}) },
  );
  symbols = result.symbols;
  scan = result.scan;
} else {
  scan = path.resolve(scanArg);
  const result = buildProjectModel({
    root: flag('scope-root') ? path.resolve(flag('scope-root')) : scan,
    scan,
    outDir,
    tsPath,
    tsconfigPath: flag('tsconfig'),
    moduleMapPath,
  });
  symbols = result.symbols;
}
await writeDatasetFile(outDir, dataset, 'symbols', symbols);
console.log(
  `${dataset}: ${Object.keys(symbols).length} files, ${Object.values(symbols).reduce((n, file) => n + file.decls.length, 0)} top-level declarations`,
);
