// Captured invocation evidence is a separate, static overlay. No illustrative ship clock can erase or advance it.
import * as THREE from 'three';
import { stackPaths } from '../../source-model/debug-records.js';
import { markerUnit } from './evidence-markers.js';
import { frameParts } from '../shared/debug-frames.js';

// Each frame here wears a card above its building: its number and method, and for the selected frame its arguments.
// Clicking a card selects that frame through onSelect(index).
export function createStackPaths(T, towns, { onSelect } = {}) {
  const group = new THREE.Group();
  group.name = 'captured-stack-paths';
  T.scene.add(group);
  // Sizes follow the towns' marker unit, so frames and paths match the towns they connect.
  const u = markerUnit(towns);
  let records = [],
    rows = [],
    edges = [],
    titles = [],
    details = new Map(),
    selected = null,
    removeLabels = () => {};
  const drawings = [];
  function clear() {
    removeLabels();
    for (const child of [...group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    }
    drawings.length = 0;
  }
  // The building execution is paused in stands in a column of light, with its plot ringed, so it reads from the
  // planet-wide view as well as close up.
  function pausedBeam(base, normal, width, top) {
    const height = top + 14 * u,
      radius = Math.max(0.35 * u, width * 0.32),
      shaft = new THREE.CylinderGeometry(radius * 0.7, radius, height, 16, 1, true).translate(0, height / 2, 0),
      alpha = new Float32Array(shaft.attributes.position.count * 4);
    for (let i = 0; i < shaft.attributes.position.count; i++) {
      alpha.set([1, 0.83, 0.48, shaft.attributes.position.getY(i) > height / 2 ? 0 : 0.5], i * 4);
    }
    shaft.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
    const beam = new THREE.Mesh(
      shaft,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    const plot = Math.max(width * 0.75, 0.9 * u),
      ring = new THREE.Mesh(
        new THREE.RingGeometry(plot * 0.82, plot, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffd37a', transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    for (const [mesh, lift] of [
      [beam, 0],
      [ring, 0.15 * u],
    ]) {
      mesh.position.copy(base).addScaledVector(normal, lift);
      mesh.quaternion.copy(quaternion);
      mesh.renderOrder = 22;
      mesh.name = 'paused-building';
      group.add(mesh);
    }
  }
  // The statement a frame stands on, as its code reads.
  function statementText(element) {
    const text = element.lot?.it.summary?.trim() ?? '';
    return text.length > 46 ? text.slice(0, 45) + '…' : text;
  }
  function select(n) {
    selected = n;
    for (const drawing of drawings) drawing.mesh.material.opacity = n == null || drawing.numbers.includes(n) ? 1 : 0.24;
    return rows.find(row => row.n === n) ?? null;
  }
  function set(next, names = []) {
    titles = names;
    details = new Map();
    const stack = stackPaths(next, file => (file === towns.sourceIndex.file ? towns.sourceIndex : null));
    clear();
    records = stack.rows.map(row => row.frame);
    rows = stack.rows;
    edges = stack.edges;
    const labels = [],
      points = new Map(),
      instances = new Map();
    for (const row of rows) {
      if (row.status !== 'exact' || !row.location?.element) continue;
      const element = row.location.element,
        k = element.town;
      const occurrence = instances.get(k) ?? 0;
      instances.set(k, occurrence + 1);
      const frame = towns.frameOf(k);
      const base = element.lot ? towns.worldOfLot(element.lot) : towns.centerOf(k),
        normal = frame.normalAt(base);
      const top = element.lot?.bounds?.height ?? 0;
      const point = base
        .clone()
        .addScaledVector(normal, top + (1.5 + occurrence * 1.2) * u)
        .addScaledVector(frame.e, occurrence * 1.1 * u);
      points.set(row.n, { point, k });
      if (row.frame.depth === 0) pausedBeam(base, normal, element.lot?.bounds?.width ?? 1.5 * towns.scaleOf(k), top);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 * u, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#ffe2a6', transparent: true, depthTest: false }),
      );
      mesh.position.copy(point);
      mesh.renderOrder = 24;
      group.add(mesh);
      drawings.push({ mesh, numbers: [row.n] });
      const n = row.n,
        code = statementText(element);
      labels.push({
        get text() {
          const lines = n === selected ? details.get(n) : null;
          return (
            `${n}  ${titles[n - 1] || ''}`.trim() +
            (code ? '\n' + code : '') +
            (lines?.length ? '\n' + lines.join('\n') : '')
          );
        },
        pos: () => point.clone().addScaledVector(frame.n0, 0.8 * u),
        col: '#ffe2a6',
        cls: 'stack-frame-label stack-frame-card',
        visible: () => group.visible,
        onClick: onSelect && (() => onSelect(n - 1)),
      });
    }
    for (const edge of edges) {
      const from = points.get(edge.from),
        to = points.get(edge.to);
      if (!from && !to) continue;
      const local = from ?? to,
        frame = towns.frameOf(local.k);
      let a = from?.point,
        b = to?.point;
      const missing = rows.find(row => row.n === (from ? edge.to : edge.from));
      // A cross-file endpoint is explicitly a boundary. Stale/ambiguous local locations get no invented anchor.
      if (!from || !to) {
        if (missing.frame.file === towns.sourceIndex.file) continue;
        const tip = local.point
          .clone()
          .addScaledVector(frame.e, towns.extentOf(local.k) + 2 * u)
          .addScaledVector(frame.n0, 3 * u);
        if (!a) a = tip;
        else b = tip;
        labels.push({
          text: `${missing.n} · ${missing.frame.file} (outside this planet)`,
          pos: () => tip,
          col: '#ffe2a6',
          visible: () => group.visible,
        });
      }
      let curve;
      if (from && to && from.k === to.k) {
        curve = new THREE.CubicBezierCurve3(
          a,
          a
            .clone()
            .addScaledVector(frame.e, 4 * u)
            .addScaledVector(frame.n0, 4 * u),
          b
            .clone()
            .addScaledVector(frame.e, -4 * u)
            .addScaledVector(frame.n0, 4 * u),
          b,
        );
      } else {
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        midpoint.normalize().multiplyScalar(Math.max(a.length(), b.length()) + Math.max(5 * u, a.distanceTo(b) * 0.3));
        curve = new THREE.QuadraticBezierCurve3(a, midpoint, b);
      }
      const material = edge.async
        ? new THREE.LineDashedMaterial({
            color: '#b7dfff',
            dashSize: u,
            gapSize: 0.6 * u,
            transparent: true,
            depthTest: false,
          })
        : new THREE.LineBasicMaterial({ color: '#ffe2a6', transparent: true, depthTest: false });
      const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), material);
      mesh.computeLineDistances();
      mesh.renderOrder = 23;
      group.add(mesh);
      drawings.push({ mesh, numbers: [edge.from, edge.to] });
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.45 * u, 1.3 * u, 6),
        new THREE.MeshBasicMaterial({ color: edge.async ? '#b7dfff' : '#ffe2a6', transparent: true, depthTest: false }),
      );
      arrow.position.copy(curve.getPoint(0.7));
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0.7).normalize());
      arrow.renderOrder = 24;
      group.add(arrow);
      drawings.push({ mesh: arrow, numbers: [edge.from, edge.to] });
    }
    removeLabels = T.addLabels(labels);
    select(rows.some(row => row.n === selected) ? selected : (rows[0]?.n ?? null));
    return rows;
  }
  return {
    group,
    invalidate() {
      clear();
      rows = rows.map(row =>
        row.frame.file === towns.sourceIndex.file ? { ...row, status: 'stale', location: null } : row,
      );
      return rows;
    },
    set,
    select,
    /** The selected frame's arguments, shown on its card once its variables arrive. */
    details(n, lines) {
      details.set(n, lines);
    },
    get records() {
      return records;
    },
    get rows() {
      return rows;
    },
    get edges() {
      return edges;
    },
    get selected() {
      return selected;
    },
    show: enabled => {
      group.visible = enabled;
    },
    dispose() {
      clear();
      group.removeFromParent();
    },
  };
}
