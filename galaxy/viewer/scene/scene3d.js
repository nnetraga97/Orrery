// The three.js scaffolding every 3D view runs in: renderer, camera and controls, picking, selection marker,
// camera flights, labels and detail overlays drawn over the main scene.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLOR, legacyIntensity, configureRenderer } from './color-space.js';
import { GalaxyFrameLoop } from './frame-loop.js';
import { GalaxySky } from './galaxy-sky.js';
import { dotTex } from './textures.js';
import { cameraInput, dampingBlend } from './camera-input.js';
import { pickScene } from './scene-picking.js';

export const size = host => {
  const { width, height } = host.stage.viewport.get();
  return [width, height];
};

export function scene3D(camPos, { space = false } = {}, host) {
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
  host.stage.viewport.refresh();
  const [width, height] = size(host),
    w = Math.max(1, width),
    h = Math.max(1, height);
  const renderer = configureRenderer(new THREE.WebGLRenderer({ antialias: true }));
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(w, h);
  host.stage.element.insertBefore(renderer.domElement, host.dom('labels'));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b14');
  scene.fog = new THREE.Fog('#070b14', 260, 620);
  const sky = GalaxySky.create(renderer);
  if (space) scene.background = sky.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let environment;
  try {
    environment = pmrem.fromCubemap(sky.texture);
  } finally {
    pmrem.dispose();
  }
  scene.environment = environment.texture;
  scene.environmentIntensity = COLOR.environmentIntensity;
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.5, 3000);
  camera.position.set(...camPos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#a9c0ff', '#0a0f1c', legacyIntensity(COLOR.hemisphereIntensity)));
  const sun = new THREE.DirectionalLight('#ffffff', legacyIntensity(COLOR.directionalIntensity));
  sun.position.set(80, 160, 60);
  scene.add(sun);

  // Hover picking on an InstancedMesh (instanceId -> file index), at most one raycast per frame.
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let pickMesh = null,
    pickMap = null,
    onPick = () => {},
    pending = false,
    lastPick = -1,
    pickBlock = null,
    blocked = false;
  // Other clickable things (black holes, ships, lanes, the cannon…): { objects() -> Object3D[], describe(hit) -> context-window spec | null }.
  const pickers = [];
  let hoverItem = null;
  const pointerPosition = ev => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, (-(ev.clientY - r.top) / r.height) * 2 + 1);
  };
  function updatePick() {
    pending = false;
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    ray.setFromCamera(mouse, camera);
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
    renderer.domElement.style.cursor = id !== -1 || item ? 'pointer' : '';
  }
  renderer.domElement.addEventListener('pointermove', ev => {
    pointerPosition(ev);
    pending = true;
  });
  renderer.domElement.addEventListener('mouseleave', () => {
    if (lastPick !== -1) {
      lastPick = -1;
      onPick(null);
    }
    if (hoverItem) {
      hoverItem = null;
      host.windows.context.hover(null);
    }
  });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!navigation.isSelectionClick(ev)) return;
    // A fast click, touch, or moving camera may not have produced a hover frame.
    pointerPosition(ev);
    updatePick();
    if (blocked) return;
    if (lastPick === -1 && hoverItem) {
      if (hoverItem.onClick) hoverItem.onClick();
      else host.windows.context.pin(hoverItem);
      return;
    }
    if (lastPick === -1) host.windows.context.close();
    host.actions.selectFile(lastPick === -1 ? null : lastPick, { fly: lastPick !== -1 });
  });

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
    home: () => {
      interruptNavigation();
      following = false;
      const home = host.overview();
      flyTo(home?.target || new THREE.Vector3(), 0, { cam: home?.position || new THREE.Vector3(...camPos) });
    },
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
  const labelsEl = host.dom('labels');
  const obstacles = host.stage.createObstacles();
  let labels = [];
  const labelByElement = new WeakMap();
  const labelObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const label = labelByElement.get(entry.target),
        box = entry.borderBoxSize[0];
      if (label && box?.inlineSize && box.blockSize) {
        label.width = box.inlineSize;
        label.height = box.blockSize;
      }
    }
  });
  // Fixed labels place first; among the rest, a higher definition.priority claims space first (stable otherwise).
  const orderLabels = () =>
    labels.sort(
      (a, b) =>
        Number(!!a.avoidOverlap) - Number(!!b.avoidOverlap) ||
        (b.definition.priority || 0) - (a.definition.priority || 0),
    );
  const makeLabel = (definition, xf, gate) => {
    const { text, pos, col, cls, visible, avoidOverlap, action } = definition;
    const el = document.createElement('div');
    el.style.color = col;
    el.style.left = el.style.top = '0px';
    if (cls) el.className = cls;
    // The page's style puts a label above its point, centred across it; a centred label sits on the point instead.
    if (definition.centered) el.classList.add('label-centered');
    // A label that matters more is written larger.
    if (definition.scale && definition.scale !== 1) el.style.fontSize = `${definition.scale}em`;
    let textEl = el,
      button = null;
    if (action) {
      // { label(), title, onClick } renders a small button after the text
      textEl = document.createElement('span');
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'label-action';
      button.title = action.title || '';
      button.onclick = e => {
        e.stopPropagation();
        action.onClick();
      };
      el.append(textEl, button);
    }
    textEl.textContent = text;
    // A label with onClick is a control in the world (a frame card); the label layer otherwise ignores the pointer.
    if (definition.onClick) {
      el.classList.add('label-clickable');
      el.onclick = e => {
        e.stopPropagation();
        definition.onClick();
      };
    }
    labelsEl.appendChild(el);
    const label = { el, textEl, button, pos, visible, avoidOverlap, definition, xf, gate, width: 0, height: 0 };
    labelByElement.set(el, label);
    labelObserver.observe(el);
    return label;
  };
  function setLabels(list) {
    labelObserver.disconnect();
    labelsEl.innerHTML = '';
    labels = list.map(d => makeLabel(d));
    orderLabels();
  }
  // Extra labels whose pos may be a function (for things that move); xf maps pos into world space and gate() can hide the
  // whole batch. Returns a remover.
  function addLabels(list, xf, gate) {
    const made = list.map(d => makeLabel(d, xf, gate));
    labels.push(...made);
    orderLabels();
    return () => {
      made.forEach(l => {
        labelObserver.unobserve(l.el);
        l.el.remove();
      });
      labels = labels.filter(l => !made.includes(l));
    };
  }
  // Overlays: scenes in their own frame (a planet close-up), drawn over the main scene with their own camera.
  const onFrame = [],
    beforeCamera = [],
    afterCamera = [],
    overlays = new Set();
  let raf = 0,
    stopped = false,
    failed = false,
    lastFrame = performance.now();
  let fpsSince = lastFrame,
    fpsFrames = 0;
  const resetFps = () => {
    fpsSince = performance.now();
    fpsFrames = 0;
    const counter = host.dom('sceneFps');
    if (counter) counter.textContent = '— FPS';
  };
  const v = new THREE.Vector3(),
    t0 = performance.now(),
    fT = new THREE.Vector3(),
    fC = new THREE.Vector3();
  let viewportW = w,
    viewportH = h;
  const resize = () => {
    const [width, height] = size(host);
    if (!width || !height || (width === viewportW && height === viewportH)) return;
    viewportW = width;
    viewportH = height;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  // Composite the detail as one layer. Fading individual opaque materials exposes back faces.
  const detailTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, type: THREE.HalfFloatType });
  // Linear HDR until the blend pass applies AgX and sRGB once.
  detailTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  detailTarget.samples = Math.min(4, renderer.capabilities.maxSamples || 0);
  const blendScene = new THREE.Scene(),
    blendCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blendMaterial = new THREE.ShaderMaterial({
    uniforms: { image: { value: detailTarget.texture }, amount: { value: 1 } },
    vertexShader: 'varying vec2 uv0; void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D image; uniform float amount; varying vec2 uv0;
      void main(){
        vec4 sampleColor = texture2D(image, uv0);
        // Render-target RGB is premultiplied; use straight colour for the output transform and normal blending.
        gl_FragColor = vec4(sampleColor.a > 0.0 ? sampleColor.rgb / sampleColor.a : vec3(0.0), sampleColor.a * amount);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const blendQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMaterial);
  blendScene.add(blendQuad);
  const clearColor = new THREE.Color();
  const setDepthRange = (cam, near, far) => {
    if (cam.near === near && cam.far === far) return;
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  };
  const drawFrame = now => {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    controls.dampingFactor = dampingBlend(dt, 0.12);
    resize();
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
    resize();
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
    // Bodies drawn in their own frame (a landed planet) share the main depth buffer. Each one's camera is the main
    // camera expressed in that frame (translation and uniform scale), so with near and far divided by the same scale
    // their depths agree with the main scene's and ships, moons and towns occlude one another correctly. Close to a
    // surface the depth range is split into a far and a near slice, each with its own precision.
    const bodies = [...overlays].filter(o => o.sharedDepth && o.opacity > 0);
    const near0 = camera.near,
      far0 = camera.far,
      nearest = bodies.length ? Math.min(...bodies.map(o => o.nearWorld())) : near0;
    const slices =
      nearest < near0
        ? [
            [near0, far0],
            [nearest, near0 * 1.0001],
          ]
        : [[near0, far0]];
    const background = scene.background;
    renderer.autoClear = false;
    renderer.clear();
    slices.forEach(([near, far], slice) => {
      if (slice) {
        renderer.clearDepth();
        scene.background = null; // the far slice already drew the sky
      }
      setDepthRange(camera, near, far);
      renderer.render(scene, camera);
      for (const o of bodies) {
        const scale = o.frame().scale;
        setDepthRange(o.camera, near / scale, far / scale);
        renderer.render(o.scene, o.camera);
      }
    });
    scene.background = background;
    setDepthRange(camera, near0, far0);
    renderer.autoClear = true;
    const insets = [...overlays].filter(o => !o.sharedDepth);
    if (insets.length) {
      const pixelRatio = renderer.getPixelRatio(),
        rw = Math.round(viewportW * pixelRatio),
        rh = Math.round(viewportH * pixelRatio);
      if (detailTarget.width !== rw || detailTarget.height !== rh) detailTarget.setSize(rw, rh);
      insets.forEach(o => {
        if (o.opacity <= 0) return;
        if (o.opacity >= 1) {
          const rect = o.viewport;
          if (rect) {
            renderer.setViewport(rect.x, viewportH - rect.y - rect.height, rect.width, rect.height);
            renderer.setScissor(rect.x, viewportH - rect.y - rect.height, rect.width, rect.height);
            renderer.setScissorTest(true);
          }
          renderer.autoClear = false;
          renderer.clearDepth();
          renderer.render(o.scene, o.camera);
          renderer.autoClear = true;
          if (rect) {
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, viewportW, viewportH);
          }
          return;
        }
        const alpha = renderer.getClearAlpha();
        renderer.getClearColor(clearColor);
        renderer.setRenderTarget(detailTarget);
        renderer.setClearColor(0, 0);
        renderer.render(o.scene, o.camera);
        renderer.setRenderTarget(null);
        renderer.setClearColor(clearColor, alpha);
        blendMaterial.uniforms.amount.value = o.opacity ?? 1;
        renderer.autoClear = false;
        renderer.render(blendScene, blendCamera);
        renderer.autoClear = true;
      });
    }
    host.windows.context.place();
    const [W, H] = size(host);
    // Prepare every changed label before reading any sizes; hidden labels keep their cached dimensions.
    const measuring = [];
    for (const l of labels) {
      // Hidden retained town labels need neither source rebasing nor projection/DOM work on an edit frame.
      l.candidate = false;
      if ((l.gate && !l.gate()) || (l.visible && !l.visible())) continue;
      if (l.textEl.textContent !== l.definition.text) {
        l.textEl.textContent = l.definition.text;
        l.width = l.height = 0;
      }
      if (l.button) {
        const text = l.definition.action.label();
        if (l.button.textContent !== text) {
          l.button.textContent = text;
          l.width = l.height = 0;
        }
      }
      v.copy(typeof l.pos === 'function' ? l.pos() : l.pos);
      if (l.xf) l.xf(v);
      // A label that names a body sits just above it: lifted by the body's radius as drawn, plus a little air.
      l.lift = l.definition.clear
        ? ((l.definition.clear / Math.max(1e-6, v.distanceTo(camera.position) * Math.tan((camera.fov * Math.PI) / 360))) * H) / 2 + 4
        : 0;
      v.project(camera);
      l.candidate = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      l.x = ((v.x + 1) / 2) * W;
      l.y = ((1 - v.y) / 2) * H;
      if (l.candidate && (!l.width || !l.height)) {
        l.el.style.display = '';
        measuring.push(l);
      }
    }
    for (const l of measuring) {
      l.width = l.el.offsetWidth;
      l.height = l.el.offsetHeight;
    }
    const occupiedLabels = [];
    const groupCounts = new Map();
    // Surface annotations yield to fixed controls and inspectors as well as other labels.
    if (document.body.classList.contains('planet-mode')) {
      obstacles.appendTo(occupiedLabels);
    }
    // Keep method/debug labels first; neighbourhood labels yield when their text would overlap.
    labels.forEach(l => {
      let vis = l.candidate;
      const group = l.definition.group;
      if (group && (groupCounts.get(group) || 0) >= (l.definition.maxVisible ?? Infinity)) vis = false;
      if (vis) {
        const { x } = l,
          y = l.y - l.lift;
        const top = l.definition.centered ? y - l.height / 2 : y - l.height;
        const box = { x0: x - l.width / 2 - 3, x1: x + l.width / 2 + 3, y0: top - 3, y1: top + l.height + 3 };
        if (
          l.avoidOverlap &&
          (box.x0 < 8 ||
            box.x1 > W - 8 ||
            box.y0 < 8 ||
            box.y1 > H - 8 ||
            occupiedLabels.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0))
        )
          vis = false;
        else {
          if (group) groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
          occupiedLabels.push(box);
          // Individual translate preserves the CSS transform that centers each label.
          const translate = `${x}px ${y}px`;
          if (l.el.style.translate !== translate) l.el.style.translate = translate;
        }
      }
      const display = vis ? '' : 'none';
      if (l.el.style.display !== display) l.el.style.display = display;
    });
  };
  const loop = now => {
    raf = 0;
    if (stopped || !host.stage.viewport.get().visible) return;
    try {
      drawFrame(now);
      if (!document.hidden) {
        fpsFrames++;
        if (now - fpsSince >= 1000) {
          const counter = host.dom('sceneFps');
          if (counter) counter.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} FPS`;
          fpsSince = now;
          fpsFrames = 0;
        }
      }
      raf = requestAnimationFrame(loop);
    } catch (error) {
      failed = true;
      frames.report(error, 'scene');
    }
  };
  const syncVisibility = () => {
    if (!host.stage.viewport.get().visible) {
      cancelAnimationFrame(raf);
      raf = 0;
      resetFps();
    } else if (!raf && !stopped && !failed) {
      lastFrame = performance.now();
      if (flight) flight.last = null;
      resetFps();
      raf = requestAnimationFrame(loop);
    }
  };
  const unsubscribeViewport = host.stage.viewport.subscribe(syncVisibility);
  syncVisibility();
  const anchorV = new THREE.Vector3();
  const uploadedTextures = new WeakMap();
  const uploadedBuffers = new WeakSet();
  const bufferMaterial = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false });
  let uploadQueue = Promise.resolve();
  const uploadGPU = (upload, checkpoint) => {
    const task = uploadQueue.then(async () => {
      await checkpoint(true);
      if (!stopped) return upload();
    });
    uploadQueue = task.catch(() => {});
    return task;
  };
  return {
    scene,
    camera,
    async prepareTexture(texture) {
      await uploadGPU(
        () => {
          renderer.initTexture(texture);
          uploadedTextures.set(texture, texture.version);
        },
        () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))),
      );
    },
    async prepareDraw(object, camera, target, checkpoint) {
      const textures = new Set();
      object.traverse(o => {
        for (const material of Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      });
      for (const texture of textures) {
        if (uploadedTextures.get(texture) === texture.version) continue;
        await uploadGPU(() => {
          if (uploadedTextures.get(texture) === texture.version) return;
          renderer.initTexture(texture);
          uploadedTextures.set(texture, texture.version);
        }, checkpoint);
      }
      await checkpoint();
      await renderer.compileAsync(object, camera, target);
      await checkpoint();
      // compileAsync prepares programs, not vertex/index/instance buffers. Warm
      // those in bounded draws with zero raster area, using the real screen's
      // shader/output configuration. No pixels or render state escape this pass.
      const staging = new THREE.Scene();
      staging.environment = target.environment;
      staging.environmentIntensity = target.environmentIntensity;
      staging.environmentRotation.copy(target.environmentRotation);
      staging.fog = target.fog;
      for (const light of target.children.filter(o => o.isLight)) staging.add(light.clone());
      const warm = clone => {
        staging.add(clone);
        const previousTarget = renderer.getRenderTarget(),
          viewport = renderer.getViewport(new THREE.Vector4()),
          scissor = renderer.getScissor(new THREE.Vector4()),
          scissorTest = renderer.getScissorTest(),
          autoClear = renderer.autoClear;
        try {
          renderer.setRenderTarget(null);
          renderer.setViewport(0, 0, 1, 1);
          renderer.setScissor(0, 0, 0, 0);
          renderer.setScissorTest(true);
          renderer.autoClear = false;
          renderer.render(staging, camera);
        } finally {
          renderer.setRenderTarget(previousTarget);
          renderer.setViewport(viewport);
          renderer.setScissor(scissor);
          renderer.setScissorTest(scissorTest);
          renderer.autoClear = autoClear;
          staging.remove(clone);
        }
      };
      const meshes = [];
      object.traverse(o => {
        if (o.isMesh) meshes.push(o);
      });
      for (const mesh of meshes) {
        // Instances can share geometry but own different instance buffers and
        // materials. Each production mesh needs its own first-use draw.
        // A detailed planet can contain several multi-megabyte attributes.
        // Upload each large buffer on a separate frame, without changing its
        // precision, resolution, or the final geometry/attribute identities.
        for (const attribute of [...Object.values(mesh.geometry.attributes), mesh.geometry.index].filter(Boolean)) {
          const buffer = attribute.data ?? attribute;
          if (buffer.array.byteLength < 512 * 1024 || uploadedBuffers.has(buffer)) continue;
          const geometry = new THREE.BufferGeometry();
          if (attribute === mesh.geometry.index) {
            geometry.setAttribute('position', mesh.geometry.attributes.position);
            geometry.setIndex(attribute);
          } else geometry.setAttribute('position', attribute);
          geometry.setDrawRange(0, 3);
          // Non-position attributes (for example vec2 UVs) are borrowed only
          // to upload bytes. They do not define a meaningful bounding sphere.
          geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
          const upload = new THREE.Mesh(geometry, bufferMaterial);
          upload.frustumCulled = false;
          try {
            await uploadGPU(() => {
              warm(upload);
              uploadedBuffers.add(buffer);
            }, checkpoint);
          } finally {
            // This temporary view borrows the production buffers. Disposing it
            // must release its VAO, never delete the borrowed GPU attributes.
            geometry.attributes = {};
            geometry.index = null;
            geometry.dispose();
          }
        }
        await checkpoint();
        if (stopped) return;
        mesh.updateWorldMatrix(true, false);
        const clone = mesh.clone(false);
        clone.matrixAutoUpdate = false;
        clone.matrix.copy(mesh.matrixWorld);
        clone.visible = true;
        clone.frustumCulled = false;
        const privateMatrix = clone.instanceMatrix,
          privateColor = clone.instanceColor;
        if (mesh.isInstancedMesh) {
          clone.instanceMatrix = mesh.instanceMatrix;
          clone.instanceColor = mesh.instanceColor;
          clone.count = Math.min(1, mesh.instanceMatrix.count);
        }
        try {
          warm(clone);
        } finally {
          if (mesh.isInstancedMesh) {
            // Release this temporary object's VAO without deleting the shared
            // production instance buffers that were just uploaded.
            clone.instanceMatrix = privateMatrix;
            clone.instanceColor = privateColor;
            clone.dispose();
          }
        }
        await checkpoint();
      }
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
    isSelectionClick: navigation.isSelectionClick,
    flyTo,
    bodyFrame,
    runFrameCallbacks: frames.run,
    frameErrors: frames.errors,
    addPicker: p => {
      pickers.push(p);
      return () => pickers.splice(pickers.indexOf(p), 1);
    },
    // Stage pixels of file i (for context windows that follow a moving body).
    anchorOf: i => {
      if (!posOfSel) return null;
      anchorV.copy(posOfSel(i)).project(camera);
      const [W, H] = size(host);
      return anchorV.z > 1 ? null : { x: ((anchorV.x + 1) / 2) * W, y: ((1 - anchorV.y) / 2) * H };
    },
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
    resize,
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
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      unsubscribeViewport();
      labelObserver.disconnect();
      obstacles.dispose();
      resetFps();
      navigation.stop();
      controls.dispose();
      detailTarget.dispose();
      bufferMaterial.dispose();
      blendQuad.geometry.dispose();
      blendMaterial.dispose();
      environment.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelsEl.innerHTML = '';
    },
  };
}

export function instanced(count, geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}
export const dummy = new THREE.Object3D();
export const groupLabels = (centerOf, lift = 0, host) =>
  host.data
    .groups()
    .slice(0, 30)
    .map((g, k) => ({
      text: g,
      col: host.graph.color(g),
      pos: centerOf(k)
        .clone()
        .add(new THREE.Vector3(0, typeof lift === 'function' ? lift(k) : lift, 0)),
    }));
