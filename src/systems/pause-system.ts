// Pauses cleanly when the session is hidden or blurred (a system menu over it, the headset taken off) and resumes as it
// was. While paused the galaxy's time stops (galaxy-system.ts), windows stop redrawing, the microphone stops listening,
// sound is suspended and a playing replay holds its step. A model call in flight is not cancelled: its answer is
// waiting on resume. It also sets the immersive session's fixed foveation to a medium level each time the session
// becomes visible (the framebuffer scale stays at its default); outside a session nothing is changed.
import { VisibilityState, createSystem } from '@iwsdk/core';
import { paused, speech } from '../state/app-state.ts';
import { releaseMic } from '../state/commands.ts';
import { SoundSystem } from './sound-system.ts';

/** Fixed foveation: 0 is none, 1 the most; medium keeps the edges of view softer without showing it on text. */
export const FOVEATION = 0.5;

export class PauseSystem extends createSystem({}) {
  init() {
    const set = () => {
      const state = this.world.visibilityState.peek();
      // Medium fixed foveation, only inside an immersive session (iwsdk-dev api-reference, XR Session Optimization).
      if (state === VisibilityState.Visible && this.renderer.xr.isPresenting) this.renderer.xr.setFoveation(FOVEATION);
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const next = hidden || state === VisibilityState.Hidden || state === VisibilityState.VisibleBlurred;
      if (next === paused.peek()) return;
      paused.value = next;
      if (next && speech.peek().phase === 'listening') releaseMic();
      this.world.getSystem(SoundSystem)?.setPaused(next);
    };
    document.addEventListener('visibilitychange', set);
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(set), () => document.removeEventListener('visibilitychange', set));
  }
}
