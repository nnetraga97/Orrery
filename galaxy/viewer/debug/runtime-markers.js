// Observed execution markers. Motion interpolates two observed points; it does not invent executed statements.
import * as THREE from 'three';
import { RiggedAssets } from '../scene/rigged-assets.js';
export function createRuntimeMarkers(T, towns, source, revision, evidence) {
  const root = new THREE.Group();
  root.name = 'runtime-debug-markers';
  T.scene.add(root);
  // Sizes follow the towns' marker unit, so the ship matches the towns it visits.
  const u = evidence?.unit ?? 0.03;
  let rig = null,
    loading = null,
    dead = false,
    serial = 0,
    target = null,
    from = null,
    started = 0;
  let label = () => {};
  function locate(point) {
    if (!point || point.file !== towns.sourceIndex.file || point.text !== source) return null;
    const found = towns.locate({ line: point.line, column: point.column, revision });
    if (found.status !== 'exact' || !found.element) return null;
    const e = found.element,
      frame = towns.frameOf(e.town),
      base = e.lot ? towns.worldOfLot(e.lot) : towns.centerOf(e.town),
      normal = frame.normalAt(base);
    const position = base.clone().addScaledVector(normal, u);
    position.setLength(Math.max(position.length(), frame.roof || 0) + 2 * u);
    return { position, normal, element: e.id };
  }
  // Breakpoints are evidence like any other: drawn by the evidence layer in their own family. A verified breakpoint
  // stands where Node confirmed it; a pending one where it was asked for, outlined.
  function breakpoints(points) {
    const here = points.filter(p => p.file === towns.sourceIndex.file && p.line >= 1);
    evidence?.set(
      'breakpoints',
      here.map(p => {
        const at = (p.status === 'verified' && p.locations?.find(l => l.file === towns.sourceIndex.file)) || p;
        return {
          type: 'breakpoint',
          file: p.file,
          line: at.line,
          column: at.column,
          revision: p.text === source ? revision : 'runtime-source-mismatch',
          source: 'Node Inspector',
          mode: p.mode,
          verified: p.status === 'verified',
        };
      }),
    );
  }
  async function trace(point) {
    const token = ++serial,
      at = locate(point);
    label();
    label = () => {};
    if (!at) {
      if (rig) rig.root.visible = false;
      target = null;
      return false;
    }
    if (!rig) {
      loading ||= RiggedAssets.create('arc', 3 * u);
      const loaded = await loading;
      if (dead) {
        loaded.dispose();
        return false;
      }
      if (!rig) {
        rig = loaded;
        root.add(rig.root);
      }
    }
    if (token !== serial || dead) return false;
    from = target && rig.root.visible ? rig.root.position.clone() : at.position.clone();
    target = at.position;
    started = performance.now();
    rig.root.visible = true;
    rig.root.position.copy(from);
    rig.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.normal);
    rig.root.userData.observation = {
      file: point.file,
      line: point.line,
      column: point.column,
      sequence: point.sequence,
      element: at.element,
    };
    label = T.addLabels([
      {
        text: `Execution ship · ${point.line}:${point.column}`,
        pos: () => rig.root.position.clone().addScaledVector(at.normal, rig.height + u),
        col: '#b7dfff',
        visible: () => rig.root.visible,
      },
    ]);
    return true;
  }
  const animate = () => {
    if (!target || !rig || !rig.root.visible) return;
    const t = Math.min(1, (performance.now() - started) / 300);
    rig.root.position.lerpVectors(from, target, t * t * (3 - 2 * t));
    rig.root.position
      .normalize()
      .multiplyScalar(THREE.MathUtils.lerp(from.length(), target.length(), t) + Math.sin(t * Math.PI) * 3 * u);
  };
  T.onFrame.push(animate);
  return {
    root,
    breakpoints,
    trace,
    dispose() {
      dead = true;
      ++serial;
      label();
      evidence?.set('breakpoints', []);
      rig?.dispose();
      T.scene.remove(root);
      const i = T.onFrame.indexOf(animate);
      if (i >= 0) T.onFrame.splice(i, 1);
    },
  };
}
