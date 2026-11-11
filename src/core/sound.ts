// The app's sounds as recipes, made by the Web Audio API (no audio files). Each is one or two short tones; none is
// louder than a quiet click. The master volume and mute are settings.

export type SoundEvent = 'hover' | 'press' | 'send' | 'replyStarted' | 'editAccepted' | 'error' | 'replayStep';
export type Tone = { frequency: number; start: number; duration: number };
export type Recipe = { type: 'sine' | 'triangle' | 'square'; gain: number; tones: Tone[] };

/** The loudest any sound may be, before the master volume. */
export const MAX_GAIN = 0.08;

const RECIPES: Record<SoundEvent, Recipe> = {
  // A very soft tick.
  hover: { type: 'sine', gain: 0.012, tones: [{ frequency: 2200, start: 0, duration: 0.015 }] },
  press: { type: 'triangle', gain: 0.05, tones: [{ frequency: 1300, start: 0, duration: 0.03 }] },
  send: { type: 'sine', gain: 0.05, tones: [{ frequency: 660, start: 0, duration: 0.06 }, { frequency: 880, start: 0.05, duration: 0.07 }] },
  replyStarted: { type: 'sine', gain: 0.035, tones: [{ frequency: 520, start: 0, duration: 0.09 }] },
  // Two rising notes.
  editAccepted: { type: 'sine', gain: 0.07, tones: [{ frequency: 523.25, start: 0, duration: 0.11 }, { frequency: 783.99, start: 0.1, duration: 0.16 }] },
  // One low note.
  error: { type: 'triangle', gain: 0.06, tones: [{ frequency: 196, start: 0, duration: 0.22 }] },
  replayStep: { type: 'sine', gain: 0.03, tones: [{ frequency: 990, start: 0, duration: 0.04 }] },
};

/** The recipe for an event at a master volume (0 to 1), or null when muted or silent. */
export function soundFor(event: SoundEvent, volume: number, muted: boolean): Recipe | null {
  const v = Math.max(0, Math.min(1, volume));
  if (muted || v === 0) return null;
  const r = RECIPES[event];
  return { ...r, gain: Math.min(MAX_GAIN, r.gain) * v };
}

/** Seconds from the first tone's start to the last one's end. */
export const lengthOf = (r: Recipe) => Math.max(...r.tones.map(t => t.start + t.duration));
