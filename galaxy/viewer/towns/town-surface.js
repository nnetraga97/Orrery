// A flat counterpart to towns.js's default spherical frames. Coordinates stay local to one city.
import * as THREE from 'three';

export function flatTownSurface(centers) {
  return {
    flat: true,
    frame(k) {
      const origin = centers[k],
        n0 = new THREE.Vector3(0, 1, 0);
      const e = new THREE.Vector3(1, 0, 0),
        nn = new THREE.Vector3(0, 0, -1);
      const world = (x, y, lift = 0) =>
        origin.clone().addScaledVector(e, x).addScaledVector(nn, y).addScaledVector(n0, lift);
      return { k, n0, e, nn, roof: origin.y, world, dirAt: world, normalAt: () => n0.clone(), altitude: p => p.y };
    },
  };
}
