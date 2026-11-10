// Shared, procedural rock families. Detail follows screen size, with a fixed
// close-up budget rather than a high-resolution mesh for every small file.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const Asteroids = (() => {
  const VARIANTS = 3,
    NEAR_LIMIT = 48;
  const fract = x => x - Math.floor(x);
  const hash = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
  const mix = (a, b, t) => a + (b - a) * t;
  function noise(x, y, z) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    let u = fract(x),
      v = fract(y),
      w = fract(z);
    u *= u * (3 - 2 * u);
    v *= v * (3 - 2 * v);
    w *= w * (3 - 2 * w);
    return mix(
      mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
      mix(
        mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u),
        mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u),
        v,
      ),
      w,
    );
  }
  function profile(path) {
    let seed = 2166136261;
    for (let i = 0; i < path.length; i++) seed = Math.imul(seed ^ path.charCodeAt(i), 16777619) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return {
      variant: seed % VARIANTS,
      seed: random(),
      scale: [1.04 + random() * 0.25, 0.72 + random() * 0.27, 0.85 + random() * 0.22],
      rotation: [random() * 6.28, random() * 6.28, random() * 6.28],
      spin: [(0.05 + random() * 0.11) * (random() < 0.5 ? -1 : 1), 0.025 + random() * 0.07, 0.015 + random() * 0.035],
    };
  }
  function geometry(variant, detail) {
    const geo = new THREE.IcosahedronGeometry(1, detail),
      positions = geo.attributes.position;
    const offset = variant * 19.7 + 3.1,
      cavities = new Float32Array(positions.count);
    const craters = Array.from({ length: 7 }, (_, i) => {
      const y = 1 - (2 * (i + 0.5)) / 7,
        a = i * 2.39996 + variant * 0.83,
        r = Math.sqrt(1 - y * y);
      return {
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius: i < 2 ? 0.42 : 0.19 + hash(i, variant, 9) * 0.12,
        depth: i < 2 ? 0.19 : 0.065,
      };
    });
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const broad = noise(x * 2.5 + offset, y * 2.5, z * 2.5);
      const grain = noise(x * 9 + offset, y * 9, z * 9);
      let radius = 0.78 + broad * 0.3 + (grain - 0.5) * 0.055,
        cavity = 0;
      // A compact chunk, a split lobe, and a flatter, chipped slab.
      if (variant === 1) radius += 0.14 * Math.abs(x) - 0.1 * (1 - Math.abs(x));
      if (variant === 2) radius += 0.07 * Math.sin(x * 5 + y * 3);
      for (const crater of craters) {
        const q = Math.sqrt(Math.max(0, 2 - 2 * (x * crater.x + y * crater.y + z * crater.z))) / crater.radius;
        if (q > 1.3) continue;
        const bowl = q < 1 ? (1 - q * q) ** 2 : 0;
        radius -= crater.depth * bowl;
        radius += 0.042 * Math.exp(-(((q - 0.95) * 9) ** 2));
        cavity = Math.max(cavity, bowl);
      }
      const px = x * radius,
        py = y * radius,
        pz = z * radius;
      positions.setXYZ(i, variant === 2 ? Math.min(px, 0.6) : px, py * (variant === 2 ? 0.78 : 1), pz);
      cavities[i] = cavity;
    }
    // Weld the sphere's UV seams before normals; the material uses object space.
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    geo.setAttribute('aCavity', new THREE.BufferAttribute(cavities, 1));
    const welded = BufferGeometryUtils.mergeVertices(geo, 1e-4);
    geo.dispose();
    welded.computeVertexNormals();
    welded.computeBoundingSphere();
    return welded;
  }
  function material() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0.035 });
    mat.extensions = { derivatives: true };
    mat.customProgramCacheKey = () => 'asteroid-regolith-v1';
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aCavity; attribute float aRockSeed;
          varying vec3 vRock; varying float vCavity, vRockSeed, vRockScale;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vRock = position; vCavity = aCavity; vRockSeed = aRockSeed;
          vRockScale = length(modelViewMatrix[0].xyz);
          #ifdef USE_INSTANCING
            vRockScale *= length(instanceMatrix[0].xyz);
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vRock; varying float vCavity, vRockSeed, vRockScale;
          float rockHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
          float rockNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(rockHash(i), rockHash(i+vec3(1,0,0)),f.x),mix(rockHash(i+vec3(0,1,0)),rockHash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(rockHash(i+vec3(0,0,1)),rockHash(i+vec3(1,0,1)),f.x),mix(rockHash(i+vec3(0,1,1)),rockHash(i+vec3(1,1,1)),f.x),f.y),f.z);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 sampleAt = vRock + vRockSeed * 17.0;
          float strata = rockNoise(sampleAt * 4.5);
          float fracture = rockNoise(sampleAt * 13.0);
          float grain = rockNoise(sampleAt * 65.0);
          float detail = 1.0 - smoothstep(.025, .12, max(length(dFdx(vRock)), length(dFdy(vRock))));
          float seam = 1.0 - smoothstep(.015, .06, abs(fracture - .43));
          vec3 minerals = mix(vec3(.65,.72,.82), vec3(1.05,.90,.72), strata);
          diffuseColor.rgb *= minerals * (.78 + strata * .36) * (1.0 - vCavity * .48);
          diffuseColor.rgb *= 1.0 - seam * .16 * detail;
          diffuseColor.rgb *= 1.0 + (grain - .5) * .25 * detail;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (grain - .5) * .12, .8, 1.0);',
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Screen derivatives give the grain real light response, fading before
          // subpixel detail can sparkle in a distant belt.
          float height = (fracture * .014 + grain * .003) * vRockScale * detail;
          vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
          vec3 r1 = cross(dy, normal), r2 = cross(normal, dx);
          float det = dot(dx, r1);
          vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
          normal = normalize(max(abs(det), 1e-8) * normal - gradient);`,
        );
    };
    return mat;
  }
  function create(files) {
    const profiles = new Map(files.map(n => [n.i, profile(n.path)]));
    const colors = new Map(files.map(n => [n.i, new THREE.Color()]));
    const detailed = new Set(),
      mat = material(),
      meshes = [],
      batches = [];
    for (let variant = 0; variant < VARIANTS; variant++) {
      const capacity = files.filter(n => profiles.get(n.i).variant === variant).length;
      if (!capacity) continue;
      batches[variant] = [2, 12].map((detail, lod) => {
        const count = lod ? Math.min(capacity, NEAR_LIMIT) : capacity;
        const geo = geometry(variant, detail);
        geo.setAttribute(
          'aRockSeed',
          new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage),
        );
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.name = `Asteroids · ${['chunk', 'split', 'slab'][variant]} · ${lod ? 'near' : 'belt'}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.userData.fileIds = [];
        mesh.userData.asteroidLOD = lod;
        meshes.push(mesh);
        return mesh;
      });
    }
    let camera,
      projection = 1,
      nearCount = 0,
      otherNear = 0,
      priority = null;
    return {
      meshes,
      profiles,
      color(i, color) {
        colors.get(i).copy(color);
      },
      begin(cam, height, selected = null) {
        camera = cam;
        projection = height / (2 * Math.tan((cam.fov * Math.PI) / 360));
        nearCount = otherNear = 0;
        priority = profiles.has(selected) ? selected : null;
        meshes.forEach(mesh => {
          mesh.count = 0;
        });
      },
      place(i, matrix, position, radius) {
        const p = profiles.get(i),
          pixels = (radius * projection) / Math.max(0.001, camera.position.distanceTo(position));
        const near =
          pixels > (detailed.has(i) ? 10 : 15) &&
          (i === priority || otherNear < NEAR_LIMIT - (priority == null ? 0 : 1));
        if (near) {
          detailed.add(i);
          nearCount++;
          if (i !== priority) otherNear++;
        } else detailed.delete(i);
        const mesh = batches[p.variant][near ? 1 : 0],
          slot = mesh.count++;
        mesh.setMatrixAt(slot, matrix);
        mesh.setColorAt(slot, colors.get(i));
        mesh.geometry.attributes.aRockSeed.setX(slot, p.seed);
        mesh.userData.fileIds[slot] = i;
      },
      end() {
        meshes.forEach(mesh => {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.geometry.attributes.aRockSeed.needsUpdate = true;
        });
      },
      stats: () => ({
        count: files.length,
        detailed: nearCount,
        drawCalls: meshes.filter(m => m.count).length,
        triangles: meshes.reduce((sum, m) => sum + (m.count * m.geometry.index.count) / 3, 0),
        detailLimit: NEAR_LIMIT,
      }),
      dispose() {
        meshes.forEach(mesh => {
          mesh.removeFromParent();
          mesh.dispose();
          mesh.geometry.dispose();
        });
        mat.dispose();
      },
    };
  }
  return { create, profile, geometry, material };
})();
