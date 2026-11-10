import { MOUSE } from 'three';

// Normalize mouse wheels, line/page scrolling and Chromium's ctrl-wheel pinch.
export function wheelPixels(event, height) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit * (event.ctrlKey ? 10 : 1) };
}

export const dampingBlend = (dt, factor) => 1 - Math.pow(1 - factor, Math.max(0, dt) * 60);

export const wheelAction = (event, device) =>
  event.ctrlKey ? 'zoom' : device === 'trackpad' ? (event.shiftKey ? 'orbit' : 'pan') : event.shiftKey ? 'pan' : 'zoom';

// Judge the whole gesture, including travel away and back and multiple fingers.
export class SelectionGesture {
  pointers = new Set();
  candidate = null;
  start(e) {
    this.pointers.add(e.pointerId);
    this.candidate =
      this.pointers.size === 1 && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        ? { id: e.pointerId, x: e.clientX, y: e.clientY }
        : null;
  }
  move(e) {
    const c = this.candidate;
    if (c?.id === e.pointerId && Math.hypot(e.clientX - c.x, e.clientY - c.y) > 4) this.candidate = null;
  }
  end(e) {
    this.move(e);
    const click = e.button === 0 && this.candidate?.id === e.pointerId;
    this.pointers.delete(e.pointerId);
    this.candidate = null;
    return !!click;
  }
  cancel() {
    this.pointers.clear();
    this.candidate = null;
  }
}

function selectionClicks(canvas, options, clearZoom) {
  const gesture = new SelectionGesture(),
    capture = { ...options, capture: true };
  let clicked = null;
  canvas.addEventListener(
    'pointerdown',
    e => {
      canvas.focus({ preventScroll: true });
      gesture.start(e);
    },
    capture,
  );
  canvas.addEventListener('pointermove', e => gesture.move(e), capture);
  canvas.addEventListener(
    'pointerup',
    e => {
      clicked = gesture.end(e) ? e : null;
    },
    capture,
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      gesture.cancel();
      clicked = null;
    },
    capture,
  );
  canvas.addEventListener('lostpointercapture', () => gesture.cancel(), options);
  window.addEventListener(
    'blur',
    () => {
      gesture.cancel();
      clicked = null;
      clearZoom();
    },
    options,
  );
  return e => clicked === e;
}

function bindWheel(controls, { navigate, zoom, hasCustomZoom, device }, options) {
  const canvas = controls.domElement;
  canvas.addEventListener(
    'wheel',
    e => {
      if (!controls.enabled) return;
      const { x, y } = wheelPixels(e, canvas.clientHeight);
      const action = wheelAction(e, device());
      if (action !== 'zoom') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!x && !y) return;
        navigate(action);
        if (action === 'orbit') {
          const scale = (Math.PI * 2 * controls.rotateSpeed) / Math.max(1, canvas.clientHeight);
          controls._rotateLeft(-x * scale);
          controls._rotateUp(-y * scale);
        } else if (device() === 'trackpad') controls._pan(-x, -y);
        else controls._pan(x || y, x ? y : 0);
        // OrbitControls' public pan/rotate also update at once, which stepped the camera twice on every event frame,
        // so scrolling moved in bursts. Queue the motion only: the frame loop's damped update spreads it evenly.
      } else if (hasCustomZoom()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (y) zoom(Math.max(-0.6, Math.min(0.6, y * 0.002)), e.clientX, e.clientY);
      }
    },
    { ...options, capture: true, passive: false },
  );
}

function bindKeyboard(controls, { navigate, home, focus, zoomAtCenter }, options) {
  const canvas = controls.domElement;
  canvas.addEventListener(
    'keydown',
    e => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || !controls.enabled) return;
      const directions = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 24], ArrowDown: [0, -24] };
      const d = directions[e.key];
      if (d) {
        navigate(e.shiftKey ? 'orbit' : 'pan');
        if (e.shiftKey) {
          controls._rotateLeft(d[0] * 0.002);
          controls._rotateUp(d[1] * 0.002);
        } else controls._pan(...d);
      } else if (e.key === 'Home') home();
      else if (e.key.toLowerCase() === 'f') focus();
      else if (e.key === '+' || e.key === '=') zoomAtCenter(-0.25);
      else if (e.key === '-' || e.key === '_') zoomAtCenter(0.25);
      else return;
      e.preventDefault();
    },
    options,
  );
}

function cameraMenu(controls, { navigate, home, focus, canFocus, zoomAtCenter, inputDevice, rememberDevice }, options) {
  const ui = document.getElementById('cameraOptions'),
    mode = document.getElementById('cameraDragMode');
  const applyMode = () => {
    controls.mouseButtons.LEFT = mode.value === 'pan' ? MOUSE.PAN : MOUSE.ROTATE;
  };
  applyMode();
  mode.addEventListener(
    'change',
    () => {
      navigate('mode');
      applyMode();
    },
    options,
  );
  ui.hidden = false;
  const device = document.getElementById('cameraInputDevice');
  device.value = inputDevice === 'mouse' ? 'mouse' : 'trackpad';
  document.getElementById('trackpadHelp').hidden = device.value !== 'trackpad';
  document.getElementById('mouseHelp').hidden = device.value !== 'mouse';
  device.addEventListener(
    'change',
    () => {
      navigate('device');
      rememberDevice(device.value);
      document.getElementById('trackpadHelp').hidden = device.value !== 'trackpad';
      document.getElementById('mouseHelp').hidden = device.value !== 'mouse';
    },
    options,
  );
  const focusButton = document.getElementById('cameraFocus');
  const updateSelection = () => {
    focusButton.disabled = !canFocus();
  };
  updateSelection();
  for (const [id, run] of [
    ['cameraHome', home],
    ['cameraFocus', focus],
    ['cameraZoomIn', () => zoomAtCenter(-0.25)],
    ['cameraZoomOut', () => zoomAtCenter(0.25)],
  ])
    document.getElementById(id).addEventListener('click', run, options);
  return {
    updateSelection,
    hide: () => {
      ui.hidden = true;
    },
  };
}

export function cameraInput(
  controls,
  { navigate, home, focus, canFocus, inputDevice = 'trackpad', rememberDevice = () => {} },
) {
  const canvas = controls.domElement,
    abort = new AbortController(),
    options = { signal: abort.signal };
  let zoomHandler = null,
    cancelZoom = () => {};
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    '3D scene. Drag to orbit or pan; Shift switches modes. Home fits the view, F focuses selection.',
  );
  controls.enableDamping = true;
  controls.rotateSpeed = 0.65;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.minDistance = 0.5;
  function zoom(step, x, y) {
    navigate('zoom');
    if (zoomHandler) zoomHandler(step, x, y);
    else {
      controls.dollyIn(Math.exp(step));
      controls.update();
    }
  }
  const zoomAtCenter = step => {
    const r = canvas.getBoundingClientRect();
    zoom(step, r.left + r.width / 2, r.top + r.height / 2);
  };
  const isSelectionClick = selectionClicks(canvas, options, () => cancelZoom());
  bindWheel(
    controls,
    {
      navigate,
      zoom,
      hasCustomZoom: () => !!zoomHandler,
      device: () => document.getElementById('cameraInputDevice').value,
    },
    options,
  );
  bindKeyboard(controls, { navigate, home, focus, zoomAtCenter }, options);
  const menu = cameraMenu(
    controls,
    { navigate, home, focus, canFocus, zoomAtCenter, inputDevice, rememberDevice },
    options,
  );
  return {
    isSelectionClick,
    updateSelection: menu.updateSelection,
    setZoomHandler: (handler, cancel) => {
      zoomHandler = handler;
      cancelZoom = cancel;
    },
    clearZoom: () => cancelZoom(),
    stop: () => {
      abort.abort();
      menu.hide();
      cancelZoom();
    },
  };
}
