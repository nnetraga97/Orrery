// Share stage geometry across scene and overlay frames. Only layout/visibility events measure it.
import { $ } from './dom.ts';

export const stage = $('stage');
type Viewport = { width: number; height: number; left: number; top: number; visible: boolean };
const listeners = new Set<(viewport: Viewport) => void>();
let viewport: Viewport = { width: 0, height: 0, left: 0, top: 0, visible: false };

function refresh() {
  const rect = stage.getBoundingClientRect();
  const width = stage.clientWidth,
    height = stage.clientHeight;
  const next = { width, height, left: rect.left, top: rect.top, visible: !document.hidden && width > 0 && height > 0 };
  if (Object.keys(next).every(key => next[key as keyof Viewport] === viewport[key as keyof Viewport])) return;
  viewport = next;
  for (const listener of listeners) listener(viewport);
}

new ResizeObserver(refresh).observe(stage);
// Workbench tabs hide the stage through body classes without hiding the Electron document.
new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', refresh);
document.addEventListener('visibilitychange', refresh);
refresh();

export const stageViewport = {
  get: () => viewport,
  refresh,
  subscribe(listener: (viewport: Viewport) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
