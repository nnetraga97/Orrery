// Static call evidence follows selection, hover and captured evidence; bounded ships are only an illustration.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { callRoutes } from '../../source-model/call-routes.js';
import { sampledRoute } from '../planet/planet-build.js';
import { planetBuildBudget } from '../shared/build-budget.js';
import { markerUnit } from '../debug/evidence-markers.js';

// Great-circle hops follow local ground. Roof is an absolute radius, not a lift;
// a distant town's tallest building must never raise every route on the planet.
// The hop stays low (terrain clearance is enforced per sample anyway): at 8% of the radius, routes to far towns
// arced off the planet's limb into space like stray wires.
export function surfaceFlight(from, to, groundAt, extent, unit) {
  const a = from.clone().normalize(),
    b = to.clone().normalize(),
    angle = a.angleTo(b),
    radius = Math.min(groundAt(a), groundAt(b)),
    hop = Math.min(radius * 0.025, extent * 0.45, Math.max(unit, angle * radius * 0.03));
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-8) axis.crossVectors(a, new THREE.Vector3(0, 1, 0));
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  const start = Math.max(0.03, from.length() - groundAt(a)),
    end = Math.max(0.03, to.length() - groundAt(b));
  return {
    getPoint(t, out = new THREE.Vector3()) {
      out.copy(a).applyAxisAngle(axis, angle * t);
      return out.multiplyScalar(groundAt(out) + start * (1 - t) + end * t + Math.sin(Math.PI * t) * hop);
    },
  };
}
export async function createCallRoutes(T, towns, regions, groundAt, file, signal, navigate = {}, incoming = []) {
  const checkpoint = planetBuildBudget(signal),
    group = new THREE.Group(),
    unit = markerUnit(towns),
    byId = new Map(regions.map((r, k) => [r.id, k])),
    resources = [],
    routes = [],
    aggregates = [],
    labels = [],
    captured = new Map();
  group.name = 'directed-call-routes';
  T.scene.add(group);
  let selected = -1,
    hovered = -1,
    selectedLot = null,
    enabled = false,
    elapsed = 0,
    last = null,
    ships = null;
  const all = callRoutes(regions, { file }),
    targetOf = r => (r.kind === 'external' ? r.to.external || 'unknown file' : 'unresolved'),
    groups = new Map(),
    gateTargets = new Map(),
    navigation = new Map();
  for (const route of all) {
    const a = byId.get(route.from.town),
      b = byId.get(route.to.town),
      key = b == null ? `${a}|${targetOf(route)}` : `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (!groups.has(key)) groups.set(key, { ...route, id: 'aggregate:' + key, calls: [], aggregate: true });
    groups.get(key).calls.push(route);
    if (b == null) {
      if (!gateTargets.has(a)) gateTargets.set(a, new Map());
      const targets = gateTargets.get(a),
        target = targetOf(route);
      targets.set(target, (targets.get(target) || 0) + 1);
    }
  }
  // Three named destinations and one overflow gate keep a town's file boundary legible.
  const gateNames = new Map(
    [...gateTargets].map(([k, counts]) => {
      const names = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
      return [k, names.length > 4 ? [...names.slice(0, 3), 'Other external files'] : names];
    }),
  );
  const gateName = (a, route) => {
    const names = gateNames.get(a),
      name = targetOf(route);
    return names.includes(name) ? name : 'Other external files';
  };
  const externalGroups = new Map();
  for (const route of groups.values()) {
    const a = byId.get(route.from.town);
    if (byId.get(route.to.town) != null) {
      aggregates.push(route);
      continue;
    }
    const name = gateName(a, route),
      key = a + '|' + name;
    if (!externalGroups.has(key)) externalGroups.set(key, { ...route, id: 'aggregate:' + key, calls: [] });
    externalGroups.get(key).calls.push(...route.calls);
  }
  aggregates.push(...externalGroups.values());
  const flight = (from, to, a, b = a) =>
    surfaceFlight(
      from,
      to,
      groundAt,
      Math.min(towns.extentOf(a), towns.extentOf(b)),
      Math.min(towns.scaleOf(a), towns.scaleOf(b)) * 0.6,
    );
  // Terrain lookups dominate route building, so sample each route at the density a half-planet route gets from
  // 1024 points instead of 1024 points for every route; short in-town routes need far fewer.
  const halfCircumference = Math.PI * groundAt(new THREE.Vector3(0, 1, 0));
  // surfaceFlight curves only provide getPoint, so estimate length from a coarse polyline.
  const roughLength = curve => {
    const a = curve.getPoint(0, new THREE.Vector3()),
      b = new THREE.Vector3();
    let length = 0;
    for (let i = 1; i <= 16; i++) {
      curve.getPoint(i / 16, b);
      length += a.distanceTo(b);
      a.copy(b);
    }
    return length;
  };
  const clearTerrain = curve => {
    const count = Math.min(1024, Math.max(64, Math.ceil((1024 * roughLength(curve)) / halfCircumference))),
      points = new Float32Array((count + 1) * 3),
      distances = new Float32Array(count + 1),
      p = new THREE.Vector3(),
      previous = new THREE.Vector3();
    for (let i = 0; i <= count; i++) {
      curve.getPoint(i / count, p);
      p.setLength(Math.max(p.length(), groundAt(p.clone().normalize()) + 0.03 + unit));
      points.set(p.toArray(), i * 3);
      if (i) distances[i] = distances[i - 1] + p.distanceTo(previous);
      previous.copy(p);
    }
    return sampledRoute({ points, distances, length: distances[count] });
  };
  const gateEnds = new Map();
  // Syntax front-ends resolve a local call by name and arity without a call-site range. The statement that makes it
  // is still known: the first one in the calling town whose own calls name that method on this object.
  const fits = (argc, m) =>
    m?.params == null || !Number.isFinite(argc) || (m.varargs ? argc >= m.params - 1 : argc === m.params);
  const siteOf = (route, a, b) => {
    const name = route.callee?.name,
      target = b == null ? null : regions[b];
    let matches = null;
    if ((route.kind === 'local' || route.kind === 'recursive') && target)
      matches = c => c.self && c.name === target.name && fits(c.argc, target);
    else if (route.kind === 'external' && name && route.callee.receiver)
      matches = c => !c.self && c.name === name && c.target === route.callee.receiver;
    const lot = matches && towns.elementsOf(a).find(l => (l.it.calls || []).some(matches));
    return lot ? { lot } : null;
  };
  try {
    for (const route of [...all, ...aggregates]) {
      await checkpoint();
      const a = byId.get(route.from.town),
        b = byId.get(route.to.town),
        frame = towns.frameOf(a),
        localUnit = Math.min(unit, towns.scaleOf(a) * 0.6),
        found = route.aggregate
          ? null
          : route.from.sourceStart == null
            ? siteOf(route, a, b)
            : towns.locate({ offset: route.from.sourceStart, town: a }),
        // An aggregate leaves from the building that makes its first located call (its calls were placed first), so
        // the line ties a statement to what it calls instead of fanning every connection out of the port.
        origin =
          found?.lot ?? (route.aggregate ? route.calls.find(call => call.a === a && call.sourceLot)?.sourceLot : null),
        from = origin ? towns.worldOfLot(origin) : towns.portOf(a).clone();
      let curve,
        gate = null;
      if (a === b) {
        // The loop stands beside its calling building (lots carry town-frame coordinates); around the frame origin
        // it crossed a large town to its middle and back.
        const lift = Math.min(towns.extentOf(a) * 0.4, localUnit * 3),
          x = origin?.x ?? 0,
          y = origin?.y ?? 0;
        curve = new THREE.CatmullRomCurve3([
          from,
          frame.world(x + 2 * localUnit, y, lift),
          frame.world(x + 2 * localUnit, y + 2 * localUnit, lift),
          frame.world(x - 2 * localUnit, y + 2 * localUnit, lift),
          from,
        ]);
      } else if (b != null) curve = flight(from, towns.portOf(b), a, b);
      else {
        const names = gateNames.get(a),
          name = gateName(a, route),
          slot = names.indexOf(name),
          key = a + '|' + name;
        if (!gateEnds.has(key))
          gateEnds.set(key, {
            key,
            a,
            name,
            end: frame.world(
              towns.extentOf(a) + 2 * localUnit,
              ((slot + 0.5) / names.length - 0.5) * towns.extentOf(a) * 1.8,
              1.2 * localUnit,
            ),
            visible: false,
          });
        gate = gateEnds.get(key);
        curve = flight(from, gate.end, a);
      }
      const drawing = new THREE.Group();
      drawing.visible = false;
      group.add(drawing);
      const navKey = a + ':' + b;
      if (b != null && !navigation.has(navKey))
        navigation.set(navKey, clearTerrain(flight(towns.portOf(a), towns.portOf(b), a, b)));
      Object.assign(route, {
        a,
        b,
        curve: clearTerrain(curve),
        drawing,
        line: null,
        gate,
        mapped: !!found?.lot,
        sourceLot: found?.lot,
        navigationCurve: b == null ? null : navigation.get(navKey),
      });
      if (!route.aggregate) routes.push(route);
    }
  } catch (error) {
    group.removeFromParent();
    resources.forEach(r => r.dispose());
    throw error;
  }
  const arrowGeometry = new THREE.ConeGeometry(0.2 * unit, 0.6 * unit, 5),
    endGeometry = new THREE.OctahedronGeometry(0.3 * unit),
    arrowMaterial = new THREE.MeshBasicMaterial({ color: '#e4e9d9' }),
    arrows = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, Math.max(1, routes.length + aggregates.length)),
    gates = new THREE.InstancedMesh(endGeometry, arrowMaterial, Math.max(1, gateEnds.size));
  arrows.frustumCulled = gates.frustumCulled = false;
  group.add(arrows, gates);
  resources.push(arrowGeometry, endGeometry, arrowMaterial);
  // A gate names the file it leads to by its short name, with the methods this town calls there.
  const calledThrough = gate => [
      ...new Set(routes.filter(r => r.gate === gate && r.callee?.name).map(r => r.callee.name)),
    ],
    listed = names =>
      names
        .slice(0, 2)
        .map(name => name + '()')
        .join(', ') + (names.length > 2 ? ` +${names.length - 2}` : ''),
    // An unresolved call most often names a method this file overloads (same name and arity): its towns are the
    // candidates, as an IDE's go-to-definition would list them.
    candidatesOf = gate => {
      const name = calledThrough(gate)[0];
      return name ? regions.flatMap((r, k) => (r.name === name ? [k] : [])) : [];
    };
  const gateText = gate => {
    const called = calledThrough(gate);
    if (gate.name === 'unresolved') {
      // Dynamic receivers (most unresolved JavaScript calls) only get a count; their names would be noise.
      const candidates = candidatesOf(gate).length,
        sites = routes.filter(r => r.gate === gate).length;
      return candidates > 1
        ? `? ${listed(called)} · ${candidates} overloads`
        : `? ${sites} unresolved call${sites === 1 ? '' : 's'}`;
    }
    const file = gate.name.split('/').pop();
    return called.length ? `${file} · ${listed(called)}` : file;
  };
  for (const gate of gateEnds.values())
    labels.push({
      text: gateText(gate),
      pos: gate.end.clone().addScaledVector(towns.frameOf(gate.a).normalAt(gate.end), 1.5 * unit),
      col: '#f1cb85',
      cls: 'code-label',
      avoidOverlap: true,
      group: 'call-endpoints',
      // A selected town's connections outrank its statement labels.
      priority: 1,
      maxVisible: 4,
      visible: () => gate.visible && selected === gate.a && T.camera.position.distanceTo(gate.end) < 120 * unit,
      // A file gate opens that file's planet at the first method this town calls there; an unresolved gate visits its
      // first candidate town.
      onClick:
        gate.name !== 'unresolved'
          ? navigate.toFile && (() => navigate.toFile(gate.name, calledThrough(gate)[0]))
          : navigate.toTown && candidatesOf(gate).length
            ? () => navigate.toTown(candidatesOf(gate)[0])
            : undefined,
    });
  // A selected town names where each of its connections goes, and where incoming calls come from.
  let visibleSet = new Set();
  // Where a connection leaves town k's ground: a label there reads as a signpost beside the selected town, where the
  // middle of a long route would be far off or over the horizon.
  const signpost = (curve, k, fromEnd) => {
    const center = towns.centerOf(k),
      clear = towns.extentOf(k) * 1.05 + Math.min(unit, towns.scaleOf(k) * 0.6),
      at = t => curve.getPointAt(fromEnd ? 1 - t : t).clone(),
      outside = t => at(t).distanceTo(center) > clear;
    // Coarse steps find the first sample past the town's edge; bisection then pins the crossing, which on a route
    // across the planet can lie well inside the first step.
    let inside = 0,
      past = null;
    for (let i = 1; i <= 20 && past == null; i++) if (outside(i / 40)) past = i / 40;
    if (past == null) return at(0.5);
    inside = past - 1 / 40;
    for (let i = 0; i < 10; i++) {
      const mid = (inside + past) / 2;
      if (outside(mid)) past = mid;
      else inside = mid;
    }
    return at(past);
  };
  for (const r of [...aggregates, ...routes]) {
    if (r.b == null) continue;
    if (r.a === r.b) {
      // A method calling itself loops beside the calling building; recursion is worth naming outright.
      const calls = r.calls ?? [r];
      labels.push({
        text: `↻ recursive call${calls.length > 1 ? ` ×${calls.length}` : ''}`,
        pos: r.curve.getPointAt(0.5).clone(),
        col: '#9fd3df',
        cls: 'code-label call-route-label',
        avoidOverlap: true,
        group: 'call-routes',
        maxVisible: 10,
        priority: 1,
        visible: () => visibleSet.has(r) && selected === r.a,
      });
      continue;
    }
    // Aggregates name a pair of towns; a call-site route (shown for a selected call building) names its callee.
    const nearA = signpost(r.curve, r.a, false),
      nearB = signpost(r.curve, r.b, true),
      calls = r.calls ?? [r],
      times = calls.length > 1 ? ` ×${calls.length}` : '',
      back = calls.some(call => byId.get(call.from.town) === r.b);
    labels.push({
      get text() {
        const other = selected === r.a ? r.b : r.a,
          out = selected === r.a ? '→' : '←',
          arrow = back ? '⇄' : out;
        return `${arrow} ${regions[other]?.name ?? 'method'}${times}`;
      },
      pos: () => (selected === r.b ? nearB : nearA),
      col: '#9fd3df',
      cls: 'code-label call-route-label',
      avoidOverlap: true,
      group: 'call-routes',
      maxVisible: 10,
      priority: 1,
      visible: () => visibleSet.has(r) && (selected === r.a || selected === r.b),
      onClick: navigate.toTown && (() => navigate.toTown(selected === r.a ? r.b : r.a)),
    });
  }
  const removeLabels = T.addLabels(labels),
    dummy = new THREE.Object3D();
  let visible = [];
  // Screen-space widths: WebGL lines are always one pixel wide, which made connections nearly invisible.
  const lineMaterials = [],
    viewport = new THREE.Vector2();
  // A dark casing under each connection keeps it legible on pale ground as well as dark. Both are opaque: a
  // translucent line blends twice where its segments' round joints overlap, beading it like a dotted rail.
  const cased = (geometry, material) => {
    const casingMaterial = new LineMaterial({
        color: '#1d2b34',
        linewidth: material.linewidth + 1.5,
        // Drawn first and leaving depth unwritten, so the line it outlines covers it along the same path.
        depthWrite: false,
      }),
      casing = new Line2(geometry, casingMaterial),
      line = new Line2(geometry, material),
      both = new THREE.Group();
    casing.renderOrder = 1;
    line.renderOrder = 2;
    both.add(casing, line);
    lineMaterials.push(material, casingMaterial);
    resources.push(geometry, material, casingMaterial);
    return { both, line };
  };
  // Calls into this file from other files (find usages): one gate per calling file on the callee town's far side from
  // its outgoing gates, with a line in to its port. Shown for the selected town; the label opens the caller.
  const incomingGates = [];
  {
    const byGate = new Map();
    for (const call of incoming) {
      const key = call.k + '|' + call.file;
      if (!byGate.has(key)) byGate.set(key, { k: call.k, file: call.file, callers: [] });
      const gate = byGate.get(key);
      if (!gate.callers.includes(call.caller)) gate.callers.push(call.caller);
    }
    const perTown = new Map();
    for (const gate of byGate.values()) (perTown.get(gate.k) || perTown.set(gate.k, []).get(gate.k)).push(gate);
    // Each line samples the terrain like a route does, so it yields like the route loop.
    try {
      for (const [k, list] of perTown)
        for (const [slot, gate] of list.entries()) {
          await checkpoint();
          const frame = towns.frameOf(k),
            localUnit = Math.min(unit, towns.scaleOf(k) * 0.6);
          gate.end = frame.world(
            -(towns.extentOf(k) + 2 * localUnit),
            ((slot + 0.5) / list.length - 0.5) * towns.extentOf(k) * 1.8,
            1.2 * localUnit,
          );
          const curve = clearTerrain(flight(gate.end, towns.portOf(k), k)),
            geometry = new LineGeometry().setPositions(curve.getPoints(128).flatMap(p => [p.x, p.y, p.z])),
            // Cool arrives at this function, as importers and callers do in the galaxy.
            material = new LineMaterial({ color: '#5cc4ff', linewidth: 2 });
          gate.line = cased(geometry, material).both;
          gate.line.visible = false;
          group.add(gate.line);
          incomingGates.push(gate);
        }
    } catch (error) {
      removeLabels();
      group.removeFromParent();
      arrows.dispose();
      gates.dispose();
      resources.forEach(r => r.dispose());
      throw error;
    }
  }
  const removeIncomingLabels = T.addLabels(
    incomingGates.map(gate => ({
      text:
        `← ${gate.file.split('/').pop()} · ${gate.callers
          .slice(0, 2)
          .map(name => name + '()')
          .join(', ')}` + (gate.callers.length > 2 ? ` +${gate.callers.length - 2}` : ''),
      pos: gate.end.clone().addScaledVector(towns.frameOf(gate.k).normalAt(gate.end), 1.5 * unit),
      col: '#5cc4ff',
      cls: 'code-label call-route-label',
      avoidOverlap: true,
      group: 'call-endpoints',
      // A selected town's connections outrank its statement labels.
      priority: 1,
      maxVisible: 8,
      visible: () => selected === gate.k && T.camera.position.distanceTo(gate.end) < 120 * unit,
      onClick: navigate.toFile && (() => navigate.toFile(gate.file, gate.callers[0])),
    })),
  );
  const updateVisibility = () => {
    const inView = towns.isInView ?? towns.isVisible,
      evidence = new Set([...captured.values()].flatMap(ids => [...ids]));
    const exact = routes.filter(
      r =>
        evidence.has(r.id) ||
        (selectedLot &&
          r.a === selected &&
          r.sourceLot &&
          r.sourceLot.it.sourceStart === selectedLot.it.sourceStart &&
          r.sourceLot.it.sourceEnd === selectedLot.it.sourceEnd),
    );
    const exactIds = new Set(exact.map(r => r.id));
    visible = [
      ...aggregates.filter(
        r =>
          (r.a === selected || r.b === selected || r.a === hovered || r.b === hovered) &&
          r.calls.some(call => !exactIds.has(call.id)),
      ),
      ...exact,
    ].filter(r => !inView || inView(r.a) || (r.b != null && inView(r.b)));
    visibleSet = new Set(visible);
    for (const r of [...routes, ...aggregates]) r.drawing.visible = false;
    for (const gate of gateEnds.values()) gate.visible = false;
    arrows.count = gates.count = 0;
    for (const r of visible) {
      if (!r.line) {
        const geometry = new LineGeometry().setPositions(r.curve.getPoints(256).flatMap(p => [p.x, p.y, p.z])),
          material = new LineMaterial({
            // Warm leaves this function (the colour of "this imports" and "this calls" in the galaxy); a call whose
            // target the analyzer could not resolve is grey, since it leads nowhere known.
            color: r.kind === 'unresolved' ? '#9aa3ad' : '#ffc56b',
            // More calls between a pair of towns draw a heavier connection.
            linewidth: r.aggregate ? Math.min(3.5, 1.75 + 0.5 * Math.log2(r.calls.length)) : 2,
          });
        const { both, line } = cased(geometry, material);
        r.line = line;
        r.line.name = r.id;
        r.drawing.add(both);
      }
      r.drawing.visible = true;
      dummy.position.copy(r.curve.getPointAt(0.65));
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.curve.getTangentAt(0.65).normalize());
      dummy.updateMatrix();
      arrows.setMatrixAt(arrows.count++, dummy.matrix);
      // Both directions share the same town pair, with a second arrow when
      // calls also travel back along this aggregate.
      if (r.aggregate && r.a !== r.b && r.calls.some(call => byId.get(call.from.town) === r.b)) {
        dummy.position.copy(r.curve.getPointAt(0.35));
        dummy.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          r.curve.getTangentAt(0.35).normalize().negate(),
        );
        dummy.updateMatrix();
        arrows.setMatrixAt(arrows.count++, dummy.matrix);
      }
      if (r.gate) r.gate.visible = true;
    }
    dummy.quaternion.identity();
    for (const gate of gateEnds.values())
      if (gate.visible) {
        dummy.position.copy(gate.end);
        dummy.updateMatrix();
        gates.setMatrixAt(gates.count++, dummy.matrix);
      }
    arrows.instanceMatrix.needsUpdate = gates.instanceMatrix.needsUpdate = true;
    for (const gate of incomingGates) gate.line.visible = selected === gate.k;
  };
  function animate(value) {
    enabled = value;
    if (!value || ships || !routes.length) return;
    const geometry = new THREE.ConeGeometry(0.45 * unit, 1.5 * unit, 4).rotateX(Math.PI / 2),
      material = new THREE.MeshStandardMaterial({ color: '#e4d6a5', roughness: 0.6 });
    ships = new THREE.InstancedMesh(geometry, material, Math.min(24, routes.length));
    ships.name = 'illustrative-call-ships';
    group.add(ships);
    resources.push(geometry, material);
  }
  const frame = t => {
    updateVisibility();
    const canvas = T.controls?.domElement;
    if (canvas) viewport.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
    for (const material of lineMaterials) material.resolution.copy(viewport);
    if (last != null && enabled) elapsed += Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (!ships) return;
    // Illustration follows only the town aggregates; captured calls remain evidence lines.
    const flights = enabled ? visible.filter(r => r.aggregate).slice(0, 24) : [];
    ships.count = flights.length;
    ships.visible = enabled && ships.count > 0;
    for (let i = 0; i < ships.count; i++) {
      const curve = flights[i].curve,
        u = (elapsed / 8 + i / ships.count) % 1;
      dummy.position.copy(curve.getPointAt(u));
      dummy.lookAt(dummy.position.clone().add(curve.getTangentAt(u)));
      dummy.updateMatrix();
      ships.setMatrixAt(i, dummy.matrix);
    }
    ships.instanceMatrix.needsUpdate = true;
    ships.boundingSphere = null;
  };
  updateVisibility();
  T.onFrame.push(frame);
  return {
    routes,
    aggregates,
    group,
    animate,
    focus(k, lot = null) {
      selected = k;
      selectedLot = lot;
      updateVisibility();
    },
    hover(k) {
      hovered = k;
      updateVisibility();
    },
    capture(owner, ids) {
      captured.set(owner, new Set(ids));
      updateVisibility();
    },
    dispose() {
      const index = T.onFrame.indexOf(frame);
      if (index >= 0) T.onFrame.splice(index, 1);
      removeLabels();
      removeIncomingLabels();
      group.removeFromParent();
      ships?.dispose();
      arrows.dispose();
      gates.dispose();
      resources.forEach(r => r.dispose());
    },
  };
}
