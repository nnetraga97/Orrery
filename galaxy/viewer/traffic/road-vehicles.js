// Full-detail user-supplied cars. One body batch and one wheel batch per design;
// all four wheels share geometry, while their pivots roll and steer independently.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadModel } from '../towns/towns.js';
import { planetBuildBudget } from '../shared/build-budget.js';

export const ROAD_CARS = Object.freeze(['courier', 'interceptor', 'utility', 'hauler']);
// A host may ask for the town kit's cars (about 2,000-2,800 triangles each, wheels included) instead of the detailed
// ones (14,000-22,000 plus four wheel meshes): the XR app does, where a car is a few millimetres long on a globe.
export const RoadCars = { detailed: true };
const cache = new Map();
function loadCar(key) {
  if (!cache.has(key)) {
    const pending = new GLTFLoader()
      .loadAsync(`assets/vehicles/road-v1/${key}.glb`)
      .then(gltf => {
        gltf.scene.updateMatrixWorld(true);
        let body;
        const wheels = [];
        gltf.scene.traverse(o => {
          if (!o.isMesh) return;
          if (o.name.startsWith('SM_Wheel_')) wheels.push(o);
          else if (o.userData.vehicle === key || o.name.endsWith('_Body')) body = o;
        });
        if (!body || wheels.length !== 4) throw new Error(`${key}: expected a body and four wheels`);
        if (wheels.some(o => !Number.isFinite(o.userData.radius) || o.userData.radius <= 0))
          throw new Error(`${key}: invalid wheel radius`);
        const geometry = body.geometry.clone().applyMatrix4(body.matrixWorld);
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        return {
          width: bounds.max.x - bounds.min.x,
          geometry,
          material: body.material,
          wheelGeometry: wheels[0].geometry,
          wheelMaterial: wheels[0].material,
          wheels: wheels.map(o => ({
            position: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld),
            radius: o.userData.radius,
            steering: o.userData.steering,
          })),
        };
      })
      .catch(error => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export function createRoadFleet(T, capacity) {
  const scene = T.scene,
    controller = new AbortController();
  const checkpoint = planetBuildBudget(controller.signal);
  let preparation = Promise.resolve();
  const batches = [],
    errors = [];
  let disposed = false,
    loaded = false;
  function batch(geometry, material, count, key, part) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `road-car:${key}:${part}`;
    mesh.userData.roadVehicle = key;
    mesh.userData.vehiclePart = part;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 5;
    return mesh;
  }
  const ready = Promise.all(
    [...ROAD_CARS, 'police', 'ambulance'].map(async (key, i) => {
      let car;
      if (i < ROAD_CARS.length && RoadCars.detailed) {
        try {
          car = await loadCar(key);
        } catch (error) {
          errors.push(`${key}: ${error.message}`);
        }
      }
      if (!car) {
        const fallback = await loadModel(
          `assets/kit/cars/${i < ROAD_CARS.length ? ['hatchback-sports', 'sedan-sports', 'suv', 'delivery'][i] : key}.glb`,
        );
        if (fallback) {
          fallback.geo.computeBoundingBox();
          car = {
            geometry: fallback.geo,
            material: fallback.mat,
            fallback: true,
            width: fallback.geo.boundingBox.max.x - fallback.geo.boundingBox.min.x,
          };
        }
      }
      if (disposed || !car) return;
      const next = {
        key,
        car,
        body: batch(car.geometry, car.material, capacity, key, 'body'),
        wheels: car.wheels ? batch(car.wheelGeometry, car.wheelMaterial, capacity * 4, key, 'wheels') : null,
      };
      // Shared texture uploads must not race into one first visible frame.
      const prepare = preparation.then(async () => {
        if (disposed) return;
        const group = new THREE.Group();
        group.add(next.body);
        if (next.wheels) group.add(next.wheels);
        await T.prepareDraw(group, checkpoint);
        if (disposed) return;
        scene.add(next.body);
        if (next.wheels) scene.add(next.wheels);
        batches[i] = next;
      });
      preparation = prepare.catch(() => {});
      try {
        await prepare;
        if (disposed && batches[i] !== next) {
          next.body.dispose();
          next.wheels?.dispose();
        }
      } catch (error) {
        next.body.dispose();
        next.wheels?.dispose();
        if (!disposed) errors.push(`${key}: ${error.message}`);
      }
    }),
  ).then(() => {
    loaded = true;
  });
  const local = new THREE.Matrix4(),
    combined = new THREE.Matrix4(),
    rotation = new THREE.Quaternion(),
    steering = new THREE.Quaternion(),
    axle = new THREE.Vector3(1, 0, 0),
    up = new THREE.Vector3(0, 1, 0),
    unit = new THREE.Vector3(1, 1, 1);
  return {
    ready,
    get loaded() {
      return loaded;
    },
    available: i => !!batches[i],
    scaleOf: (i, length, maxWidth) => Math.min(length, maxWidth / (batches[i]?.car.width || 1)),
    begin() {
      batches.forEach(b => {
        b.body.count = 0;
        if (b.wheels) b.wheels.count = 0;
      });
    },
    draw(i, matrix, distance, turn = 0) {
      const b = batches[i];
      if (disposed || !b || b.body.count >= capacity) return;
      b.body.setMatrixAt(b.body.count++, matrix);
      if (!b.wheels) return;
      for (const wheel of b.car.wheels) {
        steering.setFromAxisAngle(up, wheel.steering ? turn : 0);
        rotation.setFromAxisAngle(axle, (distance / wheel.radius) % (Math.PI * 2)).premultiply(steering);
        local.compose(wheel.position, rotation, unit);
        combined.multiplyMatrices(matrix, local);
        b.wheels.setMatrixAt(b.wheels.count++, combined);
      }
    },
    end() {
      batches.forEach(b => {
        b.body.instanceMatrix.needsUpdate = true;
        if (b.wheels) b.wheels.instanceMatrix.needsUpdate = true;
      });
    },
    snapshot: () => ({
      loaded,
      errors: [...errors],
      models: batches.filter(Boolean).map(b => ({
        key: b.key,
        fallback: !!b.car.fallback,
        cars: b.body.count,
        wheels: b.wheels?.count ?? 0,
        triangles:
          (b.car.geometry.index?.count ?? b.car.geometry.attributes.position.count) / 3 +
          (b.car.wheelGeometry
            ? (4 * (b.car.wheelGeometry.index?.count ?? b.car.wheelGeometry.attributes.position.count)) / 3
            : 0),
      })),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      batches.forEach(b =>
        [b.body, b.wheels].filter(Boolean).forEach(mesh => {
          mesh.removeFromParent();
          mesh.dispose();
        }),
      ); // Shared geometry/materials/textures stay in the bounded model cache.
    },
  };
}
