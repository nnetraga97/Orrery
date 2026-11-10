import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { planetSurfaceGeometry } from './planet-surface.js';
export { planetSurfaceGeometry } from './planet-surface.js';
import { planetProfile } from './planet-profiles.js';

const hiddenPlanetPart = new THREE.Matrix4().makeScale(0, 0, 0);
const assetUrl = file => 'assets/planets/' + file;
// Outer radius of the atmosphere shell, in body radii. The shader is analytic, so the
// shell's tessellation only has to enclose it.
const ATMOSPHERE = 1.07;
// Projected body radius (CSS px) where a globe switches to full detail, with hysteresis
// so a body on the boundary does not alternate tiers.
const NEAR_IN = 40,
  NEAR_OUT = 30,
  // Below this a body covers no pixel; it is neither drawn nor pickable.
  MIN_PX = 0.25;

function atmosphereMaterial(color, sun) {
  return new THREE.ShaderMaterial({
    uniforms: { hue: { value: new THREE.Color(color) }, sun: { value: sun }, outer: { value: ATMOSPHERE } },
    vertexShader: `varying vec3 vPos, vCenter; varying float vRadius, brightness;
      void main() {
        mat4 m=modelViewMatrix*instanceMatrix;
        vec4 p=m*vec4(position,1.);
        vPos=p.xyz; vCenter=(m*vec4(0.,0.,0.,1.)).xyz; vRadius=length(m[0].xyz);
        brightness=1.;
        #ifdef USE_INSTANCING_COLOR
          brightness=instanceColor.r;
        #endif
        gl_Position=projectionMatrix*p;
      }`,
    // Per pixel: the view ray's closest approach to the body centre, in body radii. Over the
    // disc the haze thickens toward the limb; outside it falls to zero at the shell. Lighting
    // follows the scene sun, so night limbs stay dark.
    fragmentShader: `uniform vec3 hue, sun; uniform float outer;
      varying vec3 vPos, vCenter; varying float vRadius, brightness;
      void main(){
        vec3 d=normalize(vPos); float tc=dot(vCenter,d);
        vec3 q=d*tc-vCenter; float b=length(q)/vRadius;
        if (b>=outer) discard;
        float glow; vec3 n;
        if (b<1.) {
          n=d*(tc-sqrt(1.-b*b)*vRadius)-vCenter;
          glow=pow(b,8.);
        } else {
          n=q;
          float x=(b-1.)/(outer-1.);
          glow=exp(-4.*x)*(1.-x)*(1.-x);
        }
        float day=smoothstep(-.3,.6,dot(normalize(n),normalize((viewMatrix*vec4(sun,0.)).xyz)));
        gl_FragColor=vec4(hue*brightness*glow*day*.75,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false, // Analytic additive limb glow; still converts to the output colour space.
  });
}

async function texture(file, color = false, decoded = false) {
  let map;
  if (decoded) {
    const response = await fetch(assetUrl(file));
    if (!response.ok) throw new Error('Missing planet texture: ' + file);
    const bitmap = await createImageBitmap(await response.blob(), {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    map = new THREE.Texture(bitmap);
    map.flipY = false; // ImageBitmap uploads ignore pixel-store flipping; decode in texture orientation.
    map.needsUpdate = true;
    map.addEventListener('dispose', () => bitmap.close());
  } else map = await new THREE.TextureLoader().loadAsync(assetUrl(file));
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = color ? 4 : 2;
  return map;
}

// Mirrored polar texture still converges to a point at the pole. From each fill line toward
// its pole, ease normal detail out; in the last few degrees, fade albedo toward the
// adjoining valid band's mean.
function fadeFilledPoles(material, image, [north, south]) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, 128, 64);
  const pixels = context.getImageData(0, 0, 128, 64).data;
  const band = (from, to) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(from * 64); y < Math.ceil(to * 64); y++)
      for (let x = 0; x < 128; x++, n++) for (let c = 0; c < 3; c++) sum[c] += pixels[(y * 128 + x) * 4 + c];
    return new THREE.Color().setRGB(...sum.map(v => v / n / 255), THREE.SRGBColorSpace);
  };
  // Unit-sphere height where each fill begins; 2 disables a hemisphere.
  const uniforms = {
    poleNorth: { value: band(north, Math.min(1, north + 0.06)) },
    poleSouth: { value: band(Math.max(0, south - 0.06), south) },
    poleCut: {
      value: new THREE.Vector2(north > 0 ? Math.cos(north * Math.PI) : 2, south < 1 ? -Math.cos(south * Math.PI) : 2),
    },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPole;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPole = normalize(position).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vPole; uniform vec3 poleNorth, poleSouth; uniform vec2 poleCut;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float poleCutAt = vPole > 0. ? poleCut.x : poleCut.y, poleY = abs(vPole);
        float poleFade = poleCutAt > 1. ? 0. : smoothstep(.95, .997, poleY) * .9;
        float poleFlat = poleCutAt > 1. ? 0. : smoothstep(poleCutAt, 1., poleY);
        diffuseColor.rgb = mix(diffuseColor.rgb, vPole > 0. ? poleNorth : poleSouth, poleFade);`,
      )
      // Mirrored texture reverses the encoded north-south slope; the derivative tangent frame
      // does not, so flip it back there.
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'mapN.xy *= normalScale;',
          'mapN.xy *= normalScale;\nif (poleY > poleCutAt) mapN.y = -mapN.y;',
        ) + '\nnormal = normalize(mix(normal, nonPerturbedNormal, max(poleFlat, poleFade)));',
      );
  };
  material.customProgramCacheKey = () => 'planet-pole-fill';
}

function disposeParts(parts) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  for (const part of parts) {
    geometries.add(part.geometry);
    geometries.add(part.far);
    materials.add(part.material);
    for (const v of Object.values(part.material)) if (v?.isTexture) textures.add(v);
    for (const v of Object.values(part.mediumMaps ?? {})) if (v?.isTexture) textures.add(v);
  }
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  textures.forEach(t => t.dispose());
}

// A part draws `geometry` at full detail and `far` once the body is small on screen.
const atmospherePart = (entry, sun) => ({
  geometry: new THREE.SphereGeometry(ATMOSPHERE, 32, 20),
  far: new THREE.SphereGeometry(ATMOSPHERE, 16, 10),
  material: atmosphereMaterial(entry.atmosphere, sun),
  pickable: false,
  atmosphere: true,
});

async function loadParts(entry, sun) {
  if (entry.mesh) {
    const gltf = await new GLTFLoader().loadAsync(assetUrl(entry.mesh));
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) throw new Error('Planet import must split material groups: ' + entry.id);
      const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const material = o.material;
      material.metalness = 0;
      // Authored globes are already within the orbital triangle budget.
      parts.push({ geometry, far: geometry, material, pickable: true });
      o.geometry.dispose();
    });
    if (!parts.length) throw new Error('Empty planet mesh: ' + entry.id);
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
    }
    const center = box.getCenter(new THREE.Vector3());
    let radius = 0;
    for (const { geometry } of parts) {
      geometry.translate(-center.x, -center.y, -center.z);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++)
        radius = Math.max(radius, Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i)));
    }
    if (!Number.isFinite(radius) || radius < 1e-6) throw new Error('Invalid planet bounds: ' + entry.id);
    for (const { geometry } of parts) {
      geometry.scale(1 / radius, 1 / radius, 1 / radius);
      geometry.computeBoundingSphere();
    }
    if (entry.atmosphere) parts.push(atmospherePart(entry, sun));
    return parts;
  }
  const owned = [];
  const load = async (file, color = false) => {
    if (!file) return null;
    const map = await texture(file, color);
    owned.push(map);
    return map;
  };
  try {
    const results = await Promise.allSettled([
      load(entry.maps.albedo, true),
      load(entry.maps.normal),
      load(entry.maps.roughness),
      load(entry.maps.clouds, true),
      entry.maps.height
        ? fetch(assetUrl(entry.maps.height)).then(r => {
            if (!r.ok) throw new Error('Missing planet height: ' + entry.id);
            return r.arrayBuffer();
          })
        : null,
    ]);
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    const [map, normalMap, roughnessMap, cloudMap, heights] = results.map(r => r.value);
    if (heights && heights.byteLength !== 128 * 64 * 2) throw new Error('Invalid planet height field: ' + entry.id);
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: entry.id === 'earth' ? 0.72 : 0.95,
      metalness: 0,
    });
    if (entry.polarFill) fadeFilledPoles(material, map.image, entry.polarFill);
    const parts = [
      {
        geometry: planetSurfaceGeometry(entry, heights),
        far: planetSurfaceGeometry(entry, null, 24, 16),
        material,
        pickable: true,
        heights, // orbital height field
      },
    ];
    if (cloudMap)
      parts.push({
        geometry: new THREE.SphereGeometry(1.018, 48, 32),
        far: new THREE.SphereGeometry(1.018, 24, 16),
        pickable: false,
        drift: true,
        cloud: true,
        material: new THREE.MeshStandardMaterial({
          map: cloudMap,
          transparent: true,
          opacity: entry.cloudOpacity,
          depthWrite: false,
          roughness: 1,
          metalness: 0,
        }),
      });
    if (entry.atmosphere) parts.push(atmospherePart(entry, sun));
    return parts;
  } catch (error) {
    owned.forEach(t => t.dispose());
    throw error;
  }
}

// Landed terrain colours come from the asset's own albedo: a 64×32 RGB downsample,
// cached per asset. Ocean worlds also mark water texels, so land never takes sea colour.
const groundSamples = new Map();
export function planetGroundSample(entry) {
  if (!groundSamples.has(entry.id))
    groundSamples.set(
      entry.id,
      (async () => {
        let image, release;
        if (entry.mesh) {
          const gltf = await new GLTFLoader().loadAsync(assetUrl(entry.mesh));
          gltf.scene.traverse(o => {
            if (o.isMesh && !image && o.material.map) image = o.material.map.image;
          });
          release = () =>
            gltf.scene.traverse(o => {
              if (!o.isMesh) return;
              o.geometry.dispose();
              for (const v of Object.values(o.material)) if (v?.isTexture) v.dispose();
              o.material.dispose();
            });
        } else {
          const response = await fetch(assetUrl(entry.maps.albedo));
          if (!response.ok) throw new Error('Missing planet albedo: ' + entry.id);
          image = await createImageBitmap(await response.blob());
          release = () => image.close();
        }
        if (!image) throw new Error('Planet has no albedo: ' + entry.id);
        const width = 64,
          height = 32,
          canvas = new OffscreenCanvas(width, height),
          context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);
        release();
        const pixels = context.getImageData(0, 0, width, height).data,
          rgb = new Uint8Array(width * height * 3),
          water = entry.waterTexels ? new Uint8Array(width * height) : null,
          sums = { land: [0, 0, 0, 0], water: [0, 0, 0, 0] };
        for (let i = 0; i < width * height; i++) {
          const r = pixels[i * 4],
            g = pixels[i * 4 + 1],
            b = pixels[i * 4 + 2];
          rgb.set([r, g, b], i * 3);
          const wet = water && b > r + 12 && b + 4 >= g;
          if (water) water[i] = wet ? 1 : 0;
          const sum = wet ? sums.water : sums.land;
          sum[0] += r;
          sum[1] += g;
          sum[2] += b;
          sum[3]++;
        }
        const mean = ([r, g, b, n]) => (n ? [r / n / 255, g / n / 255, b / n / 255] : null);
        // An authored globe's albedo is a UV atlas: position in it is not a place on the
        // sphere, so landed ground uses its mean colour everywhere.
        if (entry.mesh) {
          const [r, g, b, n] = sums.land;
          for (let i = 0; i < width * height; i++) rgb.set([r / n, g / n, b / n], i * 3);
        }
        return { width, height, rgb, water, land: mean(sums.land) || [0.5, 0.5, 0.5], ocean: mean(sums.water) };
      })().catch(error => {
        console.warn('Planet ground sample unavailable', error);
        return null;
      }),
    );
  return groundSamples.get(entry.id);
}

// One instance batch per asset, submesh and detail tier, never a GLB load or material per
// file. Each frame packs the visible bodies into the front of their tier's batch, so
// hidden, sub-pixel and expired bodies cost nothing. Resources belong to this view; async
// completion cannot attach to a disposed view.
export class PlanetBodies {
  constructor(scene, onChange = () => {}) {
    this.scene = scene;
    this.onChange = onChange;
    this.meshes = [];
    this.batches = new Map();
    this.members = [];
    this.membership = new Map();
    this.tints = new Map();
    this.near = new Set();
    this.resources = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.prune = null;
    this.disposed = false;
    this.sun = new THREE.Vector3(0, 1, 0);
    this.sunLight = scene.children.find(o => o.isDirectionalLight) || null;
    this.pxPerUnit = 0;
    this.eye = new THREE.Vector3();
    this.shade = new THREE.Color();
    this.drawn = { calls: 0, triangles: 0 };
  }
  resource(entry) {
    if (!this.resources.has(entry.id)) {
      this.resources.set(entry.id, [
        {
          geometry: planetSurfaceGeometry(entry),
          far: planetSurfaceGeometry(entry, null, 24, 16),
          material: new THREE.MeshStandardMaterial({ color: entry.land, roughness: 0.9 }),
          pickable: true,
        },
      ]);
      const promise = loadParts(entry, this.sun)
        .then(parts => {
          if (this.disposed) {
            disposeParts(parts);
            return;
          }
          const old = this.resources.get(entry.id);
          this.resources.set(entry.id, parts);
          // Only this asset's batch changes; other assets keep their GPU buffers.
          const batch = this.batches.get(entry.id);
          if (batch) {
            this.dropBatch(batch);
            this.addBatch(entry, batch.members);
            this.onChange();
          }
          disposeParts(old);
        })
        .catch(error => {
          if (!this.disposed) this.errors.set(entry.id, error.message);
        })
        .finally(() => {
          this.pending.delete(entry.id);
        });
      this.pending.set(entry.id, promise);
    }
    return this.resources.get(entry.id);
  }
  // The fully loaded parts of an asset (never the placeholder), for a landed close-up that draws the same body.
  async loaded(entry) {
    this.resource(entry);
    await this.pending.get(entry.id);
    if (this.errors.has(entry.id)) throw new Error(this.errors.get(entry.id));
    return this.resources.get(entry.id);
  }
  // Parts for landing: the first landing on a world with detail maps upgrades its shared material to them (every
  // instance of that world sharpens with it, and the orbital look is unchanged) and adds the finer height field.
  async landing(entry, prepare) {
    const parts = await this.loaded(entry),
      surface = parts.find(p => p.pickable);
    if (!entry.detail?.albedo || !surface || entry.mesh) return parts;
    surface.upgrade ??= (async () => {
      const results = await Promise.allSettled([
        texture(entry.detail.albedo, true, true),
        entry.detail.normal ? texture(entry.detail.normal, false, true) : null,
        entry.detail.roughness ? texture(entry.detail.roughness, false, true) : null,
        entry.detail.height
          ? fetch(assetUrl(entry.detail.height)).then(r => {
              if (!r.ok) throw new Error('Missing planet detail height: ' + entry.id);
              return r.arrayBuffer();
            })
          : null,
      ]);
      const loaded = results.map(result => (result.status === 'fulfilled' ? result.value : null));
      const [map, normalMap, roughnessMap, heights] = loaded;
      const release = () => [map, normalMap, roughnessMap].forEach(t => t?.dispose());
      const failure = results.find(result => result.status === 'rejected');
      if (failure) {
        release();
        throw failure.reason;
      }
      const size = entry.detail.heightSize;
      if (heights && (!size || heights.byteLength !== size[0] * size[1] * 2)) {
        release();
        throw new Error('Invalid planet detail height: ' + entry.id);
      }
      if (this.disposed) {
        release();
        return;
      }
      try {
        for (const next of [map, normalMap, roughnessMap].filter(Boolean)) await prepare?.(next);
      } catch (error) {
        release();
        throw error;
      }
      if (this.disposed) {
        release();
        return;
      }
      const material = surface.material;
      for (const [key, next] of [
        ['map', map],
        ['normalMap', normalMap],
        ['roughnessMap', roughnessMap],
      ])
        if (next) {
          material[key]?.dispose();
          material[key] = next;
        }
      material.needsUpdate = true;
      if (heights) {
        surface.detailHeights = heights;
        surface.detailSize = entry.detail.heightSize;
      }
    })().catch(error => {
      // The orbital maps still draw the close-up; the failure is reported, not hidden.
      surface.detailError = error.message;
      this.errors.set(entry.id + ':detail', error.message);
    });
    await surface.upgrade;
    return parts;
  }
  async setHighDetail(entry, enabled, signal, prepare) {
    const parts = await this.landing(entry),
      surface = parts.find(p => p.pickable);
    if (!entry.close || !surface) return false;
    const serial = (this.detailSerial = (this.detailSerial ?? 0) + 1);
    const restore = () => {
      const old = this.highSurface;
      if (!old) return;
      const high = [old.material.map, old.material.normalMap, old.material.roughnessMap];
      Object.assign(old.material, old.mediumMaps);
      old.material.needsUpdate = true;
      high.forEach(t => t?.dispose());
      this.highSurface = null;
    };
    if (!enabled) {
      restore();
      return false;
    }
    if (this.highSurface === surface) return true;
    const results = await Promise.allSettled([
      texture(entry.close.albedo, true, true),
      texture(entry.close.normal, false, true),
      texture(entry.close.roughness, false, true),
    ]);
    const maps = results.map(result => (result.status === 'fulfilled' ? result.value : null));
    const release = () => maps.forEach(t => t?.dispose());
    try {
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (maps.some(map => map.image.width !== 4096 || map.image.height !== 2048))
        throw new Error('Invalid 4K terrain dimensions: ' + entry.id);
      for (const map of maps) {
        if (signal.aborted || this.disposed || serial !== this.detailSerial) {
          release();
          return false;
        }
        await prepare(map);
      }
      if (signal.aborted || this.disposed || serial !== this.detailSerial) {
        release();
        return false;
      }
      // Only one world keeps 4K maps; orbital instances share the same surface material.
      restore();
      surface.mediumMaps ??= {
        map: surface.material.map,
        normalMap: surface.material.normalMap,
        roughnessMap: surface.material.roughnessMap,
      };
      Object.assign(surface.material, { map: maps[0], normalMap: maps[1], roughnessMap: maps[2] });
      surface.material.needsUpdate = true;
      this.highSurface = surface;
      return true;
    } catch (error) {
      release();
      throw error;
    }
  }
  addBatch(entry, members) {
    const tier = far => {
      const fileIds = [],
        meshes = [];
      for (const part of this.resource(entry)) {
        const geometry = far ? part.far : part.geometry;
        const mesh = new THREE.InstancedMesh(geometry, part.material, members.length);
        mesh.name = 'planet-library-' + entry.id + (far ? '-far' : '');
        mesh.count = 0;
        mesh.frustumCulled = false; // Kepler motion changes the bounds every frame.
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, this.shade.setScalar(1));
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.planetAsset = entry.id;
        mesh.userData.pickablePlanet = part.pickable;
        mesh.userData.fileIds = fileIds;
        mesh.userData.drift = !!part.drift;
        mesh.userData.triangles = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
        this.scene.add(mesh);
        this.meshes.push(mesh);
        meshes.push(mesh);
      }
      return { meshes, fileIds, count: 0 };
    };
    const batch = { entry, members, near: tier(false), far: tier(true) };
    for (const member of members) this.membership.set(member.path, { batch, member });
    this.batches.set(entry.id, batch);
    return batch;
  }
  dropBatch(batch) {
    for (const mesh of [...batch.near.meshes, ...batch.far.meshes]) {
      mesh.removeFromParent();
      mesh.dispose();
      this.meshes.splice(this.meshes.indexOf(mesh), 1);
    }
    this.batches.delete(batch.entry.id);
  }
  rebuild(members) {
    if (this.disposed) return;
    for (const batch of [...this.batches.values()]) this.dropBatch(batch);
    this.members = members;
    this.membership.clear();
    this.prune = null;
    const groups = new Map();
    for (const member of members) {
      const entry = member.entry ?? planetProfile(member.path);
      if (!groups.has(entry.id)) groups.set(entry.id, { entry, members: [] });
      groups.get(entry.id).members.push(member);
    }
    const kept = new Set(members.map(m => m.path));
    for (const key of this.tints.keys()) if (!kept.has(key)) this.tints.delete(key);
    for (const key of this.near) if (!kept.has(key)) this.near.delete(key);
    for (const { entry, members: group } of groups.values()) this.addBatch(entry, group);
    this.onChange();
  }
  begin(camera, viewportHeight) {
    // Expired ghosts leave between frames, never between a frame's placements.
    if (this.prune) {
      const active = this.prune;
      this.prune = null;
      this.rebuild(this.members.filter(m => !m.ghost || active.has(m.path)));
    }
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.pxPerUnit = camera.isPerspectiveCamera
      ? viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      : Infinity;
    for (const batch of this.batches.values()) batch.near.count = batch.far.count = 0;
  }
  pruneGhosts(activePaths) {
    if (this.members.some(m => m.ghost && !activePaths.has(m.path))) this.prune = activePaths;
  }
  place(path, matrix, surfaceOnly = false) {
    const owner = this.membership.get(path);
    if (!owner) return;
    const e = matrix.elements,
      scale = Math.hypot(e[0], e[1], e[2]),
      distance = Math.max(1e-6, Math.hypot(e[12] - this.eye.x, e[13] - this.eye.y, e[14] - this.eye.z)),
      px = (scale * this.pxPerUnit) / distance;
    if (!(px >= MIN_PX)) return;
    const near = this.near.has(path) ? px > NEAR_OUT : px > NEAR_IN;
    if (near) this.near.add(path);
    else this.near.delete(path);
    const tier = near ? owner.batch.near : owner.batch.far,
      slot = tier.count++;
    this.shade.setScalar(this.tints.get(path) ?? 1);
    for (const mesh of tier.meshes) {
      mesh.setMatrixAt(slot, surfaceOnly && !mesh.userData.pickablePlanet ? hiddenPlanetPart : matrix);
      mesh.setColorAt(slot, this.shade);
    }
    tier.fileIds[slot] = owner.member.fileId;
  }
  color(path, brightness) {
    // Applied as each body is placed; slots move between frames.
    this.tints.set(path, brightness);
  }
  end(time = 0) {
    if (this.sunLight) this.sun.copy(this.sunLight.position).sub(this.sunLight.target.position).normalize();
    let calls = 0,
      triangles = 0;
    for (const batch of this.batches.values())
      for (const tier of [batch.near, batch.far]) {
        tier.fileIds.length = tier.count;
        for (const mesh of tier.meshes) {
          mesh.count = tier.count;
          if (!tier.count) continue;
          calls++;
          triangles += mesh.userData.triangles * tier.count;
          mesh.instanceMatrix.clearUpdateRanges();
          mesh.instanceMatrix.addUpdateRange(0, tier.count * 16);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.clearUpdateRanges();
          mesh.instanceColor.addUpdateRange(0, tier.count * 3);
          mesh.instanceColor.needsUpdate = true;
          // InstancedMesh also uses this bound during raycasting, even with render culling off.
          mesh.boundingSphere = null;
          // Cloud layers drift slowly eastward in simulation time, so pausing stops them.
          if (mesh.userData.drift) mesh.material.map.offset.x = (-time * 0.004) % 1;
        }
      }
    this.drawn = { calls, triangles };
  }
  stats() {
    const live = this.members.filter(m => !m.ghost);
    return {
      planets: live.length,
      assets: [...this.batches.values()].map(b => ({
        id: b.entry.id,
        origin: b.entry.origin,
        instances: b.members.filter(m => !m.ghost).length,
        near: b.near.count,
        far: b.far.count,
        triangles: b.near.meshes.reduce((n, m) => n + m.userData.triangles, 0),
      })),
      drawCalls: this.drawn.calls,
      triangles: this.drawn.triangles,
      pending: [...this.pending.keys()],
      errors: Object.fromEntries(this.errors),
    };
  }
  dispose() {
    this.disposed = true;
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    for (const parts of this.resources.values()) disposeParts(parts);
    this.resources.clear();
    this.meshes.length = 0;
    this.batches.clear();
    this.members = [];
    this.membership.clear();
    this.tints.clear();
    this.near.clear();
  }
}
