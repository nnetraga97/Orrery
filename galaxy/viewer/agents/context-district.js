// Six of the user's textured imports, rigid clips, and a single continuous energy
// loop through exported hoop markers. No category token allocation is fabricated.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONTEXT_CATEGORIES, createContextState } from './context-state.js';

const assets = new Map();
function load(id) {
  if (!assets.has(id))
    assets.set(
      id,
      new GLTFLoader().loadAsync(`assets/rigged/context-district/${id}.glb`).catch(error => {
        assets.delete(id);
        throw error;
      }),
    );
  return assets.get(id);
}
const TAU = Math.PI * 2;
// Blender's marker +Z becomes local +Y under the glTF axis conversion.
const hoopNormal = hoop => new THREE.Vector3(0, 1, 0).transformDirection(hoop.matrixWorld);
const fmt = value => Number(value).toLocaleString('en-US');
const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function createContextDistrict(
  parent,
  core,
  { site = null, carry = null, reducedMotion = false, onChange = () => {} } = {},
) {
  const group = new THREE.Group();
  group.name = 'Context_District';
  parent.add(group);
  const state = createContextState(carry);
  const owned = [],
    buildings = new Map(),
    ringPoints = [],
    readyState = { ready: false, error: null };
  const uniforms = { uTime: { value: 0 }, uPressure: { value: 0 }, uColor: { value: new THREE.Color('#21d9ff') } };
  let failed = false,
    stopped = false,
    clock = 0,
    ring = null;
  let events = 0,
    previews = 0;
  let radius, hoopHeight, ringWidth;
  const siteReady = Promise.resolve(site).then(value => {
    const mount = value || { innerRadius: core * 0.16, outerRadius: core * 0.36, floorY: core * 0.025 };
    if (
      ![mount.innerRadius, mount.outerRadius, mount.floorY].every(Number.isFinite) ||
      mount.innerRadius <= 0 ||
      mount.outerRadius <= mount.innerRadius
    )
      throw new Error('Context district: invalid upper-ring site');
    return { ...mount };
  });
  const sourcesReady = Promise.all(CONTEXT_CATEGORIES.map(c => load(c.id)));
  let mount;
  const fitting = Promise.all([siteReady, sourcesReady]).then(([site, sources]) => {
    mount = site;
    radius = (mount.innerRadius + mount.outerRadius) / 2;
    const clearance = (mount.outerRadius - mount.innerRadius) / 2;
    // A conservative footprint circle about each surveyed hoop includes every
    // base corner. Fit all six to the annulus with room for their rigid motions,
    // while keeping every foundation grounded and every hoop at one height.
    const measurements = sources.map(source => {
      source.scene.updateMatrixWorld(true);
      let marker;
      source.scene.traverse(o => {
        if (o.name.startsWith('Hoop_Center')) marker = o;
      });
      if (!marker) throw new Error('Context district: missing hoop marker');
      const bounds = new THREE.Box3().setFromObject(source.scene);
      const local = source.scene.worldToLocal(marker.getWorldPosition(new THREE.Vector3()));
      const footprint = Math.max(
        ...[bounds.min.x, bounds.max.x].flatMap(x =>
          [bounds.min.z, bounds.max.z].map(z => Math.hypot(x - local.x, z - local.z)),
        ),
      );
      return { bounds, local, footprint, height: local.y - bounds.min.y };
    });
    const lift = Math.min(...measurements.map(m => (clearance * 0.88 * m.height) / m.footprint));
    if (!Number.isFinite(lift) || lift <= 0) throw new Error('Context district: invalid model footprint');
    hoopHeight = mount.floorY + lift;
    return measurements;
  });
  function run(id, source = 'event') {
    const b = buildings.get(id);
    if (!b || stopped) return false;
    // In-flight cycles complete before another begins; frequent deltas cannot
    // keep a mechanism stuck on its opening frame.
    if (b.active) return false;
    b.active = { source, elapsed: 0 };
    b.action.reset().setLoop(THREE.LoopOnce, 1);
    b.action.clampWhenFinished = true;
    b.action.play();
    if (source === 'preview') previews++;
    else events++;
    return true;
  }
  const ready = Promise.all(
    CONTEXT_CATEGORIES.map(async (category, i) => {
      const [sources, measurements] = await Promise.all([sourcesReady, fitting]);
      const source = sources[i],
        measurement = measurements[i];
      if (stopped || failed) return;
      const model = source.scene.clone(true),
        materials = new Map();
      model.traverse(o => {
        if (!o.isMesh) return;
        o.geometry = o.geometry.clone();
        owned.push(o.geometry);
        const clone = original => {
          if (!materials.has(original)) {
            const mat = original.clone();
            materials.set(original, mat);
            owned.push(mat);
          }
          return materials.get(original);
        };
        o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
      });
      const hoop =
        model.getObjectsByProperty('type', 'Object3D').find(o => o.name.startsWith('Hoop_Center')) ||
        (() => {
          let found;
          model.traverse(o => {
            if (o.name.startsWith('Hoop_Center')) found = o;
          });
          return found;
        })();
      const clip = source.animations.find(a => a.name === category.clip);
      if (!hoop || !clip) throw new Error(`${category.name}: missing hoop marker or mechanical clip`);
      model.updateMatrixWorld(true);
      const local = model.worldToLocal(hoop.getWorldPosition(new THREE.Vector3()));
      const normal = hoopNormal(hoop);
      const scale = (hoopHeight - mount.floorY) / measurement.height;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error(`${category.name}: invalid hoop height`);
      // Leave the cannon's forward/back axis between buildings at its rest pose.
      const angle = (i / CONTEXT_CATEGORIES.length) * TAU;
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const normalYaw = Math.atan2(normal.x, normal.z);
      model.rotation.y = Math.atan2(tangent.x, tangent.z) - normalYaw;
      model.scale.setScalar(scale);
      const offset = local
        .clone()
        .multiplyScalar(scale)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), model.rotation.y);
      const center = new THREE.Vector3(Math.cos(angle) * radius, hoopHeight, Math.sin(angle) * radius);
      model.position.copy(center).sub(offset);
      model.userData.contextCategory = category.id;
      group.add(model);
      model.updateMatrixWorld(true);
      const detail = [],
        distant = [];
      model.traverse(o => {
        if (o.isMesh) (o.userData.lod ? distant : detail).push(o);
      });
      distant.forEach(o => {
        o.visible = false;
      });
      const mixer = new THREE.AnimationMixer(model),
        action = mixer.clipAction(clip);
      const b = {
        category,
        model,
        hoop,
        detail,
        distant,
        mixer,
        action,
        clip,
        active: null,
        center,
        scale,
        measurement,
      };
      buildings.set(category.id, b);
      // Passage-aligned approach points make the spline's tangent follow the
      // exported normal, even with curved joins between buildings.
      const reach = (hoop.userData.passage_radius || 0.1) * scale * 0.55;
      ringPoints[i] = [
        center.clone().addScaledVector(tangent, -reach),
        center.clone(),
        center.clone().addScaledVector(tangent, reach),
      ];
    }),
  )
    .then(() => {
      if (stopped) return;
      const minPassage = Math.min(
        ...[...buildings.values()].map(b => (b.hoop.userData.passage_radius || 0.1) * b.scale),
      );
      ringWidth = minPassage * 0.4;
      const curvePoints = ringPoints.flatMap((passage, i) => [
        ...passage,
        ...[1, 2, 3].map(j => {
          const angle = ((i + j / 4) / CONTEXT_CATEGORIES.length) * TAU;
          return new THREE.Vector3(Math.cos(angle) * radius, hoopHeight, Math.sin(angle) * radius);
        }),
      ]);
      const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal');
      const strand = (name, thickness, orbit, phase, color, opacity, halo = false) => {
        const geometry = new THREE.TubeGeometry(curve, 720, thickness, 6, true);
        // The two outer strands braid around the surveyed centerline on the
        // GPU. Their complete glow envelope stays inside the smallest hoop.
        geometry.computeBoundingSphere();
        geometry.boundingSphere.radius += orbit;
        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime: uniforms.uTime,
            uPressure: uniforms.uPressure,
            uColor: color ? { value: new THREE.Color(color) } : uniforms.uColor,
            uOrbit: { value: orbit },
            uPhase: { value: phase },
            uOpacity: { value: opacity },
          },
          transparent: true,
          toneMapped: false, // Unlit energy strands and their additive halos.
          depthWrite: false,
          blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending,
          side: THREE.DoubleSide,
          vertexShader: `varying vec2 vUv;
          uniform float uTime, uOrbit, uPhase;
          void main(){
            vUv=uv;
            float braid=uv.x*18.84955592-uTime*.75+uPhase;
            vec3 radial=normalize(vec3(position.x,0.,position.z));
            vec3 offset=uOrbit*(radial*cos(braid)+vec3(0.,sin(braid),0.));
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position+offset,1.);
          }`,
          fragmentShader: `varying vec2 vUv;
          uniform float uTime, uPressure, uPhase, uOpacity;
          uniform vec3 uColor;
          void main(){
            float flow=.5+.5*sin(vUv.x*25.13274123-uTime*1.15+uPhase);
            float thread=.90+.10*sin(vUv.x*169.6460033-uTime*1.7+sin(vUv.x*56.54866776));
            float filament=.72+.28*pow(abs(sin(vUv.y*3.14159265)),.6);
            // Reported usage fills the loop from the archive passage; the rest is a faint track.
            float filled=uPressure<=0. ? 0. : smoothstep(uPressure+.004,uPressure-.004,vUv.x);
            float alpha=uOpacity*mix(.12,1.,filled)*(.82+.18*flow*filled)*thread*filament;
            vec3 light=uColor*mix(.35,.94+.12*flow,filled);
            gl_FragColor=vec4(light,alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        });
        owned.push(geometry, material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        return mesh;
      };
      ring = strand('Context_Energy_Ring', ringWidth / 2, 0, 0, null, 0.95);
      ring.add(strand('Context_Energy_Halo', minPassage * 0.43, 0, 0, null, 0.16, true));
      for (const [i, color] of ['#3977ff', '#bd62ff'].entries()) {
        const phase = i * Math.PI;
        ring.add(strand(`Context_Energy_Strand_${i + 1}`, minPassage * 0.1, minPassage * 0.48, phase, color, 0.82));
        ring.add(strand(`Context_Energy_Glow_${i + 1}`, minPassage * 0.18, minPassage * 0.48, phase, color, 0.1, true));
      }
      ring.userData.strands = 3;
      ring.userData.envelopeRadius = minPassage * 0.66;
      group.add(ring);
      readyState.ready = true;
      updateUsage();
    })
    .catch(error => {
      if (!stopped) {
        failed = true;
        readyState.error = error.message;
        for (const b of buildings.values()) {
          b.mixer.stopAllAction();
          b.mixer.uncacheRoot(b.model);
        }
        group.clear();
        owned.forEach(o => o.dispose());
        owned.length = 0;
        buildings.clear();
        console.warn('Context district unavailable', error);
      }
    });

  function updateUsage() {
    const s = state.snapshot();
    uniforms.uPressure.value = s.fraction == null ? 0 : THREE.MathUtils.clamp(s.fraction, 0, 1);
    uniforms.uColor.value.set(s.fraction > 0.8 ? '#ffd0a0' : '#21d9ff');
  }
  function ingest(event) {
    const result = state.accept(event);
    if (!result) return;
    if (result === 'usage' || result === 'compaction') updateUsage();
    if (result !== 'usage' && !reducedMotion) run(result);
    if (result === 'usage' || result === 'compaction') onChange();
  }
  function step(dt, camera) {
    if (stopped) return;
    const delta = Math.max(0, Math.min(0.1, dt));
    clock += delta;
    uniforms.uTime.value = reducedMotion ? 0 : clock;
    group.updateWorldMatrix(true, true);
    for (const b of buildings.values()) {
      const far =
        !b.active && camera && camera.position.distanceTo(b.model.getWorldPosition(new THREE.Vector3())) > b.scale * 18;
      b.detail.forEach(o => {
        o.visible = !far;
      });
      b.distant.forEach(o => {
        o.visible = !!far;
      });
      if (!b.active) continue;
      b.active.elapsed += delta;
      b.mixer.update(delta);
      if (b.active.elapsed >= b.clip.duration) {
        b.action.stop();
        b.mixer.update(0);
        b.active = null;
      }
    }
  }
  function buildingAt(hit) {
    let object = hit.object;
    if (object === ring || object.parent === ring) return 'aggregate';
    while (object && !object.userData.contextCategory) object = object.parent;
    return object?.userData.contextCategory || null;
  }
  function details(id) {
    const s = state.snapshot(),
      c = CONTEXT_CATEGORIES.find(c => c.id === id);
    const used = s.tokens == null ? 'Unavailable' : `${fmt(s.tokens)} tokens`;
    const limit = s.limit == null ? 'Window limit unavailable' : `${fmt(s.limit)} token window`;
    const percent = s.fraction == null ? '' : ` · ${(s.fraction * 100).toFixed(1)}% used`;
    return `<h4>Reported context</h4><p>${used} · ${limit}${percent}</p>
      ${s.awaitingPostCompaction ? '<p class="note">Awaiting usage after compaction. The value above is the last report.</p>' : ''}
      <p class="note">Source: ${escape(s.provider || 'No provider usage event yet')}${s.reportedAt != null ? ` · ${escape(new Date(s.reportedAt).toLocaleTimeString())}` : ''}.</p>
      <h4>${escape(c?.meaning || 'Aggregate utilization')}</h4>
      <p>${id === 'standby' ? 'Excluded from occupied context. Deferred definitions are not counted as loaded. Their count is unavailable.' : 'Category token allocation is unavailable. Aggregate input tokens cannot establish this building’s share.'}</p>
      ${id === 'compaction' ? `<p>${fmt(s.compactions)} observed compaction event${s.compactions === 1 ? '' : 's'} in this session.</p>` : ''}
      <p class="note">The energy ring shows aggregate context pressure, not a measured allocation between buildings. Mechanical previews do not change context usage.</p>`;
  }
  function snapshot() {
    group.updateWorldMatrix(true, true);
    return {
      ...readyState,
      ...state.snapshot(),
      site: mount ? { ...mount, radius, hoopHeight } : null,
      eventAnimations: events,
      previewAnimations: previews,
      ring: ring
        ? {
            points: ringPoints.map(p => p[1].toArray()),
            continuous: true,
            width: ringWidth,
            strands: ring.userData.strands,
            envelopeRadius: ring.userData.envelopeRadius,
            time: uniforms.uTime.value,
          }
        : null,
      buildings: CONTEXT_CATEGORIES.flatMap(c => {
        const b = buildings.get(c.id);
        if (!b) return [];
        const center = group.worldToLocal(b.hoop.getWorldPosition(new THREE.Vector3()));
        const normal = hoopNormal(b.hoop).transformDirection(group.matrixWorld.clone().invert());
        const joints = [];
        b.model.traverse(o => {
          if (o.name.startsWith('CTRL_'))
            joints.push({ name: o.name, position: o.position.toArray(), rotation: o.quaternion.toArray() });
        });
        return [
          {
            id: c.id,
            center: center.toArray(),
            normal: normal.toArray(),
            radius: (b.hoop.userData.passage_radius || 0.1) * b.scale,
            footprint: {
              innerRadius: radius - b.measurement.footprint * b.scale,
              outerRadius: radius + b.measurement.footprint * b.scale,
              foundationY: b.model.position.y + b.measurement.bounds.min.y * b.scale,
              width: (b.measurement.bounds.max.x - b.measurement.bounds.min.x) * b.scale,
            },
            animation: b.active?.source || null,
            joints,
            textured: b.detail.every(
              o => o.material.map && o.material.normalMap && o.material.roughnessMap && o.material.metalnessMap,
            ),
            lod: b.distant.some(o => o.visible),
          },
        ];
      }),
    };
  }
  return {
    group,
    ready,
    state: readyState,
    ingest,
    step,
    buildingAt,
    details,
    snapshot,
    get pickables() {
      return [...buildings.values()].map(b => b.model).concat(ring ? [ring] : []);
    },
    target: id => {
      const b = buildings.get(id);
      return b ? b.hoop.getWorldPosition(new THREE.Vector3()) : group.getWorldPosition(new THREE.Vector3());
    },
    preview: id => run(id, 'preview'),
    capture: () => state.capture(),
    reset: () => {
      state.reset();
      for (const b of buildings.values()) {
        b.action.stop();
        b.mixer.update(0);
        b.active = null;
      }
      updateUsage();
      onChange();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      readyState.ready = false;
      for (const b of buildings.values()) {
        b.mixer.stopAllAction();
        b.mixer.uncacheRoot(b.model);
      }
      group.removeFromParent();
      group.clear();
      owned.forEach(o => o.dispose());
      owned.length = 0;
      buildings.clear();
      ring = null;
    },
  };
}
