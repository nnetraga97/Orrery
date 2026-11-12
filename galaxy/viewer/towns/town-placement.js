// Owns building and port placement, instanced batches, and control and construction props.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as d3 from 'd3';
import { buildingProfile } from '../../source-model/building-profile.js';
import { instanceLotRig, lotMotionDriver } from './lot-motion.js';
import { createTownPortFleet } from './town-port-rig.js';
import { BUILD, arityFits } from '../shared/town-flow.js';

const hashStr = s => {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
};

export async function placeTownModels(build, kit, portAsset) {
  const { ctx, towns, group, disposables, focusBatches, pickables, pickMap, checkpoint } = build;
  const { R, regions, diffLines = [] } = ctx;
  const lotTime = { value: 0 },
    lotDriver = lotMotionDriver(lotTime),
    riggedBatches = [];

  const up = new THREE.Vector3(0, 1, 0);
  const batches = new Map(); // model → placements
  let activeRegion = -1;
  const put = (model, matrix, pick, tint) => {
    if (!model) return;
    let b = batches.get(model);
    if (!b) batches.set(model, (b = []));
    b.push({ matrix, pick, tint, k: pick?.k ?? activeRegion });
  };
  const choose = (role, key) => {
    const list = kit[role];
    return list && list.length ? list[Math.floor(hashStr(key) * list.length) % list.length] : null;
  };
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    basis = new THREE.Matrix4();

  // Orientation at a world point: y = surface normal, x = region east projected, z = x × y.
  const orient = (fr, p, yaw) => {
    const n = fr.normalAt(p),
      x = fr.e.clone().addScaledVector(n, -fr.e.dot(n)).normalize(),
      z = x.clone().cross(n).normalize();
    basis.makeBasis(x, n, z);
    q.setFromRotationMatrix(basis);
    if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
    return q;
  };
  const placeAt = (model, fr, x, y, lift, fp, yaw, pick, sy = 1, tint) => {
    if (!model) return;
    activeRegion = fr.k;
    const p = fr.world(x, y, lift);
    fr.roof = Math.max(fr.roof, fr.altitude(p) + fp * (sy * model.h + 0.5));
    if (pick?.lot) pick.lot.bounds = { width: fp, height: fp * sy * model.h };
    m4.compose(p, orient(fr, p, yaw).clone(), new THREE.Vector3(fp, fp * sy, fp));
    if (pick?.lot) pick.lot.matrix = m4.clone();
    put(model, m4.clone(), pick, tint);
  };

  // Resolve local connections before placing stations: only endpoints need a platform.
  const nameToMembers = new Map(),
    idToRegion = new Map();
  regions.forEach((r, k) =>
    r.members.forEach(m => {
      if (m.id) idToRegion.set(m.id, k);
      const key = `${m.owner || ''}:${m.name}`;
      if (!nameToMembers.has(key)) nameToMembers.set(key, []);
      nameToMembers.get(key).push({ k, m });
    }),
  );
  const pairCalls = new Map();
  towns.forEach(tw =>
    [...tw.out.lots, ...tw.out.forks, ...tw.out.loops].forEach(l =>
      (l.it.calls || []).forEach(c => {
        const resolved = c.id || c.targetId,
          precise = resolved && idToRegion.get(resolved);
        // New models require concrete target identity. Legacy Java calls retain
        // owner + arity matching until that language adapter supplies symbol IDs.
        const hits = resolved
          ? precise != null
            ? [precise]
            : []
          : c.resolution
            ? []
            : c.self
              ? (nameToMembers.get(`${regions[tw.k].owner || ''}:${c.name}`) || [])
                  .filter(t => arityFits(c.argc, t.m))
                  .map(t => t.k)
              : [];
        for (const j of new Set(hits)) {
          if (j === tw.k) continue;
          const key = tw.k + '>' + j;
          pairCalls.set(key, (pairCalls.get(key) || 0) + 1);
        }
      }),
    ),
  );
  const lines = new Map();
  pairCalls.forEach((n, key) => {
    const [a, b] = key.split('>').map(Number),
      id = a < b ? a + '-' + b : b + '-' + a;
    const L = lines.get(id) || { a: Math.min(a, b), b: Math.max(a, b), calls: [] };
    L.calls.push({ from: a, to: b, n });
    lines.set(id, L);
  });

  // --- buildings & props ---
  const edited = it => diffLines.some(l => l === it.line || (it.t === 'stmt' && l >= it.line && l <= it.end));
  const construction = [];
  const signs = [];
  const localIds = new Set(
    (ctx.allRegions ?? regions).flatMap(r => [r.id, ...r.members.map(m => m.id)]).filter(Boolean),
  );
  for (const tw of towns) {
    await checkpoint();
    const { fr, s } = tw,
      fp = BUILD * s;
    tw.out.lots.forEach(l => {
      const it = l.it,
        self = it.calls.filter(c => c.self || localIds.has(c.id || c.targetId)),
        lift = tw.s * (ctx.surface ? 0.067 : 0.04) + tw.liftAt(l.x, l.y);
      // A call on a variable of a known class that no analyzed file declares goes to a library or the platform.
      const projectCalls = regions[tw.k].externalCalls || [];
      const profile = buildingProfile(
        {
          ...it,
          calls: it.calls.map(c => ({
            ...c,
            local: localIds.has(c.id || c.targetId),
            library: !c.self && !!c.type && !projectCalls.some(p => p.receiver === c.target && p.name === c.name),
          })),
        },
        { file: ctx.file },
      );
      const yaw = l.rx > l.x ? Math.PI / 2 : -Math.PI / 2,
        key = regions[tw.k].id + ':' + it.id,
        pick = { k: tw.k, it, lot: l };
      const role = profile.role;
      l.profile = profile;
      l.role = role;
      pick.style = role;
      let size =
        role === 'crater'
          ? fp * 1.4
          : role === 'gate'
            ? fp * 1.1
            : role === 'tower'
              ? fp * 1.05
              : fp * (0.8 + 0.35 * Math.min(1, (it.end - it.line) / 6));
      // The chart compresses toward an island's edge. Buildings are rigid, so
      // fit them to the smallest local surface width, including both lot edges.
      if (!ctx.surface) {
        const radius = Math.hypot(l.x, l.y) + Math.SQRT2 * s,
          projection = (R * R) / (R * R + radius * radius);
        size = Math.min(size, 2 * s * 0.9) * projection;
      }
      const sy = ctx.surface && role === 'tower' ? 0.8 + 0.25 * Math.min(6, it.calls.length) : 1;
      const model = choose(role, key);
      let footprint = 1,
        base = 0;
      if (!ctx.surface && model) {
        if (!model.geo.boundingBox) model.geo.computeBoundingBox();
        const b = model.geo.boundingBox;
        footprint =
          model.rig?.footprint ?? Math.max(1e-6, ...[b.min.x, b.max.x, b.min.z, b.max.z].map(v => Math.abs(v) * 2));
        base = model.rig ? 0 : b.min.y;
        size /= footprint;
      }
      placeAt(model, fr, l.x, l.y, lift - base * size, size, role === 'gate' ? 0 : yaw, pick, sy);
      if (!ctx.surface && l.bounds) l.bounds.width = size * footprint;
      // A statement keeps a single principal building. Roof fixtures retain its
      // additional effects so 'return await f()' still visibly contains a call.
      profile.effects.forEach((effect, i) => {
        const marker = choose('effect' + effect.kind[0].toUpperCase() + effect.kind.slice(1), key),
          markerSize = size * 0.55;
        const roof = lift + size * sy * (model?.h || 0),
          offset = (i - (profile.effects.length - 1) / 2) * size * 0.3;
        placeAt(marker, fr, l.x + offset, l.y, roof, markerSize, yaw, { k: tw.k, it, style: role });
        if (l.bounds) l.bounds.height = Math.max(l.bounds.height, roof - lift + markerSize * (marker?.h || 0));
      });
      if (edited(it)) construction.push({ tw, x: l.x, y: l.y, lift, fp });
    });
    tw.out.forks.forEach(f => {
      signs.push({ tw, f });
      if (edited(f.it)) construction.push({ tw, x: f.x + 0.3 * s, y: f.y, lift: s * 0.067 + tw.liftAt(f.x, f.y), fp });
    });
    tw.out.loops.forEach(f => {
      if (edited(f.it)) construction.push({ tw, x: f.x, y: f.y, lift: s * 0.067, fp });
    });
    // Trees use spare land in the region, not a circular belt around the town.
    const p = tw.packing;
    for (let t = 0; t < 18; t++) {
      const ix = Math.floor(hashStr(tw.k + 'tx' + t) * p.nx),
        iy = Math.floor(hashStr(tw.k + 'ty' + t) * p.ny);
      if (p.used[iy * p.nx + ix]) continue;
      const [x, y] = p.xy(ix, iy);
      // A settlement's deck covers only the packed blocks; trees stay on it.
      if (p.bounds && (Math.abs(x) > p.bounds.w / 2 || Math.abs(y) > p.bounds.h / 2)) continue;
      if (tw.out.roads.some(rd => rd.pts.some(pt => Math.hypot(pt[0] - x, pt[1] - y) < s))) continue;
      // A kit tree is about 3.5 times as tall as it is wide: at 0.2 of a lot it stands 0.5-0.7 of a lot tall,
      // below most buildings.
      placeAt(choose('tree', tw.k + 'tr' + t), fr, x, y, s * 0.02, fp * 0.2, t);
    }
  }

  // Ports: every town's apron at the head of its main road. Landing pad for ships from callers (public entry points get the
  // full spaceport: rocket for outbound ships, hangar, control tower), with an accessible arrival socket.
  const SM = d3.median(towns, t => t.s); // shared scale for transport
  const portOf = [],
    launchOf = [],
    portPlacements = [];
  for (const tw of towns) {
    await checkpoint();
    const r = regions[tw.k],
      { fr, s, port: P } = tw,
      entryPick = {
        k: tw.k,
        it: { line: r.start, end: r.start, kind: 'entry', calls: [], fields: [] },
        style: P.pub ? 'spaceport' : 'port',
      };
    const u = (P.x1 - P.x0) / (P.pub ? 6.4 : 3.4); // one apron unit (= one lane)
    const padX = P.pub ? P.cx - 0.4 * u : P.cx - 0.6 * u,
      padY = P.cy - 0.2 * u;
    if (portAsset) {
      // Rigid like the buildings, so it takes the same shrink toward the chart's edge as the lots around it.
      const pr = Math.hypot(P.cx, P.cy) + Math.SQRT2 * s,
        fit = ctx.surface ? 1 : (R * R) / (R * R + pr * pr);
      const width = Math.min(Math.min(P.x1 - P.x0, P.y1 - P.y0) * 0.92, 1.5 * BUILD * s) * fit,
        p = fr.world(P.cx, P.cy, s * 0.053 + width * 0.035);
      const matrix = new THREE.Matrix4().compose(
        p,
        orient(fr, p, Math.PI).clone(),
        new THREE.Vector3(width, width, width),
      );
      portPlacements.push({ k: tw.k, width, matrix });
      portOf[tw.k] = fr.world(P.cx, P.cy, width * 0.12);
      launchOf[tw.k] = portOf[tw.k];
      fr.roof = Math.max(fr.roof, fr.altitude(p) + width * portAsset.height);
    } else {
      placeAt(
        choose(P.pub ? 'padLarge' : 'padSmall', 'p' + tw.k),
        fr,
        padX,
        padY,
        s * 0.053,
        u * (P.pub ? 2.3 : 1.6),
        0,
        entryPick,
      );
      portOf[tw.k] = fr.world(padX, padY, s * 0.053 + 0.12 * u);
      launchOf[tw.k] = portOf[tw.k];
      if (P.pub) {
        const rx = P.cx + 2.1 * u,
          ry = P.cy - 0.2 * u,
          fpR = u * 0.85;
        placeAt(choose('padSmall', 'rp' + tw.k), fr, rx, ry, s * 0.053, u * 1.4, 0, entryPick);
        const hb = kit.rocketBase?.[0]?.h || 0.6,
          hf = kit.rocketFuel?.[0]?.h || 0.6,
          z0 = s * 0.053 + 0.14 * u;
        placeAt(choose('rocketBase', 'rb'), fr, rx, ry, z0, fpR, 0, entryPick);
        placeAt(choose('rocketFuel', 'rf'), fr, rx, ry, z0 + hb * fpR, fpR, 0, entryPick);
        placeAt(choose('rocketTop', 'rt'), fr, rx, ry, z0 + (hb + hf) * fpR, fpR, 0, entryPick);
        launchOf[tw.k] = fr.world(rx, ry, z0 + (hb + hf + 0.5) * fpR);
        placeAt(choose('hangarLarge', 'h' + tw.k), fr, P.x0 + 0.95 * u, padY, 0.016, u * 1.6, Math.PI / 2, entryPick);
        placeAt(
          choose('ctrlTower', 'ct' + tw.k),
          fr,
          P.x1 - 0.45 * u,
          P.y0 + 0.5 * u,
          0.016,
          u * 0.7,
          0,
          entryPick,
          1.8,
        );
        placeAt(choose('parked', 'pk' + tw.k), fr, P.x0 + 0.9 * u, P.y0 + 0.4 * u, 0.02, u * 0.6, Math.PI / 2, null);
      }
    }
  }

  // Capital: the constructor's town gets the utilities (fields live here); pipelines run to every method that touches fields.
  const capitalK = regions.findIndex(r => r.members.some(m => m.kind === 'ctor'));
  if (capitalK >= 0) {
    const tw = towns[capitalK],
      { fr, s, port: P } = tw;
    ['waterTower', 'tank', 'tank', 'chimney'].forEach((role, i) =>
      placeAt(
        choose(role, role + i),
        fr,
        P.x0 + ((i + 0.5) * (P.x1 - P.x0)) / 4,
        P.y0 + 0.25 * s,
        0.02,
        s * 0.35,
        0,
        null,
      ),
    );
  }

  // --- instanced batches ---
  const semanticInstances = [];
  if (portAsset && portPlacements.length) {
    build.portFleet = createTownPortFleet(portAsset, group, portPlacements);
    pickables.push(...build.portFleet.meshes);
  }
  for (const [model, list] of batches) {
    await checkpoint();
    const rigged = model.rig && instanceLotRig(model.rig, list, lotTime, disposables, !ctx.surface);
    const inst = rigged ? rigged.pickMesh : new THREE.InstancedMesh(model.geo, model.mat, list.length);
    if (rigged) {
      rigged.meshes.forEach(mesh => group.add(mesh));
      focusBatches.push({ inst: rigged.focus, list });
      riggedBatches.push({ ...rigged, list });
    } else {
      focusBatches.push({ inst, list });
      group.add(inst);
      semanticInstances.push({ inst, list });
    }
    list.forEach((p, i) => {
      (rigged ? rigged.focus : inst).setColorAt(i, new THREE.Color('#bfd1c5'));
      if (!rigged) inst.setMatrixAt(i, p.matrix);
      if (!p.pick) return;
      pickMap.set(inst.uuid + ':' + i, p.pick);
      if (p.pick.lot?.role === 'office') p.pick.lot.instance = { mesh: inst, index: i };
      if (rigged && p.pick.lot) {
        p.pick.lot.motion = rigged.lots[i];
        rigged.lots[i].base = edited(p.pick.it) ? 1 : 0; // statements in the current change stay active
        lotDriver.set(rigged.lots[i], rigged.lots[i].base);
      }
    });
    if (list.some(p => p.pick)) pickables.push(inst);
    // One shared deadline spans all towns; forcing a frame per three batches makes large files take seconds.
    await checkpoint();
  }
  // Small roadside junction markers replace tall yellow flags. A wider invisible
  // pick volume preserves easy inspection; loop roads use the same target without a prop.
  const markerPost = new THREE.CylinderGeometry(0.06, 0.09, 0.22, 6).translate(0, 0.11, 0),
    markerPlate = new THREE.BoxGeometry(0.34, 0.1, 0.16).translate(0, 0.24, 0),
    markerParts = [markerPost.toNonIndexed(), markerPlate.toNonIndexed()],
    junctionGeometry = BufferGeometryUtils.mergeGeometries(markerParts),
    junctionMaterial = new THREE.MeshStandardMaterial({ color: '#9baaa5', roughness: 0.85 }),
    junctions = new THREE.InstancedMesh(junctionGeometry, junctionMaterial, Math.max(1, signs.length));
  markerPost.dispose();
  markerPlate.dispose();
  markerParts.forEach(part => part.dispose());
  junctions.name = 'town-junction-markers';
  junctions.count = signs.length;
  signs.forEach(({ tw, f }, i) => {
    const p = tw.fr.world(f.x + 0.6 * tw.s, f.y, tw.s * 0.067 + tw.liftAt(f.x, f.y));
    m4.compose(p, orient(tw.fr, p, 0).clone(), new THREE.Vector3(tw.s, tw.s, tw.s));
    junctions.setMatrixAt(i, m4);
  });
  focusBatches.push({ inst: junctions, list: signs.map(s => ({ k: s.tw.k })) });
  const junctionList = signs.map(({ tw, f }, i) => {
    const matrix = new THREE.Matrix4();
    junctions.getMatrixAt(i, matrix);
    return { k: tw.k, pick: { it: f.it }, matrix };
  });
  semanticInstances.push({ inst: junctions, list: junctionList });
  group.add(junctions);
  disposables.push(junctionGeometry, junctionMaterial);

  const controlPoints = [
    ...signs.map(({ tw, f }) => ({ tw, f, style: 'fork', x: f.x + 0.6 * tw.s })),
    ...towns.flatMap(tw => tw.out.loops.map(f => ({ tw, f, style: 'loop', x: f.x }))),
  ];
  const controlGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 8).translate(0, 0.18, 0),
    controlMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    controls = new THREE.InstancedMesh(controlGeometry, controlMaterial, Math.max(1, controlPoints.length));
  controls.name = 'town-control-pick-targets';
  controls.count = controlPoints.length;
  controlPoints.forEach(({ tw, f, style, x }, i) => {
    const p = tw.fr.world(x, f.y, tw.s * 0.067 + tw.liftAt(x, f.y));
    m4.compose(p, orient(tw.fr, p, 0).clone(), new THREE.Vector3(tw.s, tw.s, tw.s));
    controls.setMatrixAt(i, m4);
    pickMap.set(controls.uuid + ':' + i, { k: tw.k, it: f.it, style });
  });
  semanticInstances.push({
    inst: controls,
    list: controlPoints.map(({ tw, f }, i) => {
      const matrix = new THREE.Matrix4();
      controls.getMatrixAt(i, matrix);
      return { k: tw.k, pick: { it: f.it }, matrix };
    }),
  });
  group.add(controls);
  pickables.push(controls);
  disposables.push(controlGeometry, controlMaterial);

  // The ring road already communicates a loop. One quiet ring marks the selected loop.
  const loopGeometry = new THREE.TorusGeometry(0.3, 0.035, 5, 24).rotateX(Math.PI / 2).translate(0, 0.08, 0),
    loopMaterial = new THREE.MeshStandardMaterial({ color: '#b0a6c0', roughness: 0.8 }),
    loopMarker = new THREE.Mesh(loopGeometry, loopMaterial);
  loopMarker.name = 'town-selected-loop';
  loopMarker.visible = false;
  group.add(loopMarker);
  disposables.push(loopGeometry, loopMaterial);
  // Construction: scaffolding + crane on edited code (procedural).
  {
    const n = Math.max(1, construction.length);
    const scaff = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#ff9a2a', wireframe: true }),
      n,
    );
    const mast = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 2.4, 0.06).translate(0, 1.2, 0),
      new THREE.MeshStandardMaterial({ color: '#ffb000' }),
      n,
    );
    const jib = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.6, 0.06, 0.06).translate(0.55, 2.4, 0),
      new THREE.MeshStandardMaterial({ color: '#ffb000' }),
      n,
    );
    scaff.count = mast.count = jib.count = construction.length;
    construction.forEach((c, i) => {
      const p = c.tw.fr.world(c.x, c.y, c.lift),
        o = orient(c.tw.fr, p, i).clone();
      m4.compose(p, o, new THREE.Vector3(c.fp * 1.2, c.fp * 1.4, c.fp * 1.2));
      scaff.setMatrixAt(i, m4);
      const p2 = c.tw.fr.world(c.x + c.fp * 0.7, c.y + c.fp * 0.7, c.lift);
      m4.compose(p2, o, new THREE.Vector3(c.fp, c.fp, c.fp));
      mast.setMatrixAt(i, m4);
      jib.setMatrixAt(i, m4);
    });
    group.add(scaff, mast, jib);
    disposables.push(scaff.geometry, scaff.material, mast.geometry, mast.material, jib.geometry, jib.material);
  }

  return {
    orient,
    lotTime,
    lotDriver,
    riggedBatches,
    semanticInstances,
    loopMarker,
    SM,
    portOf,
    launchOf,
    lines,
    capitalK,
  };
}
