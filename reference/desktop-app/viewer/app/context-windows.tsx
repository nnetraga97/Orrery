// Context windows: hovering any item in the scene shows a small preview next to the pointer; clicking pins a full
// window beside the item, which follows it as it moves. Every clickable kind (file, black hole, ship, import lane,
// method, statement, spaceport, station, vehicle, cannon, drone…) describes itself with a CtxSpec. Esc, the close
// button or clicking empty space closes the pinned window.
import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Vector3 } from 'three';
import { state } from './state.ts';
import { stage, stageViewport } from './stage-viewport.ts';

export type CtxAction = {
  label: string;
  onClick: (button: HTMLButtonElement) => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
};
export type CtxSpec = {
  key: string;
  kind: string;
  title: string;
  sub?: string;
  color?: string;
  preview?: string[];
  /** The pinned window's details as React elements, rendered again on each pin and refresh. */
  content?: () => ReactNode;
  /** Older form of the details: HTML, or a function that fills the body element. */
  body?: string | ((el: HTMLElement) => void);
  actions?: CtxAction[];
  /** Stage pixels to sit beside; null keeps the last position. */
  anchor?: () => { x: number; y: number } | null;
  onClose?: () => void;
  /** A scene-click interaction instead of pinning the window. */
  onClick?: () => void;
};

type Windows = { hovered: CtxSpec | null; tip: CtxSpec | null; pinned: CtxSpec | null; builds: number };
let windows: Windows = { hovered: null, tip: null, pinned: null, builds: 0 };
const listeners = new Set<() => void>();
const store = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => windows,
};
// Changes render synchronously: callers place and read the windows right after pinning.
function set(patch: Partial<Windows>) {
  windows = { ...windows, ...patch };
  flushSync(() => listeners.forEach(fn => fn()));
  measureWindows();
  place();
  if (!windows.tip && !windows.pinned) cancelPlacement();
}

let tipEl: HTMLDivElement | null = null,
  winEl: HTMLDivElement | null = null,
  pointer = { x: -1e4, y: -1e4 },
  last: { x: number; y: number } | null = null,
  restoreScroll = 0;
const dimensions = new WeakMap<HTMLElement, { width: number; height: number }>();
const placements = new WeakMap<HTMLElement, { x0: number; x1: number; y0: number; y1: number }>();
let placementFrame = 0;
function cancelPlacement() {
  cancelAnimationFrame(placementFrame);
  placementFrame = 0;
}
function requestPlacement() {
  if (placementFrame || !stageViewport.get().visible || (!windows.tip && !windows.pinned)) return;
  placementFrame = requestAnimationFrame(() => {
    placementFrame = 0;
    place();
  });
}
function measureWindows() {
  for (const el of [tipEl, winEl]) {
    if (el && !el.hidden) dimensions.set(el, { width: el.offsetWidth, height: el.offsetHeight });
  }
}
addEventListener(
  'pointermove',
  e => {
    const { left, top } = stageViewport.get();
    pointer = { x: e.clientX - left, y: e.clientY - top };
    if (windows.tip) requestPlacement();
  },
  { passive: true },
);
addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.closest('#wbFileEditor')) return;
  if (e.key === 'Escape' && windows.pinned && !e.defaultPrevented) {
    e.preventDefault();
    close();
  }
});

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function hover(spec: CtxSpec | null) {
  set({ hovered: spec, tip: !spec || windows.pinned?.key === spec.key ? null : spec });
}
function pin(spec: CtxSpec) {
  const same = windows.pinned?.key === spec.key;
  if (windows.pinned && !same) windows.pinned.onClose?.();
  if (!same) last = spec.anchor?.() || { ...pointer };
  set({ pinned: spec, tip: null, builds: windows.builds + 1 });
  if (!same && winEl) winEl.scrollTop = 0;
}
/** silent: close without the window's onClose (e.g. landing on a planet keeps the file selected). */
function close({ silent = false } = {}) {
  const p = windows.pinned;
  set({ pinned: null });
  if (!silent) p?.onClose?.();
}
/** Renders the pinned window again (live status such as a flight in progress), keeping its scroll position. */
function refresh(key?: string) {
  if (!windows.pinned || (key && windows.pinned.key !== key)) return;
  restoreScroll = winEl?.querySelector('.ctx-body')?.scrollTop || 0;
  set({ builds: windows.builds + 1 });
}

// Keep inside the stage: to the right of the anchor, flipped left or up when there is no room.
function put(el: HTMLElement, x: number, y: number, gap: number) {
  const size = dimensions.get(el);
  if (!size) return;
  const { width: W, height: H } = stageViewport.get();
  const { width: w, height: h } = size;
  let left = x + gap,
    top = y - Math.min(40, h / 3);
  if (left + w > W - 8) left = x - gap - w;
  left = Math.max(8, Math.min(W - w - 8, left));
  top = Math.max(8, Math.min(H - h - 8, top));
  left = Math.round(left);
  top = Math.round(top);
  let bounds = placements.get(el);
  if (!bounds) {
    bounds = { x0: 0, x1: 0, y0: 0, y1: 0 };
    placements.set(el, bounds);
  }
  bounds.x0 = left;
  bounds.x1 = left + w;
  bounds.y0 = top;
  bounds.y1 = top + h;
  const transform = `translate(${left}px, ${top}px)`;
  if (el.style.transform !== transform) el.style.transform = transform;
}
function place() {
  if (!stageViewport.get().visible || (!windows.tip && !windows.pinned)) return;
  if (tipEl && !tipEl.hidden) put(tipEl, pointer.x, pointer.y + 6, 16);
  if (windows.pinned && winEl) {
    const a = windows.pinned.anchor?.();
    if (a) last = a;
    if (last) put(winEl, last.x, last.y, 26);
  }
}

function Body({ spec, builds }: { spec: CtxSpec; builds: number }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (typeof spec.body === 'function') spec.body(el.current!);
    if (restoreScroll) el.current!.scrollTop = restoreScroll;
    restoreScroll = 0;
  }, [spec, builds]);
  if (spec.content)
    return (
      <div className="ctx-body" ref={el} key={builds}>
        {spec.content()}
      </div>
    );
  if (typeof spec.body === 'string')
    return <div className="ctx-body" ref={el} key={builds} dangerouslySetInnerHTML={{ __html: spec.body }} />;
  // A function body owns this element's children; a new element each build starts it empty.
  return <div className="ctx-body" ref={el} key={builds} />;
}

function Card({ spec, full, builds }: { spec: CtxSpec; full: boolean; builds: number }) {
  const actions = full ? spec.actions || [] : [];
  return (
    <>
      <div className="ctx-head">
        <span className="ctx-kind">{spec.kind}</span>
        {full && (
          <button className="ctx-close" aria-label="Close" onClick={() => close()}>
            ✕
          </button>
        )}
      </div>
      <div className="ctx-title">{spec.title}</div>
      {spec.sub && <div className="ctx-sub">{spec.sub}</div>}
      {!!spec.preview?.length && (
        <div className="ctx-preview">
          {spec.preview.map((p, i) => (
            <div key={i}>{p}</div>
          ))}
        </div>
      )}
      {full && (spec.content || spec.body) && <Body spec={spec} builds={builds} />}
      {!!actions.length && (
        <div className="ctx-actions">
          {actions.map((a, i) => (
            <button
              key={`${builds}:${i}`}
              className={a.primary ? 'on' : undefined}
              disabled={!!a.disabled}
              title={a.title}
              onClick={e => a.onClick(e.currentTarget)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const colorStyle = (spec: CtxSpec | null) => ({ '--ctx': spec?.color || '#7cc4ff' }) as CSSProperties;

function ContextWindows() {
  const { tip, pinned, builds } = useSyncExternalStore(store.subscribe, store.get);
  return (
    <>
      <div className="ctx ctx-tip" hidden={!tip} style={colorStyle(tip)} ref={el => void (tipEl = el)}>
        {tip && <Card spec={tip} full={false} builds={builds} />}
      </div>
      <div
        className="ctx ctx-win"
        role="dialog"
        hidden={!pinned}
        style={colorStyle(pinned)}
        ref={el => void (winEl = el)}
      >
        {pinned && <Card spec={pinned} full builds={builds} />}
      </div>
    </>
  );
}

/** Renders the windows over the stage; the shell calls this once. */
export function mountContextWindows() {
  const root = document.createElement('div');
  root.style.display = 'contents';
  stage.append(root);
  const reactRoot = createRoot(root);
  flushSync(() => reactRoot.render(<ContextWindows />));
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      const box = entry.borderBoxSize[0];
      if (box?.inlineSize && box.blockSize)
        dimensions.set(entry.target as HTMLElement, { width: box.inlineSize, height: box.blockSize });
    }
    requestPlacement();
  });
  observer.observe(tipEl!);
  observer.observe(winEl!);
  const unsubscribe = stageViewport.subscribe(viewport => {
    if (viewport.visible) requestPlacement();
    else cancelPlacement();
  });
  return () => {
    cancelPlacement();
    observer.disconnect();
    unsubscribe();
    reactRoot.unmount();
    root.remove();
  };
}

export const ctxWin = {
  hover,
  pin,
  close,
  refresh,
  place,
  esc,
  get pinnedBounds() {
    return windows.pinned && winEl && !winEl.hidden ? placements.get(winEl) || null : null;
  },
  get pinned() {
    return windows.pinned;
  },
  get hovered() {
    return windows.hovered;
  },
};

// Project a world point (main scene coordinates) to stage pixels with the current view's camera.
const anchorV = new Vector3();
export function worldAnchor(getPos: () => Vector3 | null | undefined) {
  return () => {
    const cam = state.view?.camera,
      viewport = stageViewport.get();
    if (!cam || !viewport.visible) return null;
    const p = getPos();
    if (!p) return null;
    anchorV.copy(p).project(cam);
    if (anchorV.z > 1 || Math.abs(anchorV.x) > 1.1 || Math.abs(anchorV.y) > 1.1) return null;
    return { x: ((anchorV.x + 1) / 2) * viewport.width, y: ((1 - anchorV.y) / 2) * viewport.height };
  };
}
