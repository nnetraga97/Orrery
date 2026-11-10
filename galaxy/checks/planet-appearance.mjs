import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../viewer/scene/color-space.js';
import { generatePlanetTerrain, hydratePlanetTerrain } from '../viewer/planet/planet-terrain.js';
import { planetSeed } from '../viewer/planet/planet-appearance.js';
const input = {
  R: 10,
  color: [0.4, 0.6, 0.7],
  seed: planetSeed('climate.js'),
  regions: [
    { id: 'north', name: 'north', loc: 32, branches: 2 },
    { id: 'south', name: 'south', loc: 24, branches: 3 },
    { id: 'east', name: 'east', loc: 44, branches: 1 },
  ],
};
const terrain = generatePlanetTerrain(input),
  surface = hydratePlanetTerrain(terrain);
let low = Infinity,
  high = -Infinity,
  coast = 0,
  inland = 0;
for (let i = 0; i < terrain.surfacePos.length; i += 3) {
  const p = new THREE.Vector3().fromArray(terrain.surfacePos, i),
    h = p.length() - input.R;
  assert.ok(Number.isFinite(h));
  assert.ok(Math.abs(surface.heightAt(p.normalize()) - h) < 2e-5, 'Hydrated town/road height matches rendered relief');
  low = Math.min(low, h);
  high = Math.max(high, h);
  if (h < 0.018) coast++;
  else inland++;
}
assert.ok(low < 0 && high > 0.13 && high < 0.19, 'Gentle relief and submerged channels');
assert.ok(coast > 100 && inland > 100, 'Coast and buildable interiors survive');
assert.ok(terrain.colors.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
const repeated = generatePlanetTerrain(input);
assert.deepEqual(terrain.surfacePos, repeated.surfacePos, 'Stable terrain for the same file');
assert.deepEqual(terrain.colors, repeated.colors, 'Stable climate colors for the same file');
const different = generatePlanetTerrain({ ...input, seed: planetSeed('landscape.js') });
assert.notDeepEqual(terrain.colors, different.colors, 'Different files have distinct natural coloration');
assert.deepEqual(terrain.fineOwner, different.fineOwner, 'Appearance does not rearrange source regions');
console.log('PASS: seeded climate, relief, coastlines, and rendered/hydrated terrain agreement');
