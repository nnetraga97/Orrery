// A star's important functions as planets (function-index.js). The selected star shows its planets in full: lit by
// the star, on circular orbits with faint orbit lines, named, and pickable; a pick opens a card whose Land action lands
// on that one function. Its hidden functions are a belt of grains outside the last orbit, with a count. The other
// stars of the same system show their planets as small dots. Nothing is drawn while a planet is landed.
// Two instanced batches (planets, dots), one line batch and one point batch: four draw calls at most.
import * as THREE from 'three';
import { planetById, planetCalls, starOf } from '../app/function-index.js';
import { keyHash } from './constellation-orbits.js';

const PALETTE = ['#c9a27a', '#7fa7c9', '#a3c48a', '#d1876b', '#b49ad6', '#d8c37a', '#8cc7bd', '#c98fa6'].map(
  c => new THREE.Color(c),
);
const PLANET_VERT = `
  attribute vec3 aStar; varying vec3 vC; varying float vLit;
  void main(){
    vC = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vC = instanceColor;
    #endif
    vec3 centre = instanceMatrix[3].xyz;
    vLit = max(dot(normalize(position), normalize(aStar - centre)), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const PLANET_FRAG = `
  varying vec3 vC; varying float vLit;
  void main(){
    gl_FragColor = vec4(vC * (0.16 + 0.95 * vLit), 1.0);
    #include <colorspace_fragment>
  }`;
const MAX_BELT = 160;
/** Segments per call lane, and the most lanes drawn for one star. */
const SEG = 16,
  MAX_LANES = 48;
const OUT = new THREE.Color('#6fd3ff'),
  IN = new THREE.Color('#ffb35c');

export function createFunctionPlanets(ctx) {
  const { host, T, u, model, lod, frame: frameState } = ctx;
  const sphere = new THREE.IcosahedronGeometry(1, 2);
  const material = () =>
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      toneMapped: false,
    });
  const batch = (capacity, name) => {
    const geometry = sphere.clone();
    geometry.setAttribute('aStar', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    const mesh = new THREE.InstancedMesh(geometry, material(), capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, PALETTE[0]);
    T.scene.add(mesh);
    return mesh;
  };
  let planets = batch(16, 'function-planets'),
    dots = batch(64, 'function-dots');
  dots.raycast = () => {};
  // Orbit lines and the belt sit in one group that follows the selected star.
  const around = new THREE.Group();
  around.name = 'function-orbits';
  T.scene.add(around);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: '#8fb3d9',
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  // Call lanes: arcs from the selected star's planets to the planets they call (cyan) and that call them (amber), each
  // with a light running from caller to callee. Buffers are sized once; only the endpoints move.
  const lanePos = new Float32Array(MAX_LANES * SEG * 2 * 3),
    laneCol = new Float32Array(MAX_LANES * SEG * 2 * 3),
    runPos = new Float32Array(MAX_LANES * 3),
    runCol = new Float32Array(MAX_LANES * 3);
  const laneGeo = new THREE.BufferGeometry();
  laneGeo.setAttribute('position', new THREE.BufferAttribute(lanePos, 3).setUsage(THREE.DynamicDrawUsage));
  laneGeo.setAttribute('color', new THREE.BufferAttribute(laneCol, 3));
  const laneLines = new THREE.LineSegments(
    laneGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const runGeo = new THREE.BufferGeometry();
  runGeo.setAttribute('position', new THREE.BufferAttribute(runPos, 3).setUsage(THREE.DynamicDrawUsage));
  runGeo.setAttribute('color', new THREE.BufferAttribute(runCol, 3));
  const runners = new THREE.Points(
    runGeo,
    new THREE.PointsMaterial({
      size: 0.16 * u,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  for (const o of [laneLines, runners]) {
    o.frustumCulled = false;
    o.raycast = () => {};
    o.name = o === runners ? 'function-call-lights' : 'function-call-lanes';
    T.scene.add(o);
  }
  /** { from, to, out, phase }: from/to are { pos } objects whose pos is read each frame. */
  let lanes = [];
  const a3 = new THREE.Vector3(),
    b3 = new THREE.Vector3(),
    m3 = new THREE.Vector3(),
    w3 = new THREE.Vector3();
  const put = (arr, i, v) => {
    arr[i * 3] = v.x;
    arr[i * 3 + 1] = v.y;
    arr[i * 3 + 2] = v.z;
  };
  const arcPoint = (a, b, t, out) => {
    // A quadratic arc lifted by a quarter of its length.
    m3.addVectors(a, b).multiplyScalar(0.5);
    m3.y += a.distanceTo(b) * 0.25;
    const k = 1 - t;
    return out
      .copy(a)
      .multiplyScalar(k * k)
      .addScaledVector(m3, 2 * k * t)
      .addScaledVector(b, t * t);
  };
  const beltMaterial = new THREE.PointsMaterial({
    color: '#b9c6d6',
    size: 0.06 * u,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s3 = new THREE.Vector3(),
    xAxis = new THREE.Vector3(1, 0, 0);
  /** The selected star's planets, by slot: { star, planet, r, size, phase, w, tilt, pos }. */
  let shown = [];
  /** The other stars' dots: { star, r, size, phase, w, tilt }. */
  let dotted = [];
  let focus = null,
    focusGroup = null,
    removeLabels = () => {};

  const isStar = i => i != null && model.orbit[i]?.kind === 'planet' && !!starOf(host.data.nodes()[i]?.path);
  // Orbits for one star: the first just outside its glow, then evenly spaced; each planet's size from its length.
  function orbitsOf(i, list, dot) {
    const S = model.orbit[i].size,
      gap = Math.max(0.42 * u, S * 0.38),
      t = keyHash(host.data.nodes()[i].seed + '#tilt');
    const plane = new THREE.Quaternion().setFromAxisAngle(xAxis, (t - 0.5) * 0.5);
    return list.map((p, k) => {
      const r = S * 2.5 + (k + 0.6) * gap,
        loc = p.end - p.start + 1;
      return {
        star: i,
        planet: p,
        r,
        size: dot ? 0.07 * u : Math.min(0.5 * u, Math.max(0.16 * u, (0.1 + Math.sqrt(loc) / 40) * u)),
        phase: keyHash(p.id) * Math.PI * 2,
        w: (0.35 * frameState.speed) / Math.sqrt(r / u),
        tilt: plane,
        pos: new THREE.Vector3(),
      };
    });
  }

  function ensure(mesh, needed, name) {
    if (mesh.instanceMatrix.count >= needed) return mesh;
    T.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
    const next = batch(Math.ceil(needed * 1.5), name);
    if (name === 'function-dots') next.raycast = () => {};
    return next;
  }

  function refocus(i) {
    focus = i;
    focusGroup = i == null ? null : model.orbit[i].gi;
    removeLabels();
    removeLabels = () => {};
    around.traverse(o => o.geometry?.dispose());
    around.clear();
    shown = [];
    dotted = [];
    if (i == null) {
      planets.count = dots.count = 0;
      return;
    }
    const star = starOf(host.data.nodes()[i].path);
    shown = orbitsOf(i, star.planets, false);
    planets = ensure(planets, shown.length, 'function-planets');
    planets.count = shown.length;
    shown.forEach((s, k) =>
      planets.setColorAt(
        k,
        s.planet.pinned ? new THREE.Color('#ff7a5c') : PALETTE[Math.floor(keyHash(s.planet.id + 'c') * PALETTE.length)],
      ),
    );
    if (planets.instanceColor) planets.instanceColor.needsUpdate = true;
    // Orbit lines, and the belt of hidden functions outside them.
    for (const s of shown) {
      const pts = [];
      for (let a = 0; a <= 64; a++)
        pts.push(new THREE.Vector3(Math.cos((a / 64) * Math.PI * 2) * s.r, 0, Math.sin((a / 64) * Math.PI * 2) * s.r));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial);
      line.quaternion.copy(s.tilt);
      line.raycast = () => {};
      around.add(line);
    }
    const beltR = (shown.at(-1)?.r ?? model.orbit[i].size * 2.5) + Math.max(0.42 * u, model.orbit[i].size * 0.38);
    if (star.hidden > 0) {
      const n = Math.min(MAX_BELT, star.hidden * 4),
        arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const a = keyHash(star.path + '#b' + k) * Math.PI * 2,
          rr = beltR + (keyHash(star.path + '#r' + k) - 0.5) * 0.3 * u;
        arr.set([Math.cos(a) * rr, (keyHash(star.path + '#y' + k) - 0.5) * 0.08 * u, Math.sin(a) * rr], k * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const belt = new THREE.Points(g, beltMaterial);
      belt.quaternion.copy(shown[0]?.tilt ?? q.identity());
      belt.raycast = () => {};
      belt.name = 'function-belt';
      around.add(belt);
    }
    // The other stars of this system: their planets as dots.
    for (const n of model.members[focusGroup] || []) {
      if (n.i === i || !isStar(n.i)) continue;
      dotted.push(...orbitsOf(n.i, starOf(n.path).planets, true));
    }
    dots = ensure(dots, dotted.length, 'function-dots');
    dots.count = dotted.length;
    dotted.forEach((d, k) => dots.setColorAt(k, PALETTE[Math.floor(keyHash(d.planet.id + 'c') * PALETTE.length)]));
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    // Call lanes touching this star's planets.
    const mine = new Map(shown.map(s => [s.planet.id, s]));
    const endOf = id => {
      if (mine.has(id)) return mine.get(id);
      const p = planetById(id),
        j = p ? model.byPath.get(p.path) : null;
      return j == null ? null : { pos: model.pos[j] };
    };
    lanes = [];
    for (const [a, b] of planetCalls()) {
      if (lanes.length >= MAX_LANES || (!mine.has(a) && !mine.has(b))) continue;
      const from = endOf(a),
        to = endOf(b);
      if (from && to && from !== to) lanes.push({ from, to, out: mine.has(a), phase: keyHash(a + '>' + b) });
    }
    lanes.forEach((l, k) => {
      const c = l.out ? OUT : IN;
      for (let v = 0; v < SEG * 2; v++) laneCol.set([c.r, c.g, c.b], (k * SEG * 2 + v) * 3);
      runCol.set([c.r, c.g, c.b], k * 3);
    });
    laneGeo.attributes.color.needsUpdate = runGeo.attributes.color.needsUpdate = true;
    laneGeo.setDrawRange(0, lanes.length * SEG * 2);
    runGeo.setDrawRange(0, lanes.length);
    // Names for the selected star's planets, and the belt's count.
    const landed = () => (lod.host?.opacity || 0) >= 0.5;
    const beltAt = new THREE.Vector3();
    removeLabels = T.addLabels([
      ...shown.map(s => ({
        text: s.planet.name.split('.').pop(),
        col: s.planet.pinned ? '#ffb39e' : '#e6eef7',
        cls: 'planet-label',
        centered: true,
        avoidOverlap: true,
        pos: () => s.pos,
        visible: () => !landed(),
      })),
      ...(star.hidden > 0
        ? [
            {
              text: `+${star.hidden} more`,
              col: '#9fb0c4',
              cls: 'planet-label',
              centered: true,
              avoidOverlap: true,
              pos: () =>
                beltAt
                  .set(beltR, 0, 0)
                  .applyQuaternion(shown[0]?.tilt ?? q.identity())
                  .add(model.pos[i]),
              visible: () => !landed(),
            },
          ]
        : []),
    ]);
  }

  function placeAll(list, mesh, t) {
    const stars = mesh.geometry.getAttribute('aStar');
    for (let k = 0; k < list.length; k++) {
      const s = list[k],
        a = s.phase + t * s.w,
        c = model.pos[s.star];
      s.pos
        .set(Math.cos(a) * s.r, 0, Math.sin(a) * s.r)
        .applyQuaternion(s.tilt)
        .add(c);
      m4.compose(s.pos, q.identity(), s3.setScalar(s.size));
      mesh.setMatrixAt(k, m4);
      stars.setXYZ(k, c.x, c.y, c.z);
    }
    mesh.instanceMatrix.needsUpdate = true;
    stars.needsUpdate = true;
  }

  function update(t) {
    const want = isStar(T.pinned) ? T.pinned : null;
    if (want !== focus || (want != null && model.orbit[want].gi !== focusGroup)) refocus(want);
    const landed = (lod.host?.opacity || 0) >= 0.5;
    planets.visible = dots.visible = around.visible = laneLines.visible = runners.visible = focus != null && !landed;
    if (!planets.visible) return;
    placeAll(shown, planets, t);
    placeAll(dotted, dots, t);
    for (let k = 0; k < lanes.length; k++) {
      const l = lanes[k];
      a3.copy(l.from.pos);
      b3.copy(l.to.pos);
      for (let sgm = 0; sgm < SEG; sgm++) {
        put(lanePos, k * SEG * 2 + sgm * 2, arcPoint(a3, b3, sgm / SEG, w3));
        put(lanePos, k * SEG * 2 + sgm * 2 + 1, arcPoint(a3, b3, (sgm + 1) / SEG, w3));
      }
      put(runPos, k, arcPoint(a3, b3, (t * 0.35 + l.phase) % 1, w3));
    }
    laneGeo.attributes.position.needsUpdate = runGeo.attributes.position.needsUpdate = true;
    around.position.copy(model.pos[focus]);
  }

  // A pinched planet: what it is, and a way down to it.
  T.addPicker({
    objects: () => (planets.visible && planets.count ? [planets] : []),
    describe: hit => {
      const s = shown[hit.instanceId];
      if (!s) return null;
      const n = host.data.nodes()[s.star],
        p = s.planet,
        lines = p.end - p.start + 1;
      return {
        key: 'fn:' + p.id,
        kind: `Function · ${n.name}`,
        title: p.name,
        color: host.graph.color(host.graph.groupOf(n)),
        preview: [
          `Lines ${p.start}–${p.end} · ${lines} line${lines === 1 ? '' : 's'}`,
          ...(p.pinned ? ['Pinned for the demo'] : []),
        ],
        anchor: host.windows.worldAnchor(() => s.pos),
        actions: [
          {
            label: 'Land on this function',
            primary: true,
            onClick: () => host.actions.enterPlanet(s.star, { line: p.start, townId: p.id }),
          },
        ],
      };
    },
  });

  return {
    update,
    /** For checks and the XR host: the selected star's planets with their current positions. */
    shown: () =>
      shown.map(s => ({
        id: s.planet.id,
        name: s.planet.name,
        file: s.star,
        start: s.planet.start,
        pos: s.pos,
      })),
    refocus: () => refocus(focus),
    dispose() {
      removeLabels();
      for (const m of [planets, dots]) {
        T.scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        m.dispose();
      }
      T.scene.remove(around);
      for (const o of [laneLines, runners]) {
        T.scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
      around.traverse(o => o.geometry?.dispose());
      lineMaterial.dispose();
      beltMaterial.dispose();
      sphere.dispose();
    },
  };
}
