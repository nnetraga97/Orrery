// Hand and mouse gestures -> the virtual camera. Pinch-and-drag orbits the camera about its target (the model turns on
// the table); two pinches moving apart or together dolly it (the model grows or shrinks).
import type { Vec3, VirtualCamera } from './table-frame.ts';

const HALF_TURN_METRES = 0.5;
const MIN_POLAR = (5 * Math.PI) / 180,
  MAX_POLAR = (175 * Math.PI) / 180;

/**
 * Hand travel in metres -> orbit angles in radians. Half a metre is a half turn. Moving right turns the model right
 * (the camera goes left: negative azimuth); moving up tilts the far side down (the camera rises: negative polar).
 */
export function orbitFromDrag(dxMetres: number, dyMetres: number, sensitivity: number) {
  const k = (Math.PI / HALF_TURN_METRES) * sensitivity;
  return { dAzimuth: -dxMetres * k + 0, dPolar: -dyMetres * k + 0 };
}

/** The camera turned about its target (azimuth about +Y, polar from +Y), at the same distance. */
export function applyOrbit(camera: VirtualCamera, dAzimuth: number, dPolar: number): VirtualCamera {
  const [tx, ty, tz] = camera.target;
  const x = camera.position[0] - tx,
    y = camera.position[1] - ty,
    z = camera.position[2] - tz;
  const r = Math.hypot(x, y, z);
  if (r === 0) return { ...camera, position: [...camera.position] as Vec3 };
  const azimuth = Math.atan2(x, z) + dAzimuth;
  const polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, Math.acos(Math.max(-1, Math.min(1, y / r))) + dPolar));
  const s = Math.sin(polar);
  return {
    ...camera,
    position: [tx + r * s * Math.sin(azimuth), ty + r * Math.cos(polar), tz + r * s * Math.cos(azimuth)],
    target: [tx, ty, tz],
  };
}

/** The camera moved along its view line so its distance is multiplied by `factor`, within limits. */
export function applyDolly(camera: VirtualCamera, factor: number, minDistance: number, maxDistance: number): VirtualCamera {
  const [tx, ty, tz] = camera.target;
  const x = camera.position[0] - tx,
    y = camera.position[1] - ty,
    z = camera.position[2] - tz;
  const r = Math.hypot(x, y, z);
  if (r === 0) return { ...camera, position: [...camera.position] as Vec3 };
  const k = Math.min(maxDistance, Math.max(minDistance, r * factor)) / r;
  return { ...camera, position: [tx + x * k, ty + y * k, tz + z * k], target: [tx, ty, tz] };
}

/** Two-hand spread -> dolly factor: hands moving apart zoom in. */
export function dollyFromSpread(startSpreadMetres: number, currentSpreadMetres: number): number {
  return startSpreadMetres / currentSpreadMetres;
}
