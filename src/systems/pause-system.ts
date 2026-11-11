// Pauses cleanly when the session is hidden or blurred (a system menu over it, the headset taken off) and resumes as it
// was. While paused the galaxy's time stops (galaxy-system.ts), windows stop redrawing, the microphone stops listening,
// sound is suspended and a playing replay holds its step. A model call in flight is not cancelled: its answer is
// waiting on resume.
import { VisibilityState, createSystem } from '@iwsdk/core';
import { paused, speech } from '../state/app-state.ts';
import { releaseMic } from '../state/commands.ts';
import { SoundSystem } from './sound-system.ts';

export class PauseSystem extends createSystem({}) {
  init() {
    const set = () => {
      const state = this.world.visibilityState.peek();
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
