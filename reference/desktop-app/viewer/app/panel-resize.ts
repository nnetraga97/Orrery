// The side panel's resize handle: drag, arrow keys (Shift for larger steps), Home/End, Enter or double-click to
// reset, Escape to cancel a drag. The chosen width is remembered and clamped to smaller windows.
import { $ } from './dom.ts';
import { remember, remembered } from './project-store.ts';

export function initPanelResize(defaultWidth: number) {
  const panel = $('agentPanel'),
    handle = $('agentResize');
  const saved = Number(remembered('galaxyAgentWidth'));
  let preferred = Number.isFinite(saved) && saved >= 240 && saved <= 1600 ? saved : defaultWidth;
  let drag: { id: number; x: number; width: number; preferred: number } | null = null;
  const bounds = () => {
    const max = Math.max(0, Math.min(1600, window.innerWidth - (window.innerWidth <= 900 ? 32 : 360)));
    return { min: Math.min(300, max), max };
  };
  const clamp = (value: number) => {
    const { min, max } = bounds();
    return Math.round(Math.max(min, Math.min(max, value)));
  };
  const apply = () => {
    const width = clamp(preferred),
      { min, max } = bounds();
    panel.style.setProperty('--agent-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  };
  const save = () => remember('galaxyAgentWidth', Math.max(240, preferred));
  const finish = (cancel: boolean) => {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (cancel) preferred = previous.preferred;
    document.body.classList.remove('resizing-agents');
    if (handle.hasPointerCapture(previous.id)) handle.releasePointerCapture(previous.id);
    apply();
    if (!cancel) save();
  };
  handle.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault();
    handle.focus();
    drag = { id: event.pointerId, x: event.clientX, width: panel.getBoundingClientRect().width, preferred };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-agents');
  };
  handle.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    preferred = clamp(drag.width + drag.x - event.clientX);
    apply();
  };
  handle.onpointerup = event => {
    if (event.pointerId === drag?.id) finish(false);
  };
  handle.onpointercancel = () => finish(true);
  handle.onlostpointercapture = () => finish(false);
  window.addEventListener('blur', () => finish(false));
  handle.ondblclick = () => {
    preferred = defaultWidth;
    apply();
    save();
  };
  handle.onkeydown = event => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish(true);
      return;
    }
    if (drag) return;
    const { min, max } = bounds(),
      step = event.shiftKey ? 60 : 20;
    const width = clamp(preferred);
    const next = (
      { ArrowLeft: width + step, ArrowRight: width - step, Home: min, End: max, Enter: defaultWidth } as Record<
        string,
        number
      >
    )[event.key];
    if (next === undefined) return;
    event.preventDefault();
    preferred = clamp(next);
    apply();
    save();
  };
  // Clamp to smaller windows without losing the user's preferred wide layout.
  window.addEventListener('resize', apply);
  apply();
}
