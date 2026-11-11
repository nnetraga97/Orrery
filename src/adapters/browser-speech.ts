// SpeechPort over the browser's speech recognition: one utterance per pinch (continuous off), with interim results so
// the words show while the user talks, in the browser's language.
import type { SpeechHandlers, SpeechPort } from '../ports/speech.ts';

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

const recognitionClass = (): RecognitionClass | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function createBrowserSpeech(): SpeechPort {
  let current: Recognition | null = null;
  return {
    async available() {
      if (!recognitionClass()) return false;
      try {
        // Ask for the microphone once, up front, so the first pinch does not stop for a permission prompt.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch {
        return false;
      }
    },
    start(handlers: SpeechHandlers) {
      const Class = recognitionClass();
      if (!Class) return handlers.error('service-not-allowed');
      current?.abort();
      const r = new Class();
      r.lang = navigator.language || 'en-US';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) handlers.final(result[0].transcript);
          else interim += result[0].transcript;
        }
        if (interim) handlers.partial(interim);
      };
      r.onerror = e => handlers.error(e.error);
      r.onend = () => {
        if (current === r) current = null;
        handlers.end();
      };
      current = r;
      try {
        r.start();
      } catch {
        handlers.error('aborted');
      }
    },
    stop() {
      current?.stop();
    },
  };
}
