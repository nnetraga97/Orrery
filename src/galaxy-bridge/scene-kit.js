// The XR scene kit: the same `T` surface as galaxy/viewer/scene/scene3d.js, for a page where IWSDK owns the renderer
// and the frame loop. Derived from scene3d.js; the differences are listed in docs/plans/m1-m2-galaxy-and-code.md,
// Task 4. The camera here is a *virtual* camera that is never rendered from: the galaxy system turns it into the pose
// of the model on the table (src/core/table-frame.ts), so the copied navigation code keeps working unchanged.
import * as THREE from '@iwsdk/core';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLOR, legacyIntensity } from '../../galaxy/viewer/scene/color-space.js';
import { GalaxyFrameLoop } from '../../galaxy/viewer/scene/frame-loop.js';
import { GalaxySky } from '../../galaxy/viewer/scene/galaxy-sky.js';
import { dotTex } from '../../galaxy/viewer/scene/textures.js';
import { cameraInput, dampingBlend } from '../../galaxy/viewer/scene/camera-input.js';
import { pickScene } from '../../galaxy/viewer/scene/scene-picking.js';
import { applyDolly, applyOrbit } from '../core/orbit.ts';

// The virtual stage: the desktop stage was about 1600 × 1000 pixels. The virtual camera uses its aspect.
const STAGE_WIDTH = 1600,
  STAGE_HEIGHT = 1000,
  ASPECT = STAGE_WIDTH / STAGE_HEIGHT;

// The farthest the virtual camera may dolly from its target (model units): the whole galaxy and its sky.
const MAX_DISTANCE = 2000;

const noLabels = { setLabels() {}, addLabels: () => () => {}, update() {} };
const noOverlays = { update() {} };

export function createSceneKit({ camPos, host, renderer, anchor = null, labels = noLabels, overlays: overlayLayer = noOverlays }) {
  const errorNotice = host.dom('sceneError');
  errorNotice.hidden = true;
  errorNotice.querySelector('button').onclick = () => host.actions.render();
  const frames = GalaxyFrameLoop.create({
    onError: ({ scope }) => {
      errorNotice.querySelector('span').textContent =
        scope === 'scene'
          ? 'The scene stopped rendering. Reload the view to recover.'
          : 'An animation stopped. The rest of the view is still running.';
      errorNotice.hidden = false;
    },
  });
  const scene = new THREE.Group();
  scene.name = 'galaxy-scene';
  const sky = GalaxySky.create(renderer);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let environment;
  try {
    environment = pmrem.fromCubemap(sky.texture);
  } finally {
    pmrem.dispose();
  }
  // The virtual camera. Never rendered from; it only decides the model's pose on the table.
  const camera = new THREE.PerspectiveCamera(45, ASPECT, 0.5, 3000);
  camera.position.set(...camPos);
  // Receives no events: it holds the target and keeps camera and target consistent in controls.update(). The copied
  // code reads the element's size as the stage's (bodies are sized in pixels for level of detail), so it reports the
  // virtual stage the host describes (1600 × 1000).
  const element = document.createElement('div');
  Object.defineProperties(element, { clientWidth: { value: STAGE_WIDTH }, clientHeight: { value: STAGE_HEIGHT } });
  element.getBoundingClientRect = () => new DOMRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#a9c0ff', '#0a0f1c', legacyIntensity(COLOR.hemisphereIntensity)));
  const sun = new THREE.DirectionalLight('#ffffff', legacyIntensity(COLOR.directionalIntensity));
  sun.position.set(80, 160, 60);
  scene.add(sun);
  // On the desktop the sun aims at the world origin, which was the model's origin; here that is the group's origin.
  scene.add(sun.target);

  // Hover picking on an InstancedMesh (instanceId -> file index), at most one raycast per frame. The pointer arrives
  // as a ray in the model's own space (pointerMove / pointerClick); picking tests objects by their world matrices,
  // which include the model's pose on the table, so the ray is carried back into the room before it is cast.
  const ray = new THREE.Raycaster(),
    modelRay = new THREE.Ray();
  let pickMesh = null,
    pickMap = null,
    onPick = () => {},
    pending = false,
    lastPick = -1,
    pickBlock = null,
    blocked = false,
    hasRay = false;
  // Other clickable things (black holes, ships, lanes, the cannon…): { objects() -> Object3D[], describe(hit) -> context-window spec | null }.
  const pickers = [];
  let hoverItem = null;
  function updatePick() {
    pending = false;
    if (!hasRay) return;
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    ray.ray.copy(modelRay).applyMatrix4(scene.matrixWorld);
    // Fat lines and sprites in the pickers need a camera to be hit-tested; the virtual camera stands in.
    ray.camera = camera;
    // Line and point hit thresholds are in world units and ignore parent scale; keep the desktop's one model unit.
    ray.params.Line.threshold = ray.params.Points.threshold = scene.scale.x;
    blocked = !!pickBlock?.(ray);
    const { id, item } = blocked ? { id: -1, item: null } : pickScene(ray, pickMesh, pickMap, pickers);
    if (id !== lastPick) {
      lastPick = id;
      if (!blocked) onPick(id === -1 ? null : id);
    }
    if ((item?.key || null) !== (hoverItem?.key || null)) {
      hoverItem = item;
      host.windows.context.hover(item);
    } else hoverItem = item;
  }
  // A landed planet picks its towns on a click on the controls element, with a ray from its camera (a copy of this
  // virtual camera) through the pointer's stage pixel (planet-interaction.js). For one synchronous click the virtual
  // camera is put at the hand ray's origin, looking along it, and the click is sent at the stage's centre, so the
  // planet picks along the hand ray; the camera is then put back. (Hover is not forwarded: the planet resolves it
  // later in the frame, when the camera must be where the view needs it.)
  // The planet's own scene is nested in the model here, but its picking works in the planet's frame as on the
  // desktop, where that scene had no parent: for the click it is detached, then put back.
  const savedPosition = new THREE.Vector3(),
    savedTurn = new THREE.Quaternion(),
    lookPoint = new THREE.Vector3(),
    detached = [];
  function clickPlanet() {
    detached.length = 0;
    overlays.forEach(o => {
      if (!o.viewport && o.opacity > 0.02 && o.scene.parent) detached.push(o.scene.parent, o.scene);
    });
    if (!detached.length) return;
    for (let k = 0; k < detached.length; k += 2) detached[k].remove(detached[k + 1]);
    savedPosition.copy(camera.position);
    savedTurn.copy(camera.quaternion);
    camera.position.copy(modelRay.origin);
    camera.lookAt(lookPoint.copy(modelRay.origin).add(modelRay.direction));
    camera.updateMatrixWorld();
    try {
      element.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: STAGE_WIDTH / 2,
          clientY: STAGE_HEIGHT / 2,
          button: 0,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    } finally {
      camera.position.copy(savedPosition);
      camera.quaternion.copy(savedTurn);
      camera.updateMatrixWorld();
      for (let k = 0; k < detached.length; k += 2) detached[k].add(detached[k + 1]);
    }
  }

  function pointerMove(r) {
    modelRay.copy(r);
    hasRay = true;
    pending = true;
  }
  function pointerLeave() {
    hasRay = false;
    pending = false;
    if (lastPick !== -1) {
      lastPick = -1;
      onPick(null);
    }
    if (hoverItem) {
      hoverItem = null;
      host.windows.context.hover(null);
    }
  }
  // A drag that turned the model ends in a click the pointer library still sends; the gesture owner swallows it.
  let swallowClick = false;
  function pointerClick(r) {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    // A fast pinch or a moving model may not have produced a hover frame.
    pointerMove(r);
    updatePick();
    clickPlanet();
    if (blocked) return;
    if (lastPick === -1 && hoverItem) {
      if (hoverItem.onClick) hoverItem.onClick();
      else host.windows.context.pin(hoverItem);
      return;
    }
    if (lastPick === -1) host.windows.context.close();
    host.actions.selectFile(lastPick === -1 ? null : lastPick, { fly: lastPick !== -1 });
  }

  // Selection: pinned highlight, pulsing ring marker, camera fly-to.
  let pinned = null,
    posOfSel = null,
    tint = null,
    flight = null,
    customHighlight = null,
    follow = false,
    following = true,
    followPrev = null,
    flyDist = 42,
    markerHidden = false;
  const ringTex = new THREE.CanvasTexture(
    (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      x.strokeStyle = '#ffffff';
      x.lineWidth = 7;
      x.beginPath();
      x.arc(64, 64, 52, 0, 7);
      x.stroke();
      return c;
    })(),
  );
  ringTex.colorSpace = THREE.SRGBColorSpace;
  const marker = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: ringTex, color: '#ffffff', depthTest: false, transparent: true }),
  );
  marker.visible = false;
  marker.renderOrder = 10;
  scene.add(marker);
  // flyTo(p, dist): keep the view direction. With { cam }, fly to that camera position; { arc } swings around the origin.
  // With { frame }, p / cam / dist are in a moving local frame (() => { origin, scale }) and the flight tracks it.
  let navigationRevision = 0;
  function clearControlMotion() {
    navigation.clearZoom();
    const position = camera.position.clone(),
      target = controls.target.clone(),
      damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(position);
    controls.target.copy(target);
    controls.enableDamping = damping;
  }
  function interruptNavigation(source = 'pointer') {
    flight = null;
    navigationRevision++;
    if (source !== 'zoom') navigation.clearZoom();
  }
  controls.addEventListener('start', () => interruptNavigation());
  const goHome = () => {
    interruptNavigation();
    following = false;
    const home = host.overview();
    flyTo(home?.target || new THREE.Vector3(), 0, { cam: home?.position || new THREE.Vector3(...camPos) });
  };
  const navigation = cameraInput(controls, {
    inputDevice: host.preferences.recall('galaxyCameraInput') || 'trackpad',
    rememberDevice: device => host.preferences.remember('galaxyCameraInput', device),
    navigate: interruptNavigation,
    canFocus: () => pinned != null,
    focus: () => {
      if (pinned != null) {
        interruptNavigation();
        select(pinned);
      }
    },
    home: goHome,
  });
  function flyTo(p, dist, { cam = null, arc = false, frame = null, duration = 900 } = {}) {
    const previous = flight;
    clearControlMotion();
    const f = frame?.(),
      local = v => (f ? v.clone().sub(f.origin).divideScalar(f.scale) : v.clone());
    const fromT = local(controls.target),
      fromC = local(camera.position),
      dir = fromC.clone().sub(fromT).normalize();
    flight = {
      fromT,
      toT: p.clone(),
      fromC,
      toC: cam ? cam.clone() : p.clone().add(dir.multiplyScalar(dist)),
      arc,
      frame,
      duration,
      elapsed: 0,
      last: null,
    };
    const previousFrame = previous?.frame?.(),
      sameOrigin = (!f && !previousFrame) || (f && previousFrame && f.origin.distanceTo(previousFrame.origin) < 1e-6);
    const velocityScale = (previousFrame?.scale || 1) / (f?.scale || 1);
    const inherit = (velocity, from, to) =>
      sameOrigin && velocity
        ? velocity
            .clone()
            .multiplyScalar(velocityScale)
            .clampLength(0, (3 * from.distanceTo(to)) / (duration / 1000))
        : new THREE.Vector3();
    flight.velocityC = inherit(previous?.velocityC, fromC, flight.toC);
    flight.velocityT = inherit(previous?.velocityT, fromT, flight.toT);
    flight.initialC = flight.velocityC.clone();
    flight.initialT = flight.velocityT.clone();
    // Spherical interpolation has a well-defined path even for opposite hemispheres.
    flight.turnT = new THREE.Quaternion().setFromUnitVectors(fromT.clone().normalize(), flight.toT.clone().normalize());
    flight.turnC = new THREE.Quaternion().setFromUnitVectors(fromC.clone().normalize(), flight.toC.clone().normalize());
    controls.autoRotate = false;
  }
  const bodyFrame = i => () => ({ origin: posOfSel(i), scale: 1 });
  function select(i, { fly = true } = {}) {
    pinned = i;
    navigation.updateSelection();
    followPrev = null;
    following = true;
    marker.visible = i != null && !markerHidden;
    if (tint) tint(i);
    (customHighlight || highlight)(i, posOfSel);
    if (i != null && fly) flyTo(new THREE.Vector3(), flyDist, { frame: bodyFrame(i) });
  }

  // Hover overlay: curved arcs to imports with particles running along them.
  const hl = new THREE.Group();
  scene.add(hl);
  let flows = [],
    pgeo = null;
  const pmat = new THREE.PointsMaterial({
    size: 1.3,
    map: dotTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  function highlight(i, posOf) {
    hl.clear();
    flows = [];
    pgeo = null;
    if (i == null) return;
    const add = (a, b, c) => {
      const A = posOf(a),
        B = posOf(b),
        mid = A.clone().add(B).multiplyScalar(0.5);
      mid.y += 6 + A.distanceTo(B) * 0.3;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      flows.push({ curve, col: new THREE.Color(c), off: Math.random() });
      hl.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)),
          new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.55 }),
        ),
      );
    };
    host.data
      .out()
      [i].slice(0, 400)
      .forEach(t => add(i, t, '#ffd66b'));
    host.data
      .inc()
      [i].slice(0, 400)
      .forEach(s => add(s, i, '#7cc4ff'));
    pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(flows.length * 9), 3));
    pgeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(flows.length * 9), 3));
    hl.add(new THREE.Points(pgeo, pmat));
  }
  // Labels live in a label layer (sprites facing the viewer); the kit only forwards the definitions.
  const setLabels = list => labels.setLabels(list);
  const addLabels = (list, xf, gate) => labels.addLabels(list, xf, gate);

  // Overlays: scenes in their own frame (a landed planet). In XR they become part of the model (overlay layer).
  const onFrame = [],
    beforeCamera = [],
    afterCamera = [],
    overlays = new Set();
  let stopped = false,
    lastFrame = null;
  const v = new THREE.Vector3(),
    t0 = performance.now(),
    fT = new THREE.Vector3(),
    fC = new THREE.Vector3();
  // One frame of the scene, called by GalaxySystem.update with the frame time in milliseconds.
  function tick(now) {
    if (stopped) return;
    const dt = lastFrame == null ? 0 : Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    controls.dampingFactor = dampingBlend(dt, 0.12);
    const t = (now - t0) / 1000;
    frames.run(onFrame, t);
    // Follow a moving selection by carrying the camera along with it (the target may sit anywhere relative to the body).
    // Runs before the flight step: a flight in the body's frame already tracks it.
    if (follow && following && pinned != null) {
      const p = posOfSel(pinned);
      if (!flight && followPrev) {
        v.subVectors(p, followPrev);
        camera.position.add(v);
        controls.target.add(v);
      }
      followPrev = p.clone();
    } else followPrev = null;
    frames.run(beforeCamera, t, 'camera animation');
    if (flight) {
      const dt = flight.last == null ? 0 : Math.max(0, Math.min(0.05, (now - flight.last) / 1000));
      flight.last = now;
      flight.elapsed += dt * 1000;
      const k = Math.min(1, flight.elapsed / flight.duration),
        e = k * k * k * (k * (k * 6 - 15) + 10);
      if (flight.arc) {
        // interpolate direction and height separately so the path stays above the surface
        const sw = (a, b, turn, out) => {
          const la = a.length(),
            lb = b.length();
          if (la < 1e-6 || lb < 1e-6) return out.lerpVectors(a, b, e);
          return out
            .copy(a)
            .divideScalar(la)
            .applyQuaternion(new THREE.Quaternion().slerp(turn, e))
            .multiplyScalar(la + (lb - la) * e);
        };
        sw(flight.fromT, flight.toT, flight.turnT, fT);
        sw(flight.fromC, flight.toC, flight.turnC, fC);
      } else {
        fT.lerpVectors(flight.fromT, flight.toT, e);
        fC.lerpVectors(flight.fromC, flight.toC, e);
      }
      // Preserve motion when preparation completes during an approach, then ease it out.
      const carry = (k * Math.pow(1 - k, 3) * (1 + 3 * k) * flight.duration) / 1000;
      fT.addScaledVector(flight.initialT, carry);
      fC.addScaledVector(flight.initialC, carry);
      if (flight.arc) {
        const floor = Math.min(flight.fromC.length(), flight.toC.length());
        if (fC.length() < floor) fC.setLength(floor);
      }
      if (dt && flight.sampleC) {
        flight.velocityC.copy(fC).sub(flight.sampleC).divideScalar(dt);
        flight.velocityT.copy(fT).sub(flight.sampleT).divideScalar(dt);
      }
      flight.sampleC = fC.clone();
      flight.sampleT = fT.clone();
      if (flight.frame) {
        const f = flight.frame();
        fT.multiplyScalar(f.scale).add(f.origin);
        fC.multiplyScalar(f.scale).add(f.origin);
      }
      controls.target.copy(fT);
      camera.position.copy(fC);
      if (k === 1) flight = null;
    }
    controls.update();
    camera.updateMatrixWorld();
    frames.run(afterCamera, t, 'camera animation');
    if (pinned != null) {
      marker.visible = !markerHidden;
      marker.position.copy(posOfSel(pinned));
      const d = camera.position.distanceTo(marker.position);
      marker.scale.setScalar(d * 0.045 * (1 + 0.12 * Math.sin(t * 5)));
    }
    if (pending) updatePick();
    if (pgeo) {
      const P = pgeo.attributes.position,
        Cc = pgeo.attributes.color;
      flows.forEach((f, k) => {
        for (let m = 0; m < 3; m++) {
          const p = f.curve.getPoint((t * 0.45 + f.off + m / 3) % 1);
          P.setXYZ(k * 3 + m, p.x, p.y, p.z);
          Cc.setXYZ(k * 3 + m, f.col.r, f.col.g, f.col.b);
        }
      });
      P.needsUpdate = true;
      Cc.needsUpdate = true;
    }
    overlays.forEach(o => o.sync());
    overlayLayer.update(overlays);
  }

  const uploadedTextures = new WeakMap();
  return {
    scene,
    camera,
    /** The galaxy's sky, for the room's background. */
    sky: sky.texture,
    /** Image-based lighting made from the sky, for the room's environment. */
    environment: environment.texture,
    /** The table anchor this kit was created for (read by the galaxy system). */
    anchor,
    async prepareTexture(texture) {
      renderer.initTexture(texture);
      uploadedTextures.set(texture, texture.version);
    },
    async prepareDraw(object, camera, target, checkpoint) {
      const textures = new Set();
      object.traverse(o => {
        for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      });
      for (const texture of textures) {
        if (uploadedTextures.get(texture) === texture.version) continue;
        await checkpoint(true);
        if (stopped) return;
        renderer.initTexture(texture);
        uploadedTextures.set(texture, texture.version);
      }
      await checkpoint();
      await renderer.compileAsync(object, camera, target);
      await checkpoint();
    },
    highlight,
    setLabels,
    addLabels,
    onFrame,
    beforeCamera,
    afterCamera,
    select,
    controls,
    navigation,
    // A pinch is always a selection: orbiting is a separate gesture (ManipulationSystem).
    isSelectionClick: () => true,
    flyTo,
    bodyFrame,
    runFrameCallbacks: frames.run,
    frameErrors: frames.errors,
    addPicker: p => {
      pickers.push(p);
      return () => pickers.splice(pickers.indexOf(p), 1);
    },
    // Stage pixels have no meaning in a headset.
    anchorOf: () => null,
    addOverlay: o => {
      overlays.add(o);
      return () => overlays.delete(o);
    },
    clearControlMotion,
    interruptNavigation,
    get navigationRevision() {
      return navigationRevision;
    },
    cancelFlight: () => {
      flight = null;
    },
    get flying() {
      return !!flight;
    },
    setFollowing: on => {
      following = on;
      followPrev = null;
    },
    get following() {
      return following;
    },
    setMarkerHidden: on => {
      markerHidden = on;
      marker.visible = pinned != null && !on;
    },
    setPickBlock: f => {
      pickBlock = f;
      blocked = false;
    },
    resize() {},
    get pinned() {
      return pinned;
    },
    setTint: f => {
      tint = f;
    },
    // mesh may be one InstancedMesh (map: instanceId -> file) or an array (map: raycast hit -> file).
    setPick: (mesh, map, posOf, opts = {}) => {
      pickMesh = Array.isArray(mesh) ? mesh : [mesh];
      pickMap = Array.isArray(mesh) ? map : hit => map(hit.instanceId);
      posOfSel = posOf;
      customHighlight = opts.highlight || null;
      follow = !!opts.follow;
      flyDist = opts.flyDist || 42;
      onPick = id => {
        host.actions.showHover(id == null ? null : host.data.nodes()[id]);
        (customHighlight || highlight)(id ?? pinned, posOf);
      };
    },
    // XR additions.
    tick,
    pointerMove,
    pointerLeave,
    pointerClick,
    /** The virtual camera as plain arrays, for tablePose (src/core/table-frame.ts). */
    virtual: () => ({
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      up: [camera.up.x, camera.up.y, camera.up.z],
      fovDegrees: camera.fov,
    }),
    /** Whether the ray is over something the scene picks (a body or another clickable). */
    get pointing() {
      return hasRay && (lastPick !== -1 || !!hoverItem);
    },
    /** Swallow the click that ends the current drag (true), or stop swallowing (false). */
    swallowClick(on) {
      swallowClick = on;
    },
    orbit(dAzimuth, dPolar) {
      interruptNavigation();
      const next = applyOrbit(this.virtual(), dAzimuth, dPolar);
      camera.position.set(...next.position);
      controls.update();
    },
    dolly(factor) {
      interruptNavigation('zoom');
      const next = applyDolly(this.virtual(), factor, controls.minDistance, MAX_DISTANCE);
      camera.position.set(...next.position);
      controls.update();
    },
    home() {
      interruptNavigation();
      goHome();
    },
    stop: () => {
      stopped = true;
      navigation.stop();
      controls.dispose();
      environment.dispose();
      sky.dispose();
      ringTex.dispose();
      marker.material.dispose();
      pmat.dispose();
    },
  };
}
