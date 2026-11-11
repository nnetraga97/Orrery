// The sky island under the agent cannon: a dormant fortress town that wakes while the agent works.
//
// Asleep it sits at dusk with warm windows, slow sails and a still town. Thinking snaps it
// awake in a cascade out from the cannon: channels pulse toward the crown, gears and the tram
// run, airships launch, and every house plays its own small motion. At turn end it winds down
// over a few seconds. The propellers under the island always turn.
//
// Placements come from assets/island/layout.json in the base mesh's units (Blender Z-up,
// polar around the island centre). The group's origin is the centre of the crown plaza, so
// the cannon stands at (0, 0, 0). Moving parts come from assets/island/parts.glb
// (scripts/island-parts.py); each turns about its own +Y.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { glowTex } from '../scene/textures.js';

// A host may ask for a lighter island: only the first landmark and the first house use their modelled buildings, the
// rest are simple blocks (the XR app does, for a headset's budget).
export const IslandDetail = { full: true };

// A host may hold the island still while the agent is idle (the XR app does: at a seated user's scale the idle propellers,
// smoke, fans and lanterns read as noise). Waking still plays every motion.
export const IslandMotion = { idle: true };

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const DUSK = new THREE.Color(0.68, 0.7, 0.82); // retain readable stone and roofs while asleep
const ENERGY = new THREE.Color().setRGB(0.25, 0.9, 1.0, THREE.SRGBColorSpace);

const loader = new GLTFLoader();
const loadGlb = url => loader.loadAsync(url).then(g => g.scene);

// Machines dwell, move, dwell and return rather than oscillating sinusoidally (as in lot-motion.js).
const cycle = f => {
  f -= Math.floor(f);
  return THREE.MathUtils.smoothstep(f, 0, 0.3) - THREE.MathUtils.smoothstep(f, 0.55, 0.85);
};

export function createSkyIsland({ width }) {
  const group = new THREE.Group();
  group.name = 'Sky_Island';
  const disposables = [];
  const uniforms = { uAwake: { value: 0 }, uTime: { value: 0 }, uRippleAt: { value: -100 } };
  const anims = []; // { level, wakeAt, delay, step(dt, level, t) }
  const lots = [],
    pickables = [];
  let terrain = null;
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const selectionGeometry = new THREE.BufferGeometry();
  selectionGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const selectionMaterial = new THREE.LineBasicMaterial({ color: '#a8e5ff', transparent: true, opacity: 0.9 });
  const selection = new THREE.LineLoop(selectionGeometry, selectionMaterial);
  selection.name = 'Island_Building_Selection';
  selection.visible = false;
  disposables.push(pickMaterial, selectionGeometry, selectionMaterial);
  const state = { awake: false, waiting: false, t: 0, level: 0 };
  let L = null; // layout
  let scale = 1;

  // Blender Z-up island coordinates → this group's space (Y up, origin on the crown plaza).
  const at = (angle, r, z, out = new THREE.Vector3()) => {
    const a = THREE.MathUtils.degToRad(angle);
    return out.set(r * Math.cos(a), z - L.tiers.crown, -r * Math.sin(a));
  };
  const outward = angle => {
    const a = THREE.MathUtils.degToRad(angle);
    return new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  };
  const tangent = angle => outward(angle).cross(UP).negate(); // counter-clockwise seen from above

  // Local bounce lighting keeps the rock, soffits and machinery legible from below.
  // This runs only on island materials, without adding lights to every planet's shader.
  const islandFill = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      vec3 islandNormal = inverseTransformDirection(normal, viewMatrix);
      float underFace = .28 + .72 * max(0., -islandNormal.y);
      float warmSide = .5 + .5 * dot(islandNormal, normalize(vec3(-1., .15, 1.)));
      reflectedLight.indirectDiffuse += diffuseColor.rgb *
        (vec3(.24, .31, .34) * underFace + vec3(.12, .085, .045) * warmSide);
    `,
    );
  };

  // Dusk tint for every opaque island material: albedo dims toward violet while asleep.
  const duskify = mat => {
    const m = mat.clone();
    disposables.push(m);
    const prior = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prior?.call(m, shader, r);
      islandFill(shader);
      shader.uniforms.uAwake = uniforms.uAwake;
      shader.uniforms.uDusk = { value: DUSK };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uAwake; uniform vec3 uDusk;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(uDusk, vec3(1.0), uAwake);',
        );
    };
    m.customProgramCacheKey = () => 'sky-island-dusk';
    return m;
  };

  // The base also carries the fire ripple: a ring of light running from the crown to the rim.
  const baseMaterial = (mat, centre) => {
    const m = mat.clone();
    disposables.push(m);
    m.onBeforeCompile = shader => {
      islandFill(shader);
      Object.assign(shader.uniforms, uniforms, {
        uDusk: { value: DUSK },
        uCentre: { value: centre },
        uEnergy: { value: ENERGY },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vIsland;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIsland = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uAwake, uTime, uRippleAt; uniform vec3 uDusk, uEnergy; uniform vec2 uCentre; varying vec3 vIsland;',
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(uDusk, vec3(1.0), uAwake);',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Permanent soft sky/engine bounce, with the original rock texture retained.
          float lowerRock = 1. - smoothstep(.18, .48, vIsland.y);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(.16, .22, .24) * lowerRock;
          float islandR = length(vIsland.xz - uCentre) / 0.9;
          float islandAge = uTime - uRippleAt;
          float islandFront = islandAge * 0.9;
          totalEmissiveRadiance += uEnergy * 0.9 * exp(-pow((islandR - islandFront) / 0.06, 2.0)) * max(0.0, 1.0 - islandAge / 1.4);`,
        );
    };
    m.customProgramCacheKey = () => 'sky-island-base';
    return m;
  };

  const addAnim = (origin, step) => {
    const a = { level: 0, wakeAt: Infinity, delay: 0, step, origin };
    anims.push(a);
    return a;
  };

  // ---------- energy channels: strips in the wall slots, pulsing up toward the crown ----------
  const channelMaterial = () => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uLevel: { value: 0 }, uColor: { value: ENERGY } },
      vertexShader:
        'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime, uLevel; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          float pulse = pow(0.5 + 0.5 * sin(vUv.y * 18.0 - uTime * 7.0), 3.0);
          float glow = 0.12 + uLevel * (0.35 + 0.9 * pulse);
          gl_FragColor = vec4(uColor * glow * 1.6, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    });
    disposables.push(m);
    return m;
  };

  // ---------- waterfall: a scrolling sheet that fades into space ----------
  const waterfall = spec => {
    const [z0, z1] = spec.z,
      h = z0 - z1;
    const geo = new THREE.PlaneGeometry(spec.width, h, 1, 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; vec3 p = position;
        p.z += (1.0 - uv.y) * (1.0 - uv.y) * 0.12; // the stream arcs away from the rim as it falls
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float n(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          float streak = n(vec2(floor(vUv.x * 14.0), 0.0));
          float flow = fract(vUv.y * 3.0 + uTime * (0.6 + 0.5 * streak));
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
          float fade = smoothstep(0.0, 0.6, vUv.y);
          float a = edge * fade * (0.35 + 0.45 * smoothstep(0.3, 1.0, flow));
          gl_FragColor = vec4(mix(sRGBTransferEOTF(vec4(0.55, 0.85, 1.0, 1.0)).rgb, vec3(1.0), flow * 0.5), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    at(spec.angle, spec.r, (z0 + z1) / 2, mesh.position);
    mesh.lookAt(mesh.position.clone().add(outward(spec.angle)));
    return mesh;
  };

  // ---------- placeholders until the generated buildings arrive ----------
  const placeholderMats = new Map();
  const block = (w, h, color, roof) => {
    const g = new THREE.Group();
    const key = color + roof;
    if (!placeholderMats.has(key)) {
      placeholderMats.set(key, [
        duskify(new THREE.MeshStandardMaterial({ color, roughness: 0.8 })),
        duskify(new THREE.MeshStandardMaterial({ color: roof, roughness: 0.7 })),
      ]);
    }
    const [wall, top] = placeholderMats.get(key);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), wall);
    body.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, h * 0.35, 4), top);
    cap.position.y = h + h * 0.17;
    cap.rotation.y = Math.PI / 4;
    disposables.push(body.geometry, cap.geometry);
    g.add(body, cap);
    return g;
  };

  // A building frame: x along the tangent, z outward (the front), y up.
  const frame = (angle, r, z) => {
    const g = new THREE.Group();
    at(angle, r, z, g.position);
    g.lookAt(g.position.clone().add(outward(angle)));
    return g;
  };

  function registerLot(spec, object, height, index = null) {
    // Simple fitted volumes make small textured roofs easy to hit without
    // raycasting every triangle in every building on each pointer move.
    object.updateWorldMatrix(true, true);
    const inverse = object.matrixWorld.clone().invert(),
      bounds = new THREE.Box3();
    object.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      bounds.union(o.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)));
    });
    bounds.expandByScalar(0.004);
    const geometry = new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()).toArray());
    const proxy = new THREE.Mesh(geometry, pickMaterial);
    proxy.position.copy(bounds.getCenter(new THREE.Vector3()));
    proxy.name = 'Island_Pick_' + spec.id;
    proxy.userData.islandLot = spec.id;
    object.add(proxy);
    disposables.push(geometry);
    pickables.push(proxy);
    const title =
      spec.name ||
      (index == null
        ? spec.id
            .split('-')
            .map(s => s[0].toUpperCase() + s.slice(1))
            .join(' ')
        : `House ${index + 1}`);
    lots.push({ ...spec, title, object, height });
  }

  // ---------- small per-house motions, so no two neighbours behave alike ----------
  const houseMotion = (kind, house, size, height, parts, seed) => {
    const make = name => {
      const src = parts[name];
      if (!src) return null;
      const o = src.clone();
      house.add(o);
      return o;
    };
    const roof = height * 1.05;
    switch (kind) {
      case 'fan': {
        const fan = make('Roof_Fan');
        if (!fan) return;
        fan.position.set(size * 0.2, roof, 0);
        addAnim(house, (dt, l) => (fan.rotation.y += dt * TAU * (0.15 + 1.6 * l)));
        return;
      }
      case 'shutters': {
        const pair = [-1, 1].map(s => {
          const sh = make('Shutter');
          if (!sh) return null;
          sh.position.set(s * size * 0.2, height * 0.55, size * 0.51);
          sh.rotation.y = s > 0 ? Math.PI : 0;
          return sh;
        });
        addAnim(house, (dt, l) =>
          pair.forEach(
            (sh, i) =>
              sh && (sh.rotation.y = (i ? Math.PI : 0) + (i ? 1 : -1) * 1.6 * THREE.MathUtils.smoothstep(l, 0, 1)),
          ),
        );
        return;
      }
      case 'lantern': {
        const lamp = make('Lantern');
        if (!lamp) return;
        lamp.position.set(size * 0.32, height * 0.45, size * 0.55);
        addAnim(house, (dt, l, t) => {
          const flicker = 0.85 + 0.15 * Math.sin(t * 17 + seed) * Math.sin(t * 7.3 + seed * 3);
          lamp.scale.setScalar(flicker * (1 + 0.15 * l));
        });
        return;
      }
      case 'drone': {
        const d = make('Drone');
        if (!d) return;
        let phase = seed;
        addAnim(house, (dt, l) => {
          phase += dt * (0.4 + 0.5 * l);
          const lift = THREE.MathUtils.smoothstep(l, 0, 1);
          d.position.set(
            Math.cos(phase) * size * 1.6 * lift,
            roof + 0.012 + lift * (0.05 + 0.01 * Math.sin(phase * 3)),
            Math.sin(phase) * size * 1.6 * lift,
          );
          d.rotation.y = -phase;
        });
        return;
      }
      case 'door': {
        const geo = new THREE.BoxGeometry(size * 0.22, height * 0.38, size * 0.02);
        geo.translate(size * 0.11, height * 0.19, 0);
        const door = new THREE.Mesh(geo, duskify(new THREE.MeshStandardMaterial({ color: '#5a3a20', roughness: 0.8 })));
        disposables.push(geo);
        door.position.set(-size * 0.11, 0, size * 0.51);
        house.add(door);
        addAnim(house, (dt, l, t) => (door.rotation.y = -1.3 * l * cycle(t * 0.12 + seed)));
        return;
      }
      case 'laundry': {
        const geo = new THREE.PlaneGeometry(size * 0.5, height * 0.18, 6, 1);
        const mat = duskify(
          new THREE.MeshStandardMaterial({ color: '#e8e0d0', side: THREE.DoubleSide, roughness: 0.9 }),
        );
        disposables.push(geo);
        const cloth = new THREE.Mesh(geo, mat);
        cloth.position.set(0, height * 0.75, size * 0.62);
        house.add(cloth);
        const base = geo.attributes.position.array.slice();
        addAnim(house, (dt, l, t) => {
          const p = geo.attributes.position.array;
          for (let i = 0; i < p.length; i += 3)
            p[i + 2] =
              base[i + 2] +
              Math.sin(t * (2 + 4 * l) + base[i] * 90 + seed) * (0.002 + 0.006 * l) * (base[i + 1] < 0 ? 1 : 0.2);
          geo.attributes.position.needsUpdate = true;
        });
        return;
      }
      case 'smoke':
      case 'sprinkler': {
        const smoke = kind === 'smoke';
        const puffs = [];
        const mat = new THREE.SpriteMaterial({
          map: glowTex,
          color: smoke ? '#c9c2b8' : '#bfe8ff',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        disposables.push(mat);
        for (let i = 0; i < 5; i++) {
          const s = new THREE.Sprite(mat.clone());
          disposables.push(s.material);
          house.add(s);
          puffs.push(s);
        }
        const origin = smoke
          ? new THREE.Vector3(-size * 0.25, roof + 0.01, -size * 0.1)
          : new THREE.Vector3(0, roof, 0);
        addAnim(house, (dt, l, t) => {
          puffs.forEach((s, i) => {
            const f = (t * (smoke ? 0.25 : 0.8) + i / puffs.length + seed) % 1;
            const k = smoke ? (IslandMotion.idle ? 0.3 : 0) + 0.7 * l : l;
            s.position
              .copy(origin)
              .add(
                smoke
                  ? new THREE.Vector3(f * 0.012, f * 0.06, f * 0.008)
                  : new THREE.Vector3(
                      Math.cos(i * 1.3) * f * size * 0.6,
                      f * 0.015 - f * f * 0.02,
                      Math.sin(i * 1.3) * f * size * 0.6,
                    ),
              );
            s.scale.setScalar((smoke ? 0.01 + 0.025 * f : 0.006) * (0.6 + 0.4 * k));
            s.material.opacity = (smoke ? 0.55 : 0.6) * k * Math.sin(Math.PI * f);
          });
        });
        return;
      }
    }
  };

  const ready = (async () => {
    L = await fetch('assets/island/layout.json').then(r => r.json());
    const [base, partsScene] = await Promise.all([loadGlb(L.base), loadGlb(L.parts)]);
    // Base mesh units → width; the crown plaza centre is the origin.
    const box = new THREE.Box3().setFromObject(base);
    scale = width / Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    group.scale.setScalar(scale);
    const [plazaX, plazaY] = L.plaza?.offset || [0, 0];
    // The terrain's upper platform is offset from its old polar layout origin.
    // Seat the assembled island around the cannon, keeping every town lot and
    // machine attached to its terrain while the paving stays concentric at zero.
    group.position.set(-plazaX * scale, 0, plazaY * scale);
    const centre = new THREE.Vector2(L.centre[0], -L.centre[1]); // Blender (x, y) → glTF (x, -z)
    base.position.set(-centre.x, -L.tiers.crown, -centre.y);
    base.traverse(o => {
      if (o.isMesh) o.material = baseMaterial(o.material, new THREE.Vector2(centre.x + plazaX, centre.y - plazaY));
    });
    group.add(base);
    terrain = base;
    if (L.architecture) {
      const architecture = await loadGlb(L.architecture);
      architecture.position.copy(base.position);
      architecture.traverse(o => {
        if (o.isMesh) o.material = duskify(o.material);
      });
      group.add(architecture);
    }

    // Parts, keyed by name and recentred on their pivots.
    const parts = {};
    partsScene.traverse(o => {
      if (!o.isMesh && !(o.children.length && o.name)) return;
      if (o.parent !== partsScene) return;
      const c = o.clone();
      c.position.set(0, 0, 0);
      c.traverse(m => {
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const swapped = mats.map(mat => (mat.emissive && mat.emissive.getHex() > 0 ? mat : duskify(mat)));
        m.material = Array.isArray(m.material) ? swapped : swapped[0];
      });
      parts[o.name] = c;
    });
    const part = (name, scaleTo) => {
      const p = parts[name]?.clone();
      if (p && scaleTo) p.scale.setScalar(scaleTo);
      return p;
    };
    const crownDist = v => Math.hypot(v.x, v.z);
    const maxDist = 1.0;

    // The crown collar seats the cannon's mount in the socket; its energy ring is where the
    // wall channels lead, so it brightens with them.
    const collar = part('Crown_Collar');
    if (collar) {
      collar.position.set(plazaX, 0, -plazaY);
      const glows = [];
      collar.traverse(m => {
        if (!m.isMesh) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => {
          if (!(mat.emissive?.getHex() > 0)) return mat;
          const own = mat.clone();
          disposables.push(own);
          glows.push(own);
          return own;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      });
      group.add(collar);
      addAnim(collar, (dt, l, t) =>
        glows.forEach(g => (g.emissiveIntensity = 0.25 + l * (1.6 + 0.6 * Math.sin(t * 6)))),
      );
    }

    // Gears in the wall recesses: stopped asleep, turning awake.
    for (const g of L.gears) {
      const gear = part('Gear', g.size / 0.065);
      if (!gear) continue;
      const pivot = new THREE.Group();
      at(g.angle, g.r + 0.012, g.z, pivot.position);
      pivot.quaternion.setFromUnitVectors(UP, outward(g.angle));
      pivot.add(gear);
      group.add(pivot);
      addAnim(pivot, (dt, l) => (gear.rotation.y += dt * g.dir * TAU * 0.12 * l));
    }

    const engineGlass = new THREE.MeshBasicMaterial({ color: '#7bcbd2', toneMapped: false });
    const engineHalo = new THREE.SpriteMaterial({
      map: glowTex,
      color: '#69b8c7',
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    disposables.push(engineGlass, engineHalo);
    // Propellers keep the island up, so their running lights stay on at rest too.
    for (const spec of L.propellers) {
      const [x, y, z] = spec.at;
      const prop = part('Propeller', spec.radius / 0.053);
      if (!prop) continue;
      prop.position.set(x - L.centre[0], z - L.tiers.crown, -(y - L.centre[1]));
      group.add(prop);
      const runningLight = new THREE.Mesh(new THREE.TorusGeometry(spec.radius * 0.88, 0.0018, 6, 48), engineGlass);
      runningLight.name = 'Engine_Running_Light';
      runningLight.rotation.x = Math.PI / 2;
      runningLight.position.copy(prop.position);
      runningLight.position.y += 0.007;
      group.add(runningLight);
      const halo = new THREE.Sprite(engineHalo);
      halo.position.copy(prop.position);
      halo.position.y -= 0.025;
      halo.scale.setScalar(spec.radius * 3.4);
      group.add(halo);
      const speed = 1.1 + 0.1 * Math.sin(x * 9);
      addAnim(prop, dt => (prop.rotation.y += dt * TAU * speed));
    }

    // Channels pulse toward the crown while awake.
    for (const c of L.channels) {
      const h = c.z[1] - c.z[0];
      const mat = channelMaterial();
      const path = c.path;
      const geo = new THREE.PlaneGeometry(0.008, h, 1, path ? path.length - 1 : 1);
      if (path) {
        const positions = geo.attributes.position;
        for (let i = 0; i < path.length; i++) {
          const [r, z] = path[path.length - 1 - i];
          for (let side = 0; side < 2; side++) {
            positions.setY(i * 2 + side, z - (c.z[0] + c.z[1]) / 2);
            positions.setZ(i * 2 + side, r - c.r - 0.004);
          }
        }
      }
      disposables.push(geo);
      const strip = new THREE.Mesh(geo, mat);
      at(c.angle, c.r + 0.004, (c.z[0] + c.z[1]) / 2, strip.position);
      strip.lookAt(strip.position.clone().add(outward(c.angle)));
      group.add(strip);
      addAnim(strip, (dt, l) => (mat.uniforms.uLevel.value = l));
    }

    group.add(waterfall(L.waterfall));

    // Landmarks: generated buildings from the Meshy sheets (scripts/split-sheet.py), scaled to
    // their footprint; a placeholder block stands in until a sheet is available.
    const sheetNames = [
      ...new Set(
        (IslandDetail.full ? [...L.landmarks, ...L.houses.lots] : [L.landmarks[0], L.houses.lots[0]].filter(Boolean))
          .map(m => m.mesh)
          .filter(Boolean)
          .map(r => r.split('#')[0]),
      ),
    ];
    const sheets = Object.fromEntries(
      await Promise.all(
        sheetNames.map(n =>
          loadGlb(`${L.sheets}${n}.glb`).then(
            s => [n, s],
            () => [n, null],
          ),
        ),
      ),
    );
    const sharedMats = new Map();
    const building = (ref, size) => {
      const [sheet, piece] = ref.split('#');
      const src = sheets[sheet]?.getObjectByName(piece);
      if (!src) return null;
      const o = src.clone();
      o.position.set(0, 0, 0);
      o.traverse(c => {
        if (!c.isMesh) return;
        if (!sharedMats.has(c.material)) sharedMats.set(c.material, duskify(c.material));
        c.material = sharedMats.get(c.material);
      });
      const b = new THREE.Box3().setFromObject(o),
        k = size / Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      o.scale.setScalar(k);
      o.position.set(-((b.min.x + b.max.x) / 2) * k, -b.min.y * k, -((b.min.z + b.max.z) / 2) * k);
      const g = new THREE.Group();
      g.add(o);
      g.userData.height = (b.max.y - b.min.y) * k;
      return g;
    };
    const palette = { wall: '#d9ccb0', roofs: ['#2f7f80', '#b0533a', '#c9a24a'] };
    L.landmarks.forEach((spec, i) => {
      let m = spec;
      const z = m.z ?? L.tiers[m.tier];
      const f = frame(m.angle, m.r, z);
      f.userData.landmark = m.id;
      const shell =
        (m.mesh && (IslandDetail.full || i === 0) && building(m.mesh, m.size)) ||
        block(m.size, m.height, palette.wall, palette.roofs[i % 3]);
      if (shell.userData.height) m = { ...m, height: shell.userData.height };
      shell.name = 'Landmark_' + m.id;
      f.add(shell);
      group.add(f);
      for (const p of m.parts || []) {
        const o = part(p.part);
        if (!o) continue;
        const holder = new THREE.Group();
        // Keep the attachment's fitted size separate from its animated local scale.
        holder.scale.setScalar(p.scale ?? 1);
        holder.position.set(p.at[0] * m.size, p.at[2] * m.height, -p.at[1] * m.size);
        if (p.face === 'out') holder.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1));
        if (p.face === 'side') holder.quaternion.setFromUnitVectors(UP, new THREE.Vector3(1, 0, 0));
        holder.add(o);
        f.add(holder);
        const mo = p.motion || {};
        let phase = i * 0.37;
        if (mo.kind === 'spin') {
          addAnim(f, (dt, l) => {
            phase += dt * THREE.MathUtils.lerp(mo.idle || 0, mo.awake || 0, l);
            o.rotation.y = mo.sweep ? mo.sweep * Math.sin(phase * TAU) : phase * TAU;
          });
        } else if (mo.kind === 'swing') {
          addAnim(f, (dt, l) => {
            phase += dt * (mo.speed || 0.1);
            o.rotation[mo.axis || 'x'] = (mo.awake || 0.3) * l * Math.sin(phase * TAU);
          });
        } else if (mo.kind === 'hammer') {
          addAnim(f, (dt, l, t) => (o.rotation.x = -0.9 * l * cycle(t * 0.7 + i)));
        } else if (mo.kind === 'unroll') {
          o.scale.z = 0.08;
          addAnim(f, (dt, l) => (o.scale.z = 0.08 + 0.92 * THREE.MathUtils.smoothstep(l - (mo.delay || 0), 0, 0.8)));
        } else if (mo.kind === 'bell') {
          let swing = 0;
          addAnim(f, (dt, l, t) => {
            swing += ((state.waiting ? 1 : 0) - swing) * Math.min(1, dt * 3);
            o.rotation.x = 0.55 * swing * Math.sin(t * 5.5);
          });
        } else if (mo.kind === 'beacon') {
          addAnim(f, (dt, l, t) =>
            o.scale.setScalar(state.waiting ? 1.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 6)) : 0.8 + 0.3 * l),
          );
        }
      }
      registerLot(m, f, m.height);
    });

    // Surveyed lots leave room for the retaining wall, tram and stair landings.
    const houseColors = ['#e2d6bc', '#d8c7a6', '#e9e0cc', '#cdbb98'];
    const houseRoofs = ['#2f7f80', '#b0533a', '#3d8f8a', '#a8482f', '#c9a24a'];
    L.houses.lots.forEach((lot, i) => {
      const size = lot.size;
      let height = size * (1.1 + (0.6 * ((i * 3) % 4)) / 3);
      const f = frame(lot.angle, lot.r, lot.z);
      f.name = lot.id;
      const mesh = lot.mesh && (IslandDetail.full || i === 0) && building(lot.mesh, size);
      if (mesh) height = mesh.userData.height;
      f.add(mesh || block(size, height, houseColors[i % houseColors.length], houseRoofs[(i * 3) % houseRoofs.length]));
      f.userData.house = i;
      group.add(f);
      houseMotion(lot.motion, f, size, height, parts, i * 1.7);
      registerLot(lot, f, height, i);
    });

    // Tram: two cars round the rim track, parked while asleep.
    const cars = [part('Tram_Car'), part('Tram_Car')].filter(Boolean);
    let tramAngle = 200;
    cars.forEach(c => group.add(c));
    if (cars.length)
      addAnim(cars[0], (dt, l) => {
        tramAngle += dt * 9 * l;
        cars.forEach((c, k) => {
          const a = tramAngle - k * 3.6;
          at(a, L.track.r, L.track.z, c.position);
          c.position.x += L.track.centre[0];
          c.position.z -= L.track.centre[1];
          c.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent(a));
        });
      });

    // Funicular: rides between the rim and the terrace.
    const fun = part('Funicular_Car');
    if (fun) {
      const a = at(L.funicular.from.angle, L.funicular.from.r, L.funicular.from.z),
        b = at(L.funicular.to.angle, L.funicular.to.r, L.funicular.to.z);
      const dir = b.clone().sub(a);
      fun.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().setY(0).normalize());
      group.add(fun);
      let phase = 0;
      addAnim(fun, (dt, l) => {
        phase += dt * 0.12 * l;
        fun.position.lerpVectors(a, b, 0.5 - 0.5 * Math.cos(phase * TAU));
      });
    }

    // Airships: moored at the rim while asleep, circling the island while awake.
    L.airships.forEach((s, k) => {
      const ship = part('Airship');
      const prop = part('Airship_Prop');
      if (!ship) return;
      if (prop) {
        prop.position.set(-0.058, 0, 0);
        prop.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-1, 0, 0));
        ship.add(prop);
      }
      group.add(ship);
      let orbit = s.dock.angle;
      let departure = 0;
      const fly = new THREE.Vector3(),
        look = new THREE.Vector3();
      addAnim(ship, (dt, l, t) => {
        // Move out of the berth before climbing above the skyline. Reverse the
        // same route when returning, never cutting a chord through the town.
        departure = THREE.MathUtils.clamp(departure + ((state.awake && l > 0 ? 1 : -1) * dt) / L.flight.seconds, 0, 1);
        const cruise = THREE.MathUtils.smoothstep(departure, 0.62, 1);
        const launch = THREE.MathUtils.smoothstep(departure, 0, 0.3);
        const lift = THREE.MathUtils.smoothstep(departure, 0.3, 0.62);
        if (departure === 1) orbit += dt * 360 * s.orbit.speed;
        const offset = THREE.MathUtils.euclideanModulo(orbit - s.dock.angle + 180, 360) - 180;
        const angle = s.dock.angle + offset * cruise;
        const radius = THREE.MathUtils.lerp(s.dock.r, s.orbit.r, launch);
        const altitude = THREE.MathUtils.lerp(s.dock.z, L.flight.clearance, lift);
        at(angle, radius, THREE.MathUtils.lerp(altitude, s.orbit.z, cruise), fly);
        ship.position.copy(fly);
        ship.position.y += 0.006 * Math.sin(t * 1.3 + k * 2);
        look.copy(tangent(angle)).multiplyScalar(Math.sign(s.orbit.speed));
        if (departure < 0.02) look.copy(tangent(s.dock.angle));
        ship.quaternion.slerp(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), look.normalize()),
          Math.min(1, dt * 2),
        );
        if (prop) prop.rotation.y += dt * TAU * (0.3 + 3 * l);
      });
    });

    // Distance from the crown sets each motion's wake delay: the town wakes outward.
    const tmp = new THREE.Vector3();
    for (const a of anims) {
      a.origin.getWorldPosition(tmp);
      group.worldToLocal(tmp);
      a.delay = (L.wakeCascade || 0.4) * Math.min(1, crownDist(tmp) / maxDist);
    }
  })();

  return {
    group,
    ready,
    lots,
    pickables,
    buildingAt(hit, ray) {
      const lot = lots.find(l => l.id === hit.object.userData.islandLot);
      if (!lot) return null;
      // The back of the town must not be selectable through the retaining walls.
      const ground = terrain && ray.intersectObject(terrain, true)[0];
      return ground && ground.distance < hit.distance - scale * 0.006 ? null : lot;
    },
    selectBuilding(id) {
      const lot = lots.find(l => l.id === id);
      selection.visible = !!lot;
      if (!lot) return;
      const [w, d] = lot.footprint;
      const p = selectionGeometry.attributes.position;
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].forEach(([x, z], i) => p.setXYZ(i, x * (w / 2 + 0.004), 0.003, z * (d / 2 + 0.004)));
      p.needsUpdate = true;
      selectionGeometry.computeBoundingSphere();
      lot.object.add(selection);
    },
    get crownRadius() {
      return L ? L.crownRadius * scale : 0;
    },
    /** Paved upper annulus, expressed in the cannon root's coordinates. */
    get contextDistrictSite() {
      if (!L?.plaza) return null;
      return {
        innerRadius: L.plaza.inner * scale,
        outerRadius: L.plaza.radius * scale,
        floorY: (L.plaza.z - L.tiers.crown) * scale,
      };
    },
    /** The context indicator sits in the channel modelled into the crown paving. */
    get contextGauge() {
      if (!L?.plaza) return null;
      const g = L.plaza.gauge;
      return { radius: g.r * scale, width: g.width * scale, height: (g.z - L.tiers.crown) * scale };
    },
    /** Thinking or working: snap awake, cascading out from the crown. */
    wake() {
      if (state.awake) return;
      state.awake = true;
      for (const a of anims) a.wakeAt = state.t + a.delay;
    },
    /** Turn over: wind down over layout.sleepSeconds. */
    sleep() {
      state.awake = false;
      state.waiting = false;
    },
    /** Waiting on the user: the bell swings and the beacon pulses. */
    waiting(on) {
      state.waiting = !!on;
    },
    /** A shot left the cannon: a light ripple runs from the crown to the rim. */
    ripple() {
      uniforms.uRippleAt.value = state.t;
    },
    step(dt, t) {
      state.t = t;
      uniforms.uTime.value = t;
      if (!L) return;
      const down = dt / (L.sleepSeconds || 6);
      state.level = state.awake ? 1 : Math.max(0, state.level - down);
      uniforms.uAwake.value = THREE.MathUtils.smoothstep(state.level, 0, 1);
      const still = !IslandMotion.idle && !state.awake && state.level === 0;
      for (const a of anims) {
        if (state.awake) {
          if (t >= a.wakeAt) a.level = 1;
        } else a.level = Math.max(0, a.level - down);
        if (still && a.level === 0) {
          if (a.stilled) continue;
          a.stilled = true;
        } else a.stilled = false;
        a.step(dt, a.level, t);
      }
    },
    /** Awake, waiting and overall level, for checks. */
    get state() {
      return { awake: state.awake, waiting: state.waiting, level: state.level };
    },
    /** Group scale: island units per world unit, known once the base has loaded. */
    get scale() {
      return scale;
    },
    dispose() {
      group.parent?.remove(group);
      group.traverse(o => {
        if (o.isMesh && !disposables.includes(o.geometry)) o.geometry?.dispose();
      });
      disposables.forEach(d => d.dispose?.());
    },
  };
}
