// SpeechPort for tests and demos without a microphone: each pinch "hears" the next phrase given by ?say= (phrases
// separated by "|"; the last one repeats). The words arrive as they would from a recogniser: a partial result while
// the microphone is held, the final one when it is let go.
import type { SpeechHandlers, SpeechPort } from '../ports/speech.ts';

export function createFakeSpeech(phrases: string[]): SpeechPort {
  let next = 0;
  let current: { handlers: SpeechHandlers; phrase: string } | null = null;
  return {
    available: async () => phrases.length > 0,
    start(handlers) {
      const phrase = phrases[Math.min(next++, phrases.length - 1)] ?? '';
      current = { handlers, phrase };
      const words = phrase.split(' ');
      setTimeout(() => current?.handlers === handlers && handlers.partial(words.slice(0, Math.ceil(words.length / 2)).join(' ')), 50);
    },
    stop() {
      const c = current;
      current = null;
      if (!c) return;
      setTimeout(() => {
        if (c.phrase) c.handlers.final(c.phrase);
        c.handlers.end();
      }, 80);
    },
  };
}
