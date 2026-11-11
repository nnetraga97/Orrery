// Push-to-talk as a state machine: pinch and hold the microphone to listen, let go to stop. What was said is "heard"
// once the recogniser's final result has arrived, whether before or after the release; if none comes within 1.5 s of
// the release, the note "I didn't catch that" shows and the microphone is idle again. A refused microphone makes voice
// unavailable for the visit.

export type SpeechPhase = 'idle' | 'listening' | 'heard' | 'unavailable';
export type SpeechState = {
  phase: SpeechPhase;
  /** The words so far while listening; what was heard once heard. */
  text: string;
  /** The recogniser's final result, once it has come. */
  final: string | null;
  /** When the microphone was let go, while still waiting for a final result. */
  releasedAt: number | null;
  note: string | null;
};
export type SpeechEvent =
  | { type: 'press'; now: number }
  | { type: 'release'; now: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'end' }
  | { type: 'error'; code: string }
  | { type: 'tick'; now: number };

export const NOT_CAUGHT = "I didn't catch that";
export const WAIT_MS = 1500;
const REFUSED = new Set(['not-allowed', 'service-not-allowed']);

export const idleSpeech = (): SpeechState => ({ phase: 'idle', text: '', final: null, releasedAt: null, note: null });
const missed = (): SpeechState => ({ ...idleSpeech(), note: NOT_CAUGHT });
const heard = (text: string): SpeechState => ({ ...idleSpeech(), phase: 'heard', text, final: text });

export function speechStep(s: SpeechState, e: SpeechEvent): SpeechState {
  if (s.phase === 'unavailable') return s;
  if (e.type === 'error') return REFUSED.has(e.code) ? { ...idleSpeech(), phase: 'unavailable' } : s.phase === 'listening' ? missed() : s;
  if (e.type === 'press') return s.phase === 'listening' ? s : { ...idleSpeech(), phase: 'listening' };
  if (s.phase !== 'listening') return s;
  switch (e.type) {
    case 'partial':
      return { ...s, text: e.text };
    case 'final': {
      const text = e.text.trim();
      if (!text) return s.releasedAt != null ? missed() : s;
      return s.releasedAt != null ? heard(text) : { ...s, text, final: text };
    }
    case 'release':
      if (s.releasedAt != null) return s;
      return s.final ? heard(s.final) : { ...s, releasedAt: e.now };
    case 'end':
      // The recogniser stopped. Without a final result after the release, nothing was caught.
      return s.final && s.releasedAt != null ? heard(s.final) : s.releasedAt != null ? missed() : s;
    case 'tick':
      return s.releasedAt != null && e.now - s.releasedAt >= WAIT_MS ? missed() : s;
  }
}

/** Takes what was heard; the microphone is idle again. */
export function consume(s: SpeechState): [string | null, SpeechState] {
  return s.phase === 'heard' ? [s.text, idleSpeech()] : [null, s];
}
