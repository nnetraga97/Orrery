// Owns stable orbital layout, Kepler positions, black holes and revision growth.
import * as THREE from 'three';
import * as d3 from 'd3';
import { layoutGalaxy } from './galaxy-layout.js';
import { canvasTexture, glowTex } from '../scene/textures.js';

const photonRingTex = canvasTexture(x => {
  const g = x.createRadialGradient(64, 64, 30, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,240,220,0)');
  g.addColorStop(0.7, 'rgba(255,240,220,1)');
  g.addColorStop(0.78, 'rgba(255,200,150,.35)');
  g.addColorStop(1, 'rgba(255,160,90,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
});

function diskMaterial(col, rIn, rOut) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(col) },
      uIn: { value: rIn },
      uOut: { value: rOut },
      uGain: { value: 1 },
    },
    vertexShader:
      'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime, uIn, uOut, uGain; uniform vec3 uColor; varying vec2 vP;
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x), t = clamp((r - uIn) / (uOut - uIn), 0.0, 1.0);
        float spin = uTime * (1.6 / (0.25 + t));                       // inner gas orbits faster
        float swirl = 0.5 + 0.5 * sin(a * 5.0 - log(r) * 10.0 + spin);
        float fine = 0.5 + 0.5 * sin(a * 17.0 - log(r) * 24.0 + spin * 1.7);
        float heat = pow(1.0 - t, 1.8);
        vec3 col = mix(uColor * 0.9, sRGBTransferEOTF(vec4(1.0, 0.93, 0.8, 1.0)).rgb, heat * 0.9);
        float beaming = 0.7 + 0.3 * cos(a);                            // one side of the disk looks brighter
        float alpha = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.7, 1.0, t)) * (0.18 + 0.55 * heat + 0.35 * swirl * (0.4 + heat) + 0.12 * fine) * beaming * uGain;
        gl_FragColor = vec4(col * alpha * 1.5, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false, // Emissive accretion glow retains its authored colour.
    side: THREE.DoubleSide,
  });
}

// ---------- the view ----------
// A file's identity is its path; an index is its position in the current snapshot only. Everything the eye follows
// from one revision to the next (system centres, the order of a system's bodies, each body's kind and current angle,
// each group's colour, the scale) is keyed by path or group and carried by build() into the next build, and kept in
// the project's galaxy memory across restarts. Changes ease in: bodies glide to new orbits, new ones grow, removed
// ones shrink away, systems slide outward when a neighbour grows into them.
const TAU = Math.PI * 2;
// Deterministic 0..1 from a string (FNV-1a), for jitter that must not change when indices do.
export const keyHash = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h / 4294967296;
};
const EASE = 1.1; // seconds for a body or system to settle into its new place
export const ease = k => (k >= 1 ? 1 : k <= 0 ? 0 : k * k * (3 - 2 * k));
export const clock = () => performance.now() / 1000;
// A file's fixed planet orientation, from its identity seed (uniform over rotations; Shoemake). Cached per seed.
const orientations = new Map();
export function orientationOf({ seed }) {
  if (!orientations.has(seed)) {
    const [u1, u2, u3] = ['#q1', '#q2', '#q3'].map(k => keyHash(seed + k));
    const a = Math.sqrt(1 - u1),
      b = Math.sqrt(u1);
    orientations.set(
      seed,
      new THREE.Quaternion(
        a * Math.sin(2 * Math.PI * u2),
        a * Math.cos(2 * Math.PI * u2),
        b * Math.sin(2 * Math.PI * u3),
        b * Math.cos(2 * Math.PI * u3),
      ),
    );
  }
  return orientations.get(seed);
}

// A body's orbit as it is drawn at `now` (part way through easing toward its target).
export function current(o, now) {
  const k = o.tween ? ease((now - o.tween.t) / EASE) : 1;
  const h = o.hole;
  if (k >= 1) {
    o.tween = null;
    return { a: o.a, ecc: o.ecc, size: o.size, plane: o.plane, center: h.center };
  }
  const w = o.tween;
  return {
    a: w.a + (o.a - w.a) * k,
    ecc: w.ecc + (o.ecc - w.ecc) * k,
    size: w.size + (o.size - w.size) * k,
    plane: w.plane.clone().slerp(o.plane, k),
    center: h.center,
  };
}
const anomaly = (o, t) => o.M0 + (t - o.t0) * o.speed;
function solve(M, ecc) {
  let E = M;
  for (let k = 0; k < 5; k++) E -= (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
  return E;
}
export function orbitPoint(o, t, now, out) {
  const c = current(o, now),
    E = solve(anomaly(o, t), c.ecc);
  return out
    .set(c.a * (Math.cos(E) - c.ecc), 0, c.a * Math.sqrt(1 - c.ecc * c.ecc) * Math.sin(E))
    .applyQuaternion(c.plane)
    .add(c.center);
}
const currentPosition = (o, t, now) => (o.frozenAt ? o.frozenAt.clone() : orbitPoint(o, t, now, new THREE.Vector3()));

export function createOrbits(ctx) {
  const { host, T, u, memory, model, frame: frameState } = ctx;
  const { e3 } = ctx.scratch;
  // A body's kind, with some hysteresis so a file near a threshold does not flip with every edit.
  function kindOf(n, j, count, crossFrac) {
    const outs = host.data.out()[n.i].length,
      ins = host.data.inc()[n.i].length,
      was = memory.kinds[n.path];
    if (outs >= 3 && j > count * 0.25 && crossFrac > (was === 'comet' ? 0.5 : 0.6)) return 'comet';
    if (was === 'asteroid' ? n.rloc < 55 && ins <= 2 : n.rloc < (was ? 38 : 45) && ins <= 1) return 'asteroid';
    return 'planet';
  }

  // 1. Each system in its own local frame: disk, planet rings, asteroid belt, comet ellipses. Bodies keep their
  // remembered order, new files join at the end, so earlier rings stay where they were.
  function layoutSystem(gi, m) {
    const key = host.data.groups()[gi],
      rh = u * (0.9 + Math.cbrt(m.length) * 0.45),
      diskIn = rh * 1.35,
      diskOut = rh * 3.2,
      pad = 2.6 * u;
    const here = new Map(m.map(n => [n.path, n])),
      remembered = (memory.systems[key]?.order || []).filter(p => here.has(p)),
      seen = new Set(remembered);
    const ordered = [...remembered.map(p => here.get(p)), ...m.filter(n => !seen.has(n.path))];
    const bodies = ordered.map((n, j) => {
      const crossFrac =
        host.data.out()[n.i].filter(t => host.graph.groupOf(host.data.nodes()[t]) !== host.graph.groupOf(n)).length / Math.max(1, host.data.out()[n.i].length);
      const kind = kindOf(n, j, ordered.length, crossFrac);
      const size =
        u *
        (kind === 'planet'
          ? Math.min(1.8, 0.45 + Math.sqrt(n.rloc) / 30)
          : kind === 'asteroid'
            ? 0.18 + Math.sqrt(n.rloc) / 55
            : 0.4);
      return { n, j, kind, crossFrac, size, jitter: keyHash(n.seed) };
    });
    // Planets fill concentric rings from the disk edge outward, at most five per ring, spaced by their size.
    const planets = bodies.filter(b => b.kind === 'planet');
    let r = diskOut + pad * 1.6,
      k = 0,
      ring = 0;
    while (k < planets.length) {
      const slot = [],
        circumference = 2 * Math.PI * r;
      let used = 0;
      while (
        k < planets.length &&
        slot.length < 5 &&
        (slot.length === 0 || used + planets[k].size * 2 + pad <= circumference * 0.6)
      ) {
        used += planets[k].size * 2 + pad;
        slot.push(planets[k++]);
      }
      const off = ring * 0.9 + keyHash(key) * TAU;
      slot.forEach((b, q) =>
        Object.assign(b, {
          a: r,
          ecc: 0,
          ring,
          phase: off + (q / slot.length) * Math.PI * 2,
          incl: (b.jitter - 0.5) * 0.06,
        }),
      );
      const widest = Math.max(...slot.map(b => b.size));
      r += widest * 2 + pad * 1.8;
      ring++;
    }
    const planetEdge = planets.length ? r - pad : diskOut + pad;
    // Asteroid belt: a band just outside the planets, wide enough to hold every rock without piling up.
    const rocks = bodies.filter(b => b.kind === 'asteroid');
    const beltMid = planetEdge + pad * 2 + rocks.length * 0.02 * u;
    const beltWidth = Math.max(
      pad * 2,
      rocks.reduce((sum, b) => sum + (b.size * 2.4) ** 2, 0) / (2 * Math.PI * beltMid),
    );
    rocks.forEach(b =>
      Object.assign(b, {
        a: beltMid + (keyHash(b.n.seed + '#a') - 0.5) * beltWidth,
        ecc: 0,
        phase: b.jitter * TAU,
        incl: (keyHash(b.n.seed + '#i') - 0.5) * 0.05,
      }),
    );
    const sysR = rocks.length ? beltMid + beltWidth / 2 : planetEdge;
    // Comets: long ellipses that dip inside the planets and swing well past the belt.
    bodies
      .filter(b => b.kind === 'comet')
      .forEach(b => {
        const peri = diskOut + pad + keyHash(b.n.seed + '#p') * (planetEdge - diskOut),
          apo = sysR * (1.5 + 0.6 * b.crossFrac);
        Object.assign(b, {
          a: (peri + apo) / 2,
          ecc: (apo - peri) / (apo + peri),
          phase: b.jitter * 9,
          incl: (keyHash(b.n.seed + '#i') - 0.5) * 1.2,
          node: keyHash(b.n.seed + '#n') * 6.28,
        });
      });
    return { gi, key, rh, diskIn, diskOut, sysR, bodies, order: ordered.map(n => n.path), reach: sysR * 1.15 };
  }

  // 3. Black holes, one per group, kept from one build to the next and resized in place.
  function makeHole(key, sy) {
    const rh = sy.rh;
    const tilt = new THREE.Quaternion().setFromEuler(e3.set(0, keyHash(key) * TAU, 0)); // disks lie in the galactic plane
    const root = new THREE.Group();
    T.scene.add(root);
    const coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(rh, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#000000' }),
    );
    root.add(coreMesh);
    const dm = diskMaterial(host.graph.color(key), sy.diskIn, sy.diskOut);
    const disk = new THREE.Mesh(new THREE.RingGeometry(sy.diskIn, sy.diskOut, 128, 1), dm);
    disk.rotation.x = -Math.PI / 2;
    root.add(disk);
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: photonRingTex,
        color: '#ffe6c8',
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    ring.scale.setScalar(rh * 3.1);
    root.add(ring);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: host.graph.color(key),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.3,
      }),
    );
    halo.scale.setScalar(sy.diskOut * 2.6);
    root.add(halo);
    return {
      g: key,
      base: rh,
      root,
      core: coreMesh,
      dm,
      halo,
      tilt,
      center: new THREE.Vector3(),
      scale: 0,
      tween: null,
    };
  }
  function disposeHole(h) {
    T.scene.remove(h.root);
    h.root.traverse(o => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
  // Move a hole (or start it) toward a centre and size, easing from wherever it is now.
  function aimHole(h, center, scale, now) {
    h.tween = { t: now, fromC: h.center.clone(), toC: center, fromS: h.scale, toS: scale };
  }
  function stepHoles(now) {
    for (const h of [...model.holes, ...model.fadingHoles]) {
      if (!h.tween) continue;
      const k = ease((now - h.tween.t) / EASE);
      h.center.lerpVectors(h.tween.fromC, h.tween.toC, k);
      h.scale = h.tween.fromS + (h.tween.toS - h.tween.fromS) * k;
      h.root.position.copy(h.center);
      h.root.scale.setScalar(Math.max(1e-4, h.scale));
      if (k >= 1) h.tween = null;
    }
    for (let q = model.fadingHoles.length - 1; q >= 0; q--)
      if (!model.fadingHoles[q].tween) {
        disposeHole(model.fadingHoles[q]);
        model.fadingHoles.splice(q, 1);
      }
  }

  // Content-only edits cannot change an orbit. Compare the actual layout inputs,
  // not source/detail hashes, before rebuilding every asteroid and planet batch.
  // Include import weights because they also determine illustrative traffic.
  const layoutInputs = () =>
    JSON.stringify([
      host.data.grouping(),
      host.data.groups().map(g => [g, host.graph.color(g)]),
      host.data.nodes().map(n => [n.path, n.seed, n.rloc, n.callables, host.graph.groupOf(n)]),
      host.data.links().map(l => [l.s, l.t, l.use]),
    ]);
  // Lay out the current snapshot (state.nodes, state.groups), easing from the previous build when there is one.
  function build() {
    const now = clock(),
      t = frameState.time,
      first = !model.systems.length && !model.holes.length;
    // Where every body is going now, by identity seed (a renamed file is the same body), so it can continue from there.
    const before = new Map();
    for (const o of model.orbit) if (o) before.set(o.seed, o);

    model.N = host.data.nodes().length;
    model.members = host.graph.membersOf();
    model.systems = model.members.map((m, gi) => layoutSystem(gi, m));

    // 2. Systems on one plane around the agent cannon (agent-cannon.js) at the origin: folders are spiral arms, and
    // along each arm the groups the rest of the code imports sit nearest the cannon (galaxy-layout.js). Remembered
    // systems keep their centres.
    const gap = 10 * u,
      between = new Map();
    host.data.links().forEach(l => {
      const a = host.data.groupIndex().get(host.graph.groupOf(host.data.nodes()[l.s])),
        b = host.data.groupIndex().get(host.graph.groupOf(host.data.nodes()[l.t]));
      if (a !== b) between.set(a + ',' + b, (between.get(a + ',' + b) || 0) + 1);
    });
    const groupLinks = [...between].map(([key, w]) => {
      const [a, b] = key.split(',').map(Number);
      return { a, b, w };
    });
    // The cannon's platform is about as wide as the largest black hole's disk, so it reads as the centre of the
    // galaxy. Its satellite station and terminal moon stay inside the keep-out. Kept once chosen.
    if (host.projects.has(host.data.dataset()) && model.systems.length)
      model.core = memory.core ??= Math.max(9 * u, 7 * (d3.max(model.systems, s => s.rh) || 0));
    else model.core = host.projects.has(host.data.dataset()) ? memory.core || 9 * u : 0;
    model.galaxy = layoutGalaxy(
      model.systems.map(s => ({ reach: s.reach })),
      groupLinks,
      {
        arms: host.graph.groupArms(),
        keepOut: model.core ? model.core * 3.2 + gap : gap,
        gap,
        fixed: model.systems.map(s => memory.systems[s.key]?.at || null),
      },
    );
    model.extent = model.galaxy.extent || model.core * 2 || 50;
    const around = (x, z, radius) =>
      d3.range(8).map(k => [x + Math.cos((k * Math.PI) / 4) * radius, z + Math.sin((k * Math.PI) / 4) * radius]);
    model.viewPoints = [
      ...model.systems.flatMap((s, gi) => around(model.galaxy.centers[gi][0], model.galaxy.centers[gi][1], s.reach)),
      ...around(0, 0, model.core * 3.2 || 2 * gap),
      ...model.galaxy.arms.map(arm => arm.at),
    ];

    // 3. Holes: kept by group, eased to their new centre and size; new ones grow in place, gone ones shrink away.
    const keys = new Set(model.systems.map(s => s.key));
    for (const [key, h] of model.holeByKey)
      if (!keys.has(key)) {
        model.holeByKey.delete(key);
        aimHole(h, h.center.clone(), 0, now);
        model.fadingHoles.push(h);
      }
    model.holes = model.systems.map((sy, gi) => {
      const to = new THREE.Vector3(model.galaxy.centers[gi][0], 0, model.galaxy.centers[gi][1]);
      let h = model.holeByKey.get(sy.key);
      if (!h) {
        model.holeByKey.set(sy.key, (h = makeHole(sy.key, sy)));
        h.center.copy(to);
        h.root.position.copy(to);
      }
      h.dm.uniforms.uColor.value.set(host.graph.color(sy.key));
      h.halo.material.color.set(host.graph.color(sy.key));
      Object.assign(h, { gi, rh: sy.rh, rOut: sy.diskOut, sysR: sy.sysR });
      if (first) {
        h.scale = sy.rh / h.base;
        h.root.scale.setScalar(h.scale);
      } else aimHole(h, to, sy.rh / h.base, now);
      return h;
    });

    // 4. Orbits in world space (each system's plane is tilted as a whole; bodies add a tiny inclination). A body that
    // existed keeps its current angle and eases to its new orbit; a new one grows in place, in the widest gap of its
    // ring; one whose kind changed shrinks away and returns as its new kind.
    const rRef = sy => sy.diskOut + 1.6 * 0.9 * u;
    model.orbit = new Array(model.N);
    model.kinds = { planet: [], asteroid: [], comet: [] };
    const fresh = [];
    model.systems.forEach(sy =>
      sy.bodies.forEach(b => {
        const h = model.holes[sy.gi];
        const plane = new THREE.Quaternion().setFromEuler(e3.set(b.incl, b.node || 0, 0)).premultiply(h.tilt);
        const prev = before.get(b.n.seed),
          same = prev && prev.kind === b.kind;
        const o = {
          path: b.n.path,
          seed: b.n.seed,
          gi: sy.gi,
          hole: h,
          spin: b.jitter * TAU,
          a: b.a,
          ecc: b.ecc,
          plane,
          ring: b.ring,
          speed: 0.27 * Math.pow(rRef(sy) / b.a, 1.5),
          kind: b.kind,
          size: b.size,
          slot: model.kinds[b.kind].length,
          M0: b.phase,
          t0: 0,
          tween: null,
          born: null,
        };
        if (same) {
          // Continue from the current angle at the new speed; ease the orbit's shape, plane and size.
          o.M0 = anomaly(prev, t);
          o.t0 = t;
          const live = current(prev, now);
          o.tween = { t: now, a: live.a, ecc: live.ecc, size: live.size, plane: live.plane.clone() };
        } else if (!first) {
          o.born = now;
          if (prev) model.ghosts.push({ o: { ...prev, frozenAt: currentPosition(prev, t, now) }, until: now + 0.6 });
          fresh.push(o);
        }
        model.orbit[b.n.i] = o;
        model.kinds[b.kind].push(b.n.i);
        b.n.kind = b.kind;
      }),
    );
    // Removed files shrink away where they were.
    const kept = new Set(host.data.nodes().map(n => n.seed));
    for (const [seed, o] of before)
      if (!kept.has(seed)) model.ghosts.push({ o: { ...o, frozenAt: currentPosition(o, t, now) }, until: now + 0.6 });
    // New planets take the widest gap in their ring.
    fresh
      .filter(o => o.kind === 'planet')
      .forEach(o => {
        const mates = model.orbit.filter(q => q && q !== o && q.gi === o.gi && q.ring === o.ring && q.kind === 'planet');
        const angles = mates.map(q => ((anomaly(q, t) % TAU) + TAU) % TAU).sort((x, y) => x - y);
        if (!angles.length) return;
        let best = 0,
          at = angles[0] + Math.PI;
        angles.forEach((x, q) => {
          const next = q + 1 < angles.length ? angles[q + 1] : angles[0] + TAU;
          if (next - x > best) [best, at] = [next - x, (x + next) / 2];
        });
        o.M0 = at;
        o.t0 = t;
      });

    model.byPath = new Map(host.data.nodes().map(n => [n.path, n.i]));
    model.pos = host.data.nodes().map((_, i) => model.pos[i] || new THREE.Vector3());
    model.tint = new Array(model.N).fill(1);

    ctx.bodies.rebuild(now);

    // Remember the shape for the next revision and the next launch.
    memory.systems = Object.fromEntries(model.systems.map((s, gi) => [s.key, { at: model.galaxy.centers[gi], order: s.order }]));
    memory.kinds = Object.fromEntries(host.data.nodes().map(n => [n.path, model.orbit[n.i].kind]));
    host.memory.save();
    ctx.bodies.paintBodies();
    model.builtInputs = layoutInputs();
  }

  return { build, layoutInputs, stepHoles };
}
