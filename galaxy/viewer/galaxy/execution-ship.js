// The debugger's execution ship in the constellation: it rides above the planet whose file execution is in, and flies
// between planets when execution moves to another file. Near its planet the frame cards mark execution instead, so it
// shrinks away as the camera arrives; in flight it always shows, including on the way out of a landed planet.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RiggedAssets } from '../scene/rigged-assets.js';

// As long as the camera's landing flight, so ship and camera arrive together.
const FLIGHT_S = 1.8;
const up = new THREE.Vector3(0, 1, 0);

export function createExecutionShip(ctx) {
  const { T, host } = ctx;
  const root = new THREE.Group();
  root.name = 'execution-ship';
  root.visible = false;
  T.scene.add(root);
  let rig = null,
    loading = null,
    dead = false,
    at = null, // { file, label, paused }
    index = null,
    shown = 0, // eased visibility, 0..1
    last = null,
    flight = null; // { from, started }
  const hoverOf = i =>
    T.bodyPos(i)
      .clone()
      .addScaledVector(up, T.bodySize(i) * 1.9);
  // At least a planet across, and never smaller than a few percent of the view, so it reads from far out.
  const lengthOf = (i, at) => Math.max(T.bodySize(i) * 1.2, T.camera.position.distanceTo(at) * 0.06);
  async function ensureRig() {
    if (rig || dead) return rig;
    loading ||= RiggedAssets.create('arc', 1);
    const loaded = await loading;
    if (dead) {
      loaded.dispose();
      return null;
    }
    rig = loaded;
    root.add(rig.root);
    return rig;
  }
  const removeLabel = T.addLabels([
    {
      get text() {
        return at?.label || '';
      },
      pos: () => root.position.clone().addScaledVector(up, (rig?.height ?? 1) * root.scale.y + T.unit * 0.6),
      col: '#b7dfff',
      cls: 'execution-ship-label',
      visible: () => root.visible && !!at?.label,
      onClick: () => host.debug?.selectFrame(0),
    },
  ]);
  // The ship itself is clickable like its label: it opens the paused frame's planet and variables.
  const removePicker = T.addPicker?.({
    objects: () => (root.visible ? [root] : []),
    describe: () =>
      at && {
        key: 'execution-ship',
        kind: 'Debugger',
        title: 'Execution ship',
        preview: [at.label, at.paused ? 'Click to open the paused frame' : ''].filter(Boolean),
        anchor: host.windows.worldAnchor(() => root.position),
        onClick: () => {
          // Landing hides the ship under a still pointer, so its hover window would otherwise stay open.
          host.windows.context.hover(null);
          host.debug?.selectFrame(0);
        },
      },
  });
  // The paused stack as a trail through its planets, innermost first: how execution reached the ship. Each planet on
  // it names its frames (frame cards on the planet say the same up close) and selects one on click.
  const trailMaterial = new LineMaterial({ color: '#ffe2a6', linewidth: 2, transparent: true, opacity: 0.8 }),
    trail = new Line2(new LineGeometry(), trailMaterial);
  trail.name = 'execution-stack-trail';
  trail.visible = false;
  trail.frustumCulled = false;
  T.scene.add(trail);
  let stops = [], // [{ i, frames: [{ label, index }] }] in stack order, one per run of frames in the same file
    removeStops = () => {};
  const stopAt = i =>
    T.bodyPos(i)
      .clone()
      .addScaledVector(up, T.bodySize(i) * 1.35);
  function setStack(stack) {
    removeStops();
    stops = [];
    for (const frame of stack || []) {
      const i = frame.file ? T.fileIndex(frame.file) : null;
      if (i == null) continue;
      const last = stops.at(-1);
      if (last?.i === i) last.frames.push(frame);
      else stops.push({ i, frames: [frame] });
    }
    // The ship's own label names the innermost frame; the other frames on its planet are listed beside it.
    removeStops = T.addLabels(
      stops.flatMap((stop, n) => {
        const frames = n ? stop.frames : stop.frames.slice(1);
        return frames.length
          ? [
              {
                text: frames.map(f => f.label).join(' · '),
                pos: () => stopAt(stop.i).addScaledVector(up, n ? 0 : -T.bodySize(stop.i) * 0.6),
                col: '#ffe2a6',
                cls: 'stack-frame-label stack-trail-label',
                avoidOverlap: true,
                visible: () => trail.visible,
                onClick: () => host.debug?.selectFrame(frames[0].index),
              },
            ]
          : [];
      }),
    );
  }
  const curvePoint = new THREE.Vector3(),
    viewport = new THREE.Vector2();
  function drawTrail() {
    trail.visible = root.visible && !flight && stops.length > 1;
    if (!trail.visible) return;
    const points = [];
    for (let n = 1; n < stops.length; n++) {
      const a = stopAt(stops[n - 1].i),
        b = stopAt(stops[n].i),
        lift = a.distanceTo(b) * 0.18;
      for (let k = n === 1 ? 0 : 1; k <= 24; k++) {
        const t = k / 24;
        curvePoint.lerpVectors(a, b, t).addScaledVector(up, Math.sin(Math.PI * t) * lift);
        points.push(curvePoint.x, curvePoint.y, curvePoint.z);
      }
    }
    trail.geometry.setPositions(points);
    trail.computeLineDistances();
    const canvas = T.controls?.domElement;
    if (canvas) trailMaterial.resolution.copy(viewport.set(canvas.clientWidth || 1, canvas.clientHeight || 1));
  }
  const next = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  function animate() {
    drawTrail();
    const now = performance.now();
    const dt = last == null ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const near = index == null ? 0 : T.camera.position.distanceTo(T.bodyPos(index)) / T.bodySize(index),
      wanted = rig && index != null && (flight || near > 6 || (near > 3.5 && !T.landedDetail?.())) ? 1 : 0;
    shown += (wanted - shown) * (1 - Math.exp(-dt / 0.18));
    root.visible = !!rig && index != null && shown > 0.02;
    if (!root.visible) return;
    const target = hoverOf(index);
    root.scale.setScalar(lengthOf(index, target) * shown);
    if (!flight) {
      root.position.copy(target);
      return;
    }
    const k = Math.min(1, (performance.now() - flight.started) / (FLIGHT_S * 1000)),
      e = k * k * (3 - 2 * k);
    const point = t =>
      next
        .lerpVectors(flight.from, target, t)
        .addScaledVector(up, Math.sin(t * Math.PI) * flight.from.distanceTo(target) * 0.25);
    const here = point(e).clone();
    tangent.copy(point(Math.min(1, e + 0.02))).sub(here);
    root.position.copy(here);
    if (tangent.lengthSq() > 1e-10) root.lookAt(here.clone().add(tangent));
    if (k >= 1) {
      flight = null;
      root.rotation.set(0, root.rotation.y, 0);
    }
  }
  T.onFrame.push(animate);
  async function moveTo(place) {
    at = place;
    setStack(place?.paused ? place.stack : null);
    const i = place?.file ? T.fileIndex(place.file) : null;
    if (i == null) {
      index = null;
      flight = null;
      return;
    }
    if (!(await ensureRig()) || at !== place) return;
    // Leave from where the ship is, or from above the planet it was hidden at (the landed one).
    if (index != null && index !== i)
      flight = { from: root.visible ? root.position.clone() : hoverOf(index), started: performance.now() };
    index = i;
  }
  let moving = Promise.resolve();
  /** Where execution is: { file, label, paused } or null when no session is paused or tracing. */
  T.executionAt = place => (moving = moveTo(place));
  // While the ship flies to `file`'s planet the camera rides behind it, then hands over to the caller (which lands).
  // Navigating by hand ends the ride where it is.
  let chase = null;
  T.followExecution = async file => {
    await moving;
    if (!flight || index !== T.fileIndex(file)) return;
    chase?.resolve();
    T.cancelFlight();
    T.clearControlMotion();
    T.setFollowing(false);
    return new Promise(resolve => {
      chase = {
        resolve,
        revision: T.navigationRevision,
        fromCamera: T.camera.position.clone(),
        fromTarget: T.controls.target.clone(),
        started: performance.now(),
      };
    });
  };
  const behind = new THREE.Vector3(),
    heading = new THREE.Vector3();
  function ride() {
    if (!chase) return;
    if (!flight || T.navigationRevision !== chase.revision) {
      chase.resolve();
      chase = null;
      return;
    }
    const blend = THREE.MathUtils.smoothstep((performance.now() - chase.started) / 1000, 0, 0.6),
      distance = Math.max(root.scale.x * 7, T.camera.near * 4);
    heading.copy(tangent).normalize();
    behind
      .copy(root.position)
      .addScaledVector(heading, -distance * 0.9)
      .addScaledVector(up, distance * 0.45);
    T.controls.target.lerpVectors(chase.fromTarget, root.position, blend);
    T.camera.position.lerpVectors(chase.fromCamera, behind, blend);
  }
  T.beforeCamera.push(ride);
  return {
    dispose() {
      dead = true;
      removeLabel();
      removeStops();
      trail.geometry.dispose();
      trailMaterial.dispose();
      trail.removeFromParent();
      removePicker?.();
      rig?.dispose();
      root.removeFromParent();
      const k = T.onFrame.indexOf(animate);
      if (k >= 0) T.onFrame.splice(k, 1);
      const r = T.beforeCamera.indexOf(ride);
      if (r >= 0) T.beforeCamera.splice(r, 1);
      chase?.resolve();
    },
  };
}
