// Fixed controls invalidate their overlap bounds on layout changes, never on camera frames.
import { ctxWin } from './context-windows.tsx';
import { stage, stageViewport } from './stage-viewport.ts';

type Bounds = { x0: number; x1: number; y0: number; y1: number };
const selector =
  '.planet-tools, .planet-town-menu, .planet-display-menu, .planet-auxiliary, .planet-status, .scene-navigation';
const ignored = '#labels, .ctx, #sceneFps, #workspaceLog';

export function createSceneObstacles() {
  let dirty = true,
    discover = true;
  let targets: Element[] = [],
    bounds: Bounds[] = [];
  const invalidate = () => {
    dirty = true;
  };
  const sizes = new ResizeObserver(invalidate);
  const attributes = new MutationObserver(invalidate);
  const children = new MutationObserver(records => {
    if (
      records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest(ignored);
      })
    )
      dirty = discover = true;
  });
  children.observe(stage, { childList: true, subtree: true });
  const body = new MutationObserver(invalidate);
  body.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const unsubscribe = stageViewport.subscribe(invalidate);

  function refresh() {
    if (discover) {
      sizes.disconnect();
      attributes.disconnect();
      targets = Array.from(stage.querySelectorAll(selector));
      for (const target of targets) {
        sizes.observe(target);
        attributes.observe(target, {
          attributes: true,
          subtree: true,
          attributeFilter: ['class', 'hidden', 'open', 'style'],
        });
      }
      discover = false;
    }
    const { left, top } = stageViewport.get();
    bounds = targets.flatMap(target => {
      // A closed <details> still lays out its menu (Chromium only skips painting it), so a closed Find town or
      // Display menu would keep a large invisible box that hid every label behind it.
      const menu = target.parentElement?.closest('details');
      if (menu && !menu.open) return [];
      const rect = target.getBoundingClientRect();
      return rect.width && rect.height
        ? [{ x0: rect.left - left - 8, x1: rect.right - left + 8, y0: rect.top - top - 8, y1: rect.bottom - top + 8 }]
        : [];
    });
    dirty = false;
  }

  return {
    appendTo(occupied: Bounds[]) {
      if (dirty) refresh();
      occupied.push(...bounds);
      // The moving window already knows its stage-relative position and measured dimensions.
      const context = ctxWin.pinnedBounds;
      if (context) occupied.push({ x0: context.x0 - 8, x1: context.x1 + 8, y0: context.y0 - 8, y1: context.y1 + 8 });
    },
    dispose() {
      sizes.disconnect();
      attributes.disconnect();
      children.disconnect();
      body.disconnect();
      unsubscribe();
    },
  };
}
