// The overview a galaxy draws without loading any file's detail, sealed into the graph once a front end's symbols are
// final: each row's detail hash, region count (the planet's surface cells) and callable count (0 for a file with no
// functions or methods), and how each import is used.
import { buildRegions } from '../../source-model/semantic-layout.js';
import { detailHash } from './dataset-file.cjs';

export function sealOverview(rows, edges, symbols) {
  for (const row of rows) {
    const sym = symbols[row[0]];
    row[4] = detailHash(sym);
    const regions = sym ? buildRegions(sym, { file: row[0] }) : null;
    row[5] = regions ? regions.length : null;
    row[6] = regions ? regions.filter(region => region.kind !== 'file').length : null;
  }
  return {
    rows,
    edges: edges.map(([s, t]) => {
      const refs = symbols[rows[s][0]]?.refs;
      if (!refs) return [s, t];
      const [runtime = 0, types = 0, reexports = 0] = refs[rows[t][0]] || [];
      return [s, t, runtime, types, reexports];
    }),
  };
}
