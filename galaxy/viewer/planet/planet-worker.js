// CPU-only terrain and source revision construction.
import '../scene/color-space.js';
import { generatePlanetTerrain } from './planet-terrain.js';
import { townRevision } from '../../source-model/town-revision.js';

function generateRevisions({ regions, source, file }) {
  const targets = [];
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (value.id && value.targetLine != null) targets.push([value.id, value.targetLine]);
    for (const child of Object.values(value)) collect(child);
  };
  const fingerprints = regions.map(region => {
    collect(region);
    return townRevision(region, source, file);
  });
  return { targets, fingerprints };
}

self.onmessage = ({ data }) => {
  try {
    if (!['terrain', 'revisions'].includes(data.type)) throw new Error('Unknown planet job: ' + data.type);
    const result = data.type === 'terrain' ? generatePlanetTerrain(data.input) : generateRevisions(data.input);
    const transfers = [];
    const collect = x => {
      if (ArrayBuffer.isView(x)) transfers.push(x.buffer);
      else if (x && typeof x === 'object') Object.values(x).forEach(collect);
    };
    collect(result);
    self.postMessage({ result }, [...new Set(transfers)]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
