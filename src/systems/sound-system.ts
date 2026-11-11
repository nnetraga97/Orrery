// Quiet feedback sounds, synthesised with the Web Audio API from the recipes in src/core/sound.ts. The audio context
// starts on the first press (browsers allow sound only after a user gesture), and is suspended while the session is
// paused. Volume and mute come from the settings.
import { createSystem } from '@iwsdk/core';
import { soundFor } from '../core/sound.ts';
import type { SoundEvent } from '../core/sound.ts';
import { paused, soundLevel } from '../state/app-state.ts';
import { connectSound } from '../state/commands.ts';

export class SoundSystem extends createSystem({}) {
  private context: AudioContext | null = null;
  private lastHover = 0;

  init() {
    this.cleanupFuncs.push(
      connectSound(event => this.sound(event)),
      () => void this.context?.close(),
    );
  }

  /** Suspends or resumes the audio with the session (Task 17). */
  setPaused(paused: boolean) {
    if (!this.context) return;
    void (paused ? this.context.suspend() : this.context.resume());
  }

  private sound(event: SoundEvent) {
    // Nothing plays while the session is paused (a reply finishing meanwhile must not wake the audio).
    if (paused.peek()) return;
    if (!this.context) {
      // Only a press may start the audio.
      if (event === 'hover') return;
      try {
        this.context = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.context.state === 'suspended') void this.context.resume();
    // Hover ticks at most ten times a second.
    if (event === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 100) return;
      this.lastHover = now;
    }
    const { volume, mute } = soundLevel.peek();
    const recipe = soundFor(event, volume, mute);
    if (!recipe) return;
    const ctx = this.context,
      t0 = ctx.currentTime + 0.005;
    for (const tone of recipe.tones) {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = recipe.type;
      osc.frequency.value = tone.frequency;
      // A short attack and an exponential release, so nothing clicks.
      const start = t0 + tone.start,
        end = start + tone.duration;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(recipe.gain, start + Math.min(0.008, tone.duration / 3));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }
}
