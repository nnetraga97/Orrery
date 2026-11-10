// Immutable CPU data has a bounded cache; GPU resources belong to each planet host.
// One-shot jobs terminate on cancellation.
import * as THREE from 'three';
export const planetTerrainCache = new Map();
const PLANET_CACHE_BYTES = 32 * 1024 * 1024;
export let planetTerrainBytes = 0;
export async function runPlanetWorker(type, input, signal) {
  if (signal?.aborted) throw new DOMException('Planet build cancelled', 'AbortError');
  // Pure budget/route helpers also run in offline checks; load the browser worker only for a job.
  const { default: PlanetWorker } = await import('./planet-worker.js?worker&inline');
  const worker = new PlanetWorker();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      worker.terminate();
      return reject(new DOMException('Planet build cancelled', 'AbortError'));
    }
    const finish = (error, result) => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException('Planet build cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = e => finish(new Error(e.message || 'Planet worker failed'));
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
    try {
      worker.postMessage({ type, input });
    } catch (error) {
      finish(error);
    }
  });
}
export async function loadPlanetTerrain(input, signal) {
  // Include all topology/appearance inputs, not just a path that can change underneath us.
  const key = JSON.stringify(input);
  if (signal?.aborted) throw new DOMException('Planet build cancelled', 'AbortError');
  if (planetTerrainCache.has(key)) {
    const hit = planetTerrainCache.get(key);
    planetTerrainCache.delete(key);
    planetTerrainCache.set(key, hit);
    return hit.data;
  }
  const data = await runPlanetWorker('terrain', input, signal);
  const payloadBytes = v =>
    ArrayBuffer.isView(v)
      ? v.byteLength
      : typeof v === 'string'
        ? v.length * 2
        : typeof v === 'number'
          ? 8
          : v && typeof v === 'object'
            ? Object.entries(v).reduce((sum, [k, x]) => sum + k.length * 2 + payloadBytes(x), 0)
            : 4;
  const bytes = key.length * 2 + payloadBytes(data);
  while (planetTerrainCache.size && planetTerrainBytes + bytes > PLANET_CACHE_BYTES) {
    const [old, hit] = planetTerrainCache.entries().next().value;
    planetTerrainCache.delete(old);
    planetTerrainBytes -= hit.bytes;
  }
  if (bytes <= PLANET_CACHE_BYTES) {
    planetTerrainCache.set(key, { data, bytes });
    planetTerrainBytes += bytes;
  }
  return data;
}
// Constant-cost position/tangent lookup; distance lookup is logarithmic in route samples.
// Never consult terrain or rebuild a spline from an animation callback.
export function sampledRoute({ points, distances, length }) {
  const curve = new THREE.Curve(),
    count = points.length / 3 - 1;
  curve.getPoint = (t, target = new THREE.Vector3()) => {
    const at = Math.max(0, Math.min(1, t)) * count,
      i = Math.min(count - 1, Math.floor(at)),
      f = at - i;
    return target.set(
      points[i * 3] + (points[(i + 1) * 3] - points[i * 3]) * f,
      points[i * 3 + 1] + (points[(i + 1) * 3 + 1] - points[i * 3 + 1]) * f,
      points[i * 3 + 2] + (points[(i + 1) * 3 + 2] - points[i * 3 + 2]) * f,
    );
  };
  curve.getUtoTmapping = (u, distance) => {
    const d = Math.max(0, Math.min(length, distance ?? u * length));
    let lo = 0,
      hi = count;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (distances[mid] <= d) lo = mid;
      else hi = mid;
    }
    return (lo + (d - distances[lo]) / (distances[hi] - distances[lo] || 1)) / count;
  };
  curve.getLength = () => length;
  curve.getTangent = (t, target = new THREE.Vector3()) => {
    const i = Math.min(count - 1, Math.floor(Math.max(0, Math.min(1, t)) * count));
    return target
      .set(
        points[(i + 1) * 3] - points[i * 3],
        points[(i + 1) * 3 + 1] - points[i * 3 + 1],
        points[(i + 1) * 3 + 2] - points[i * 3 + 2],
      )
      .normalize();
  };
  curve.routeData = { points, distances, length };
  return curve;
}
