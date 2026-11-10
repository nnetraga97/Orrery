import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pickScene } from '../viewer/scene/scene-picking.js';

const scene = new THREE.Scene();
const cube = z => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.z = z;
  scene.add(mesh);
  return mesh;
};
const file = cube(-8),
  building = cube(-3),
  hidden = cube(-1);
const hiddenGroup = new THREE.Group();
scene.add(hiddenGroup);
hiddenGroup.add(hidden);
hiddenGroup.visible = false;
scene.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
const picker = {
  objects: () => [hidden, building],
  describe: hit => ({ key: hit.object === hidden ? 'hidden' : 'building' }),
};
assert.equal(
  pickScene(ray, [file], () => 0, [picker]).item.key,
  'building',
  'A building in front wins over a file behind it, and a hidden ancestor cannot steal the click.',
);
building.visible = false;
assert.equal(pickScene(ray, [file], () => 0, [picker]).id, 0, 'Hiding a building exposes the visible file.');
building.visible = true;
assert.equal(
  pickScene(ray, null, null, [picker]).item.key,
  'building',
  'Custom targets work without a file pick mesh.',
);
file.position.z = -2;
scene.updateMatrixWorld();
assert.equal(pickScene(ray, [file], () => 0, [picker]).id, 0, 'The nearer file takes precedence.');
ray.ray.direction.set(1, 0, 0);
assert.deepEqual(
  pickScene(ray, [file], () => 0, [picker]),
  { id: -1, item: null },
  'A new pointer ray does not reuse the previous hit.',
);
console.log('PASS visible scene targets, nearest selection and fresh pointer rays');
