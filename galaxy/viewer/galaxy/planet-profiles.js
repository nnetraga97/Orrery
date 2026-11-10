// File identities choose visual assets only; planet types do not imply code behavior.
import library from '../assets/planets/library.json' with { type: 'json' };

export const planetCatalog = Object.freeze(library.planets);
export function planetAssetHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
export function planetProfile(path, { kind = 'terrestrial' } = {}) {
  // Rendezvous selection is independent of catalog order and snapshot indices.
  // A kind the catalog lacks falls back to the whole catalog's first entry rather than to no planet.
  let selected = planetCatalog.find(entry => entry.kind === kind) ?? planetCatalog[0],
    score = -1;
  for (const entry of planetCatalog) {
    if (entry.kind !== kind) continue;
    const candidate = planetAssetHash(path + '#planet-library-v1#' + entry.id);
    if (candidate > score) {
      selected = entry;
      score = candidate;
    }
  }
  return selected;
}
