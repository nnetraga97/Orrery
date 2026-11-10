import { $ } from './dom.ts';

// Only the newest load owns the overlay. Retired builds cannot dismiss a newer one.
let owner: object | null = null;
export function beginSceneLoading(title: string, detail: string) {
  const token = {};
  owner = token;
  const overlay = $('busy'),
    stage = $('stage');
  $('sceneLoadingTitle').textContent = title;
  $('sceneLoadingDetail').textContent = detail;
  overlay.hidden = false;
  stage.setAttribute('aria-busy', 'true');
  return {
    update(message: string) {
      if (owner === token) $('sceneLoadingDetail').textContent = message;
    },
    finish() {
      if (owner !== token) return;
      owner = null;
      overlay.hidden = true;
      stage.setAttribute('aria-busy', 'false');
    },
  };
}

// Give the overlay a paint before synchronous construction; then let the scene
// draw before dismissing it. No artificial minimum delay or invented percentage.
export const scenePaint = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
