// Every star's important functions as planets (function-index.js), always drawn: lit by their star, two to an orbit
// (planet-orbits.js), and pickable; a pick opens a card whose Land action lands on that one function. The selected
// star also shows its orbit lines, its planets' names, a belt of grains for its hidden functions with their count, and
// call lanes to the planets its planets call (cyan) and that call them (amber). Nothing is drawn while landed.
// One instanced batch of planets, one of orbit lines, one belt, one lane batch and one of lane lights.
import * as THREE from 'three';
import { planetById, planetCalls, starOf } from '../app/function-index.js';
import { keyHash } from './constellation-orbits.js';
import { PER_ORBIT, orbitGap, orbitRadius, planetSize } from './planet-orbits.js';

const PALETTE = ['#c9a27a', '#7fa7c9', '#a3c48a', '#d1876b', '#b49ad6', '#d8c37a', '#8cc7bd', '#c98fa6'].map(
  c => new THREE.Color(c),
);
const PINNED = new THREE.Color('#ff7a5c');
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
/** Segments per call lane, and the most lanes drawn for the selected star. */
const SEG = 16,
  MAX_LANES = 48;
const OUT = new THREE.Color('#6fd3ff'),
  IN = new THREE.Color('#ffb35c');

export function createFunctionPlanets(ctx) {
  const { host, T, u, model, lod, frame: frameState } = ctx;
  // Low-poly spheres: hundreds of planets stay a few tens of thousands of triangles.
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  let planets = null;
  function makeBatch(capacity) {
    if (planets) {
      T.scene.remove(planets);
      planets.geometry.dispose();
      planets.material.dispose();
      planets.dispose();
    }
    const geometry = sphere.clone();
    geometry.setAttribute('aStar', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    planets = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, toneMapped: false }),
      capacity,
    );
    planets.name = 'function-planets';
    planets.count = 0;
    planets.frustumCulled = false;
    planets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    planets.setColorAt(0, PALETTE[0]);
    T.scene.add(planets);
  }
  makeBatch(64);

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
  const beltMaterial = new THREE.PointsMaterial({
    color: '#b9c6d6',
    size: 0.06 * u,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });

  // Call lanes: buffers sized once; only the endpoints move.
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

  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    s3 = new THREE.Vector3(),
    a3 = new THREE.Vector3(),
    b3 = new THREE.Vector3(),
    m3 = new THREE.Vector3(),
    w3 = new THREE.Vector3(),
    xAxis = new THREE.Vector3(1, 0, 0);
  const put = (arr, i, v) => {
    arr[i * 3] = v.x;
    arr[i * 3 + 1] = v.y;
    arr[i * 3 + 2] = v.z;
  };
  // A quadratic arc lifted by a quarter of its length.
  const arcPoint = (a, b, t, out) => {
    m3.addVectors(a, b).multiplyScalar(0.5);
    m3.y += a.distanceTo(b) * 0.25;
    const k = 1 - t;
    return out
      .copy(a)
      .multiplyScalar(k * k)
      .addScaledVector(m3, 2 * k * t)
      .addScaledVector(b, t * t);
  };

  /** Every planet: { star, planet, r, size, phase, w, tilt, pos }, slot = index. */
  let all = [];
  /** Star file index -> its planets in `all`. */
  let byStar = new Map();
  let lanes = [];
  let focus = null,
    removeLabels = () => {};

  const isStar = i => i != null && model.orbit[i]?.kind === 'planet' && !!starOf(host.data.nodes()[i]?.path);

  /** Lays out every star's planets: most important on the inner orbits, two to an orbit on opposite sides. */
  function rebuild() {
    all = [];
    byStar = new Map();
    host.data.nodes().forEach(n => {
      if (!isStar(n.i)) return;
      const S = model.orbit[n.i].size,
        plane = new THREE.Quaternion().setFromAxisAngle(xAxis, (keyHash(n.seed + '#tilt') - 0.5) * 0.5),
        spin = keyHash(n.seed + '#spin') * Math.PI * 2;
      const ranked = [...starOf(n.path).planets].sort((a, b) => b.score - a.score);
      const list = ranked.map((p, k) => {
        const ring = Math.floor(k / PER_ORBIT),
          r = orbitRadius(S, u, ring);
        return {
          star: n.i,
          planet: p,
          r,
          ring,
          size: planetSize(S, u, p.end - p.start + 1),
          phase: spin + ring * 1.3 + (k % PER_ORBIT) * Math.PI,
          w: 0.35 / Math.sqrt(r / u),
          tilt: plane,
          pos: new THREE.Vector3(),
        };
      });
      byStar.set(n.i, list);
      all.push(...list);
    });
    if (all.length > planets.instanceMatrix.count) makeBatch(Math.ceil(all.length * 1.3));
    planets.count = all.length;
    all.forEach((s, k) =>
      planets.setColorAt(
        k,
        s.planet.pinned ? PINNED : PALETTE[Math.floor(keyHash(s.planet.id + 'c') * PALETTE.length)],
      ),
    );
    if (planets.instanceColor) planets.instanceColor.needsUpdate = true;
    refocus(focus, true);
  }

  /** The selected star's orbit lines, belt, names and call lanes. */
  function refocus(i, force = false) {
    if (i === focus && !force) return;
    focus = i;
    removeLabels();
    removeLabels = () => {};
    around.traverse(o => o.geometry?.dispose());
    around.clear();
    lanes = [];
    laneGeo.setDrawRange(0, 0);
    runGeo.setDrawRange(0, 0);
    const mine = i == null ? null : byStar.get(i);
    if (!mine) return;
    const star = starOf(host.data.nodes()[i].path),
      S = model.orbit[i].size,
      tilt = mine[0]?.tilt ?? q.identity();
    const radii = [...new Set(mine.map(s => s.r))];
    for (const r of radii) {
      const pts = [];
      for (let a = 0; a <= 64; a++)
        pts.push(new THREE.Vector3(Math.cos((a / 64) * Math.PI * 2) * r, 0, Math.sin((a / 64) * Math.PI * 2) * r));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial);
      line.quaternion.copy(tilt);
      line.raycast = () => {};
      around.add(line);
    }
    const beltR = (radii.at(-1) ?? S * 2.4) + orbitGap(S, u);
    if (star.hidden > 0) {
      const n = Math.min(MAX_BELT, star.hidden * 4),
        arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const a = keyHash(star.path + '#b' + k) * Math.PI * 2,
          rr = beltR + (keyHash(star.path + '#r' + k) - 0.5) * 0.3 * u;
        arr[k * 3] = Math.cos(a) * rr;
        arr[k * 3 + 1] = (keyHash(star.path + '#y' + k) - 0.5) * 0.08 * u;
        arr[k * 3 + 2] = Math.sin(a) * rr;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const belt = new THREE.Points(g, beltMaterial);
      belt.quaternion.copy(tilt);
      belt.raycast = () => {};
      belt.name = 'function-belt';
      around.add(belt);
    }
    // Call lanes touching this star's planets; the far end is the other planet when it is drawn, else its star.
    const mineById = new Map(mine.map(s => [s.planet.id, s]));
    const slotById = new Map(all.map(s => [s.planet.id, s]));
    const endOf = id => {
      if (slotById.has(id)) return slotById.get(id);
      const p = planetById(id),
        j = p ? model.byPath.get(p.path) : null;
      return j == null ? null : { pos: model.pos[j] };
    };
    for (const [a, b] of planetCalls()) {
      if (lanes.length >= MAX_LANES || (!mineById.has(a) && !mineById.has(b))) continue;
      const from = endOf(a),
        to = endOf(b);
      if (from && to && from !== to) lanes.push({ from, to, out: mineById.has(a), phase: keyHash(a + '>' + b) });
    }
    lanes.forEach((l, k) => {
      const c = l.out ? OUT : IN;
      for (let v = 0; v < SEG * 2; v++) {
        laneCol[(k * SEG * 2 + v) * 3] = c.r;
        laneCol[(k * SEG * 2 + v) * 3 + 1] = c.g;
        laneCol[(k * SEG * 2 + v) * 3 + 2] = c.b;
      }
      runCol[k * 3] = c.r;
      runCol[k * 3 + 1] = c.g;
      runCol[k * 3 + 2] = c.b;
    });
    laneGeo.attributes.color.needsUpdate = runGeo.attributes.color.needsUpdate = true;
    laneGeo.setDrawRange(0, lanes.length * SEG * 2);
    runGeo.setDrawRange(0, lanes.length);
    // Names for the selected star's planets, and the belt's count.
    const landed = () => (lod.host?.opacity || 0) >= 0.5;
    const beltAt = new THREE.Vector3();
    removeLabels = T.addLabels([
      ...mine.map(s => ({
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
              pos: () => beltAt.set(beltR, 0, 0).applyQuaternion(tilt).add(model.pos[i]),
              visible: () => !landed(),
            },
          ]
        : []),
    ]);
  }

  function update(t) {
    refocus(isStar(T.pinned) ? T.pinned : null);
    const landed = (lod.host?.opacity || 0) >= 0.5;
    planets.visible = all.length > 0 && !landed;
    around.visible = laneLines.visible = runners.visible = focus != null && !landed;
    if (!planets.visible) return;
    const stars = planets.geometry.getAttribute('aStar');
    for (let k = 0; k < all.length; k++) {
      const s = all[k],
        a = s.phase + t * s.w * frameState.speed,
        c = model.pos[s.star];
      s.pos
        .set(Math.cos(a) * s.r, 0, Math.sin(a) * s.r)
        .applyQuaternion(s.tilt)
        .add(c);
      m4.compose(s.pos, q.identity(), s3.setScalar(s.size));
      planets.setMatrixAt(k, m4);
      stars.setXYZ(k, c.x, c.y, c.z);
    }
    planets.instanceMatrix.needsUpdate = true;
    stars.needsUpdate = true;
    if (focus == null) return;
    around.position.copy(model.pos[focus]);
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
  }

  // A pinched planet: what it is, and a way down to it.
  T.addPicker({
    objects: () => (planets.visible && planets.count ? [planets] : []),
    describe: hit => {
      const s = all[hit.instanceId];
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

  rebuild();
  return {
    update,
    /** Lays the planets out again after the galaxy is rebuilt. */
    refocus: rebuild,
    /** For checks: the selected star's planets with their current positions. */
    shown: () =>
      (byStar.get(focus) || []).map(s => ({
        id: s.planet.id,
        name: s.planet.name,
        file: s.star,
        start: s.planet.start,
        pos: s.pos,
      })),
    /** For checks: how many planets are drawn in all. */
    count: () => all.length,
    dispose() {
      removeLabels();
      T.scene.remove(planets);
      planets.geometry.dispose();
      planets.material.dispose();
      planets.dispose();
      T.scene.remove(around);
      around.traverse(o => o.geometry?.dispose());
      for (const o of [laneLines, runners]) {
        T.scene.remove(o);
        o.geometry.dispose();
        o.material.dispose();
      }
      lineMaterial.dispose();
      beltMaterial.dispose();
      sphere.dispose();
    },
  };
}
