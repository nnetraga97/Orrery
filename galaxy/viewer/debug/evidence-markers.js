// Observed evidence on a landed planet (docs/design/planet-towns.md §11, I-7). Every evidence type has its own marker
// family, so a breakpoint never reads as an exception and a static throw site is not drawn here at all. Markers sit
// above the buildings they belong to; a faint copy drawn through everything is the occlusion outline, and a selected
// marker on the far hemisphere gets an edge indicator on the planet's limb. A record lands only where the source
// index places it: stale, unmapped and ambiguous records stay listed with no guessed position.
import * as THREE from 'three';
import { createDebugRecord, EVIDENCE, resolveDebugRecord } from '../../source-model/debug-records.js';

/** Marker sizes follow the towns' building scale. */
export function markerUnit(towns) {
  const scales = Array.from({ length: towns.regionCount }, (_, k) => towns.scaleOf(k)).sort((a, b) => a - b);
  return Math.max(0.002, scales[scales.length >> 1] * 0.6 || 0.03);
}

import { FAMILIES, colorOf, textOf } from '../shared/evidence-records.js';
export { FAMILIES } from '../shared/evidence-records.js';

const STACK_ORDER = [
  EVIDENCE.exception,
  EVIDENCE.execution,
  EVIDENCE.breakpoint,
  EVIDENCE.testFailure,
  EVIDENCE.log,
  EVIDENCE.hotPath,
];

export function createEvidenceMarkers(T, towns) {
  const root = new THREE.Group();
  root.name = 'evidence-markers';
  T.scene.add(root);
  const u = markerUnit(towns),
    R = Math.max(1, ...Array.from({ length: towns.regionCount }, (_, k) => towns.centerOf(k).length()));
  // Shared shapes, one per family, at the towns' unit. Flat shapes lie in XY with +Z as their normal.
  const shapes = {
    [EVIDENCE.exception]: new THREE.ConeGeometry(0.75 * u, 1.3 * u, 3).rotateX(Math.PI),
    [EVIDENCE.execution]: new THREE.ConeGeometry(0.5 * u, 1.4 * u, 12).rotateX(Math.PI),
    [EVIDENCE.breakpoint]: new THREE.OctahedronGeometry(0.6 * u),
    [EVIDENCE.testFailure]: new THREE.BoxGeometry(0.9 * u, 0.9 * u, 0.9 * u),
    [EVIDENCE.log]: new THREE.CylinderGeometry(0.5 * u, 0.5 * u, 0.22 * u, 16),
  };
  const sources = new Map(),
    drawn = [],
    labels = [];
  let rows = [],
    selected = null,
    visible = true,
    removeLabels = () => {};

  const clear = () => {
    removeFar();
    removeFar = () => {};
    removeLabels();
    removeLabels = () => {};
    for (const d of drawn) {
      for (const mesh of d.meshes) {
        if (d.ownGeometry) mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.removeFromParent();
      }
    }
    drawn.length = 0;
    labels.length = 0;
  };
  // Where an element stands: its building's base on the deck, the deck normal, and the top of the building.
  const siteOf = element => {
    const frame = towns.frameOf(element.town),
      base = element.lot ? towns.worldOfLot(element.lot) : towns.centerOf(element.town),
      normal = frame.normalAt(base),
      // Buildings without a measured footprint are about one and a half plan units wide.
      width = element.lot?.bounds?.width ?? 1.5 * towns.scaleOf(element.town),
      top = element.lot?.bounds?.height ?? width;
    return { base, normal, top, width };
  };
  // A main mesh drawn with depth, plus its occlusion outline drawn through terrain and buildings.
  const pair = (geometry, color, position, quaternion) => {
    const solid = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color })),
      ghost = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }),
      );
    solid.renderOrder = 25;
    ghost.renderOrder = 26;
    for (const mesh of [solid, ghost]) {
      mesh.position.copy(position);
      mesh.quaternion.copy(quaternion);
      root.add(mesh);
    }
    return [solid, ghost];
  };
  const linePair = (geometry, color, position, quaternion) => {
    const solid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color })),
      ghost = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false }),
      );
    solid.renderOrder = 25;
    ghost.renderOrder = 26;
    for (const line of [solid, ghost]) {
      line.position.copy(position);
      line.quaternion.copy(quaternion);
      root.add(line);
    }
    return [solid, ghost];
  };
  const up = new THREE.Vector3(0, 1, 0),
    zAxis = new THREE.Vector3(0, 0, 1);

  function draw() {
    clear();
    // Stack slots per element, so several kinds of evidence on one building stay separate.
    const slots = new Map();
    // Where execution is paused the frame card names the statement, so a breakpoint there stays unlabelled.
    const paused = new Set(
      rows.filter(r => r.record.type === EVIDENCE.execution).flatMap(r => r.elements.map(e => e.id)),
    );
    for (const row of rows) {
      if (!row.elements.length) continue;
      const record = row.record,
        family = FAMILIES[record.type],
        color = colorOf(record);
      for (const element of row.elements) {
        const site = siteOf(element),
          meshes = [],
          // A marker is never wider than the building it marks: small buildings get proportionally small markers.
          k = Math.min(1, (0.6 * site.width) / u);
        let ownGeometry = false,
          anchor,
          markerLift;
        if (family.above) {
          const key = element.id,
            used = slots.get(key) ?? new Set();
          slots.set(key, used);
          let slot = STACK_ORDER.indexOf(record.type);
          while (used.has(slot)) slot += STACK_ORDER.length;
          used.add(slot);
          const order = [...used].sort((a, b) => a - b).indexOf(slot),
            lift = site.top + (1.2 + 1.6 * order) * u * k;
          anchor = site.base.clone().addScaledVector(site.normal, lift);
          markerLift = lift - site.top;
          const quaternion = new THREE.Quaternion().setFromUnitVectors(up, site.normal);
          let geometry = shapes[record.type];
          if (record.type === EVIDENCE.hotPath) {
            // Height follows the measured share of samples among this set's hot paths.
            const height = (0.6 + 2.4 * (record.samples / Math.max(1, row.peak))) * u;
            geometry = new THREE.BoxGeometry(0.45 * u, height, 0.45 * u).translate(0, height / 2 - 0.6 * u, 0);
            ownGeometry = true;
          }
          if (record.type === EVIDENCE.breakpoint && record.verified === false) {
            // A pending breakpoint is the same shape, outlined: Node has not confirmed it yet.
            meshes.push(...linePair(new THREE.WireframeGeometry(geometry), color, anchor, quaternion));
            ownGeometry = true;
          } else meshes.push(...pair(geometry, color, anchor, quaternion));
          for (const mesh of meshes) mesh.scale.setScalar(k);
        } else {
          // Ground families outline the building's own plot: a ring for coverage, a square for a git change.
          const quaternion = new THREE.Quaternion().setFromUnitVectors(zAxis, site.normal),
            half = Math.max(site.width * 0.62, 0.8 * u),
            position = site.base.clone().addScaledVector(site.normal, 0.15 * u);
          anchor = position;
          markerLift = 0.15 * u;
          ownGeometry = true;
          if (record.type === EVIDENCE.coverage && record.covered) {
            // Covered: a solid ring. Not covered: the same ring as an outline. Unknown coverage has no record at all.
            meshes.push(...pair(new THREE.RingGeometry(half * 0.88, half, 28), color, position, quaternion));
            for (const mesh of meshes) mesh.material.side = THREE.DoubleSide;
          } else {
            const outline =
              record.type === EVIDENCE.coverage
                ? new THREE.RingGeometry(half * 0.88, half, 28)
                : new THREE.PlaneGeometry(half * 2, half * 2);
            meshes.push(...linePair(new THREE.EdgesGeometry(outline), color, position, quaternion));
            outline.dispose();
          }
        }
        for (const mesh of meshes) mesh.userData.evidence = row.id;
        const drawing = {
          row,
          element,
          meshes,
          ownGeometry,
          anchor,
          buildingAnchor: anchor.clone(),
          markerLift,
          above: family.above,
          normal: site.normal,
          buildingNormal: site.normal.clone(),
          scale: family.above ? k : 1,
          summary: undefined,
          label: null,
        };
        drawn.push(drawing);
        // An exception always says what it was, and a breakpoint which statement it stops at; other labels appear
        // for the selected record.
        const code = (element.lot?.it.summary || '').trim(),
          always =
            record.type === EVIDENCE.exception || (record.type === EVIDENCE.breakpoint && !paused.has(element.id));
        drawing.text =
          record.type === EVIDENCE.breakpoint && code
            ? `${textOf(record)} · L${record.line} ${code.length > 40 ? code.slice(0, 39) + '…' : code}`
            : textOf(record);
        drawing.label = {
          text: drawing.text,
          pos: () => anchor.clone().addScaledVector(site.normal, 1.1 * u * k),
          col: color,
          cls: 'code-label',
          avoidOverlap: true,
          group: 'evidence',
          visible: () => visible && (always || selected === row.id),
        };
        labels.push(drawing.label);
      }
    }
    removeLabels = T.addLabels(labels);
    refreshSites();
    applySelection();
    root.visible = visible;
  }
  function refreshSites() {
    if (!visible) return;
    for (const d of drawn) {
      const summary = towns.overviewSite?.(d.element.town) ?? null;
      if (d.summary === summary) continue;
      d.summary = summary;
      d.normal.copy(summary ? towns.frameOf(d.element.town).normalAt(summary.base) : d.buildingNormal);
      if (summary) d.anchor.copy(summary.base).addScaledVector(d.normal, (d.above ? summary.top : 0) + d.markerLift);
      else d.anchor.copy(d.buildingAnchor);
      for (const mesh of d.meshes) {
        mesh.position.copy(d.anchor);
        mesh.quaternion.setFromUnitVectors(d.above ? up : zAxis, d.normal);
        mesh.userData.evidenceScope = summary ? 'town' : 'element';
      }
      d.label.text = `${summary ? 'Town overview · ' : ''}${d.text}`;
    }
  }
  T.onFrame.push(refreshSites);
  // The selected marker on the far hemisphere: an indicator on the limb, in the direction of the marker.
  let removeFar = () => {};
  function farIndicator() {
    removeFar();
    removeFar = () => {};
    const d = drawn.find(x => x.row.id === selected);
    if (!d) return;
    const limb = new THREE.Vector3(),
      dir = new THREE.Vector3(),
      side = new THREE.Vector3();
    removeFar = T.addLabels([
      {
        text: `◂ ${textOf(d.row.record)} · far side`,
        pos: () => {
          dir.copy(T.camera.position);
          const c = Math.max(dir.length(), R * 1.0001);
          dir.normalize();
          side.copy(d.anchor).addScaledVector(dir, -d.anchor.dot(dir));
          if (side.lengthSq() < 1e-12) side.set(dir.y, -dir.x, 0);
          return limb
            .copy(dir)
            .multiplyScalar((R * R) / c)
            .addScaledVector(side.normalize(), R * Math.sqrt(1 - (R * R) / (c * c)));
        },
        col: colorOf(d.row.record),
        cls: 'code-label evidence-edge',
        visible: () => visible && d.anchor.dot(T.camera.position) < R * R,
      },
    ]);
  }
  function applySelection() {
    farIndicator();
    for (const d of drawn) {
      const on = d.row.id === selected;
      d.meshes.forEach((mesh, i) => {
        mesh.scale.setScalar(d.scale * (on ? 1.35 : 1));
        // The selected marker's outline reads through anything (I-9).
        if (i % 2 === 1) mesh.material.opacity = on ? 0.75 : 0.28;
      });
    }
  }
  function resolve() {
    const index = towns.sourceIndex,
      all = [];
    for (const [source, records] of sources) for (const record of records) all.push({ source, record });
    const peaks = new Map();
    for (const { source, record } of all)
      if (record.type === EVIDENCE.hotPath) peaks.set(source, Math.max(peaks.get(source) ?? 0, record.samples ?? 0));
    rows = all.map(({ source, record }, n) => {
      const { location, status } = resolveDebugRecord(record, index);
      // Line-level evidence (no column or offset) is about every statement on that line, so a same-line tie marks
      // each of them rather than picking one. Anything more precise needs an exact match.
      const lineLevel = record.column == null && record.offset == null;
      const elements =
        status === 'exact' ? [location.element] : status === 'approximate' && lineLevel ? location.candidates : [];
      return {
        id: `${source}:${n}`,
        source,
        record,
        status: status === 'approximate' && lineLevel && elements.length ? 'line' : status,
        elements,
        peak: peaks.get(source) ?? 0,
      };
    });
    if (selected != null && !rows.some(r => r.id === selected)) selected = null;
    draw();
    return rows;
  }
  return {
    root,
    unit: u,
    /** Replaces one producer's records (runtime, git, a loaded file). Invalid input throws and keeps the old set. */
    set(source, records) {
      if (!Array.isArray(records) || records.length > 4096)
        throw new TypeError('Evidence must be an array of at most 4096 records');
      const next = records.map(r => createDebugRecord(r));
      if (next.some(r => r.type === EVIDENCE.frame))
        throw new TypeError('Stack frames belong in a captured stack, not in evidence markers');
      if (next.length) sources.set(source, next);
      else sources.delete(source);
      return resolve();
    },
    select(id) {
      selected = rows.some(r => r.id === id) ? id : null;
      applySelection();
      return rows.find(r => r.id === selected) ?? null;
    },
    /** Source changed: every local record is stale until its producer reports against the new revision. */
    invalidate() {
      rows = rows.map(r => (r.record.file === towns.sourceIndex.file ? { ...r, status: 'stale', elements: [] } : r));
      draw();
      return rows;
    },
    show(enabled) {
      visible = enabled;
      root.visible = enabled;
    },
    get rows() {
      return rows;
    },
    get selected() {
      return selected;
    },
    records: source => sources.get(source) ?? [],
    dispose() {
      const index = T.onFrame.indexOf(refreshSites);
      if (index >= 0) T.onFrame.splice(index, 1);
      clear();
      for (const geometry of Object.values(shapes)) geometry.dispose();
      root.removeFromParent();
    },
  };
}
