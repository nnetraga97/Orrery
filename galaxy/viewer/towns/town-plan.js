// A second camera uses the exact packed columns, with the sphere's east/north axes kept on the page.
import * as THREE from 'three';
import { COLOR, legacyIntensity } from '../scene/color-space.js';
import { buildTowns } from './towns.js';
import { fitTownPlan, planLabelVisible, townPlanContext } from './town-plan-layout.js';

export function createTownPlan(host, towns, ctx) {
  let enabled = false,
    focusedLine = null,
    region = -1,
    revision = 0,
    build = null,
    flat = null,
    removeOverlay = null,
    disposed = false;
  const panel = document.createElement('section');
  panel.className = 'town-plan';
  panel.setAttribute('aria-label', 'Focused town plan');
  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: '8',
    display: 'none',
    border: '1px solid #8297a5',
    borderRadius: '8px',
    overflow: 'hidden',
    color: '#ecf3f5',
    pointerEvents: 'auto',
  });
  const title = document.createElement('div'),
    viewport = document.createElement('div'),
    labels = document.createElement('div');
  Object.assign(title.style, {
    background: '#192a33',
    padding: '8px 12px',
    fontSize: '12px',
    height: '32px',
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  Object.assign(viewport.style, {
    position: 'relative',
    height: 'calc(100% - 32px)',
    touchAction: 'none',
    cursor: 'grab',
  });
  viewport.tabIndex = 0;
  viewport.setAttribute(
    'aria-label',
    'Town plan. Drag or use arrow keys to pan; scroll or use plus and minus to zoom; Home fits the town.',
  );
  Object.assign(labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  viewport.append(labels);
  panel.append(title, viewport);
  document.body.append(panel);
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000),
    ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2(),
    target = new THREE.Vector3(),
    direction = new THREE.Vector3(0, 1, 0);
  camera.up.set(0, 0, -1);
  scene.background = new THREE.Color('#172a31');
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7c9bf', legacyIntensity(COLOR.planHemisphereIntensity)));
  const sun = new THREE.DirectionalLight('#ffffff', legacyIntensity(COLOR.planDirectionalIntensity));
  sun.position.set(-10, 30, 20);
  scene.add(sun);
  let span = 10,
    fitSpan = 10,
    fitWidth = 0,
    fitHeight = 0,
    drag = null,
    labelNodes = [];
  const fit = () => {
    const tw = flat?.townOf(0) || towns.townOf(region);
    if (!tw) return;
    const rect = viewport.getBoundingClientRect(),
      fitted = fitTownPlan(tw, rect.width, rect.height);
    target.set(fitted.x, 0, -fitted.y);
    span = fitSpan = fitted.span;
    fitWidth = rect.width;
    fitHeight = rect.height;
  };
  const zoom = factor => {
    span = THREE.MathUtils.clamp(span * factor, fitSpan / 30, fitSpan * 4);
  };
  viewport.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    viewport.focus();
    viewport.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    flat?.setHover(null);
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag) {
      const rect = viewport.getBoundingClientRect();
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2);
      scene.updateMatrixWorld();
      ray.setFromCamera(mouse, camera);
      const hit = flat && ray.intersectObjects(flat.pickables, true).find(hit => hit.object.visible);
      flat?.setHover(hit ? flat.pick(hit) : null);
      return;
    }
    const units = span / viewport.getBoundingClientRect().height;
    target.x -= (e.clientX - drag.x) * units;
    target.z -= (e.clientY - drag.y) * units;
    drag = { x: e.clientX, y: e.clientY };
  });
  viewport.addEventListener('pointerleave', () => flat?.setHover(null));
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    viewport.addEventListener(event, () => {
      drag = null;
    });
  viewport.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      e.stopPropagation();
      zoom(Math.exp(e.deltaY * 0.001));
    },
    { passive: false },
  );
  viewport.addEventListener('keydown', e => {
    const step = span * 0.08;
    if (e.key === 'ArrowLeft') target.x -= step;
    else if (e.key === 'ArrowRight') target.x += step;
    else if (e.key === 'ArrowUp') target.z -= step;
    else if (e.key === 'ArrowDown') target.z += step;
    else if (e.key === '+' || e.key === '=') zoom(0.8);
    else if (e.key === '-') zoom(1.25);
    else if (e.key === 'Home') fit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  const positionPanel = () => {
    const bounds = host.element.getBoundingClientRect(),
      width = Math.min(760, bounds.width * 0.66),
      height = Math.min(620, bounds.height * 0.68);
    Object.assign(panel.style, {
      left: `${bounds.left + 16}px`,
      top: `${bounds.bottom - height - 16}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    return bounds;
  };
  const overlay = {
    scene,
    camera,
    opacity: 0,
    viewport: null,
    sync() {
      overlay.opacity = enabled && flat && host.opacity > 0.6 ? 1 : 0;
      if (!enabled) return;
      panel.style.visibility = host.opacity > 0.6 ? '' : 'hidden';
      const bounds = positionPanel(),
        rect = viewport.getBoundingClientRect();
      if (rect.width !== fitWidth || rect.height !== fitHeight) {
        const zoom = fitSpan / span,
          previous = target.clone();
        fit();
        if (Math.abs(zoom - 1) > 0.01) {
          span = fitSpan / zoom;
          target.copy(previous);
        }
      }
      overlay.viewport = {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      };
      const aspect = rect.width / Math.max(1, rect.height);
      camera.left = (-span * aspect) / 2;
      camera.right = (span * aspect) / 2;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.position.copy(target).addScaledVector(direction, Math.max(30, span * 2));
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const occupied = [];
      for (const { definition, el, width, height } of labelNodes) {
        const p = (typeof definition.pos === 'function' ? definition.pos() : definition.pos).clone().project(camera),
          x = ((p.x + 1) * rect.width) / 2,
          y = ((1 - p.y) * rect.height) / 2,
          box = [x - width / 2 - 3, y - height / 2 - 3, x + width / 2 + 3, y + height / 2 + 3];
        const show =
          planLabelVisible(definition, fitSpan / span) &&
          box[0] >= 8 &&
          box[2] <= rect.width - 8 &&
          box[1] >= 8 &&
          box[3] <= rect.height - 8 &&
          !occupied.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        el.hidden = !show;
        if (show) {
          occupied.push(box);
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }
      }
    },
  };
  const tick = t => {
    if (enabled) flat?.frame(t);
  };
  host.onFrame.push(tick);
  const clear = () => {
    revision++;
    build?.abort();
    build = null;
    flat?.dispose();
    flat = null;
    removeOverlay?.();
    removeOverlay = null;
    panel.style.display = 'none';
    labels.replaceChildren();
    labelNodes = [];
  };
  async function load() {
    clear();
    if (!enabled || region < 0 || disposed) return;
    const serial = revision,
      tw = towns.townOf(region),
      r = ctx.regions[region];
    build = new AbortController();
    panel.style.display = '';
    positionPanel();
    fit();
    title.textContent = `${r.name} · Plan view · Building…`;
    try {
      const result = await buildTowns(townPlanContext(ctx, tw, region, { scene, camera }, build.signal));
      if (disposed || serial !== revision) {
        result.dispose();
        return;
      }
      flat = result;
      fit();
      flat.setFocus(0, focusedLine);
      flat.setDetailLabels(true);
      title.textContent = 'Plan view · drag to pan · scroll to zoom';
      title.title = `${r.name} · Home to fit`;
      labelNodes = flat.labels
        .filter(definition => definition.text)
        .sort((a, b) => Number(!!a.planDetail) - Number(!!b.planDetail))
        .map(definition => {
          const el = document.createElement('span');
          el.textContent = definition.text;
          Object.assign(el.style, {
            position: 'absolute',
            transform: 'translate(-50%, -50%)',
            whiteSpace: 'nowrap',
            maxWidth: '240px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: '11px',
            color: definition.col || '#fff',
            background: '#172a31df',
            padding: '1px 3px',
            borderRadius: '3px',
          });
          labels.append(el);
          return { definition, el, width: 0, height: 0 };
        });
      // Batch DOM writes before measuring, as the main scene's avoidOverlap labels do.
      for (const label of labelNodes) {
        label.width = label.el.offsetWidth;
        label.height = label.el.offsetHeight;
      }
      removeOverlay = host.addOverlay(overlay);
    } catch (error) {
      if (serial === revision && !disposed && error.name !== 'AbortError')
        title.textContent = `Plan unavailable: ${error.message}`;
    }
  }
  return {
    setEnabled(value, k) {
      enabled = value;
      region = k;
      if (enabled) void load();
      else {
        clear();
        panel.style.display = 'none';
      }
    },
    focus(k, line = null) {
      focusedLine = line;
      if (k !== region) {
        region = k;
        if (enabled) void load();
      } else flat?.setFocus(0, line);
    },
    hover(info) {
      const lot = info?.k === region && info.it ? flat?.lotForLine(0, info.it.line) : null;
      flat?.setHover(lot);
    },
    dispose() {
      disposed = true;
      enabled = false;
      clear();
      panel.remove();
      host.onFrame.splice(host.onFrame.indexOf(tick), 1);
    },
  };
}
