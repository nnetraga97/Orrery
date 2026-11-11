// Push-to-talk. Pinch and hold the composer's microphone (or a question's "Say your answer") to listen; let go to stop.
// The speech port reports words as they come; the state machine (src/core/speech.ts) decides when they were heard,
// and the heard text goes where the pinch was: the composer, the question's answer, or a queued message said again.
// At start it asks once whether voice can work here; if not, the microphone is shown unavailable with one notice.
import { createSystem } from '@iwsdk/core';
import { heard, replaceQueued } from '../core/chat/composer.ts';
import { speak } from '../core/chat/requests.ts';
import { consume, speechStep } from '../core/speech.ts';
import type { SpeechEvent } from '../core/speech.ts';
import type { SpeechPort } from '../ports/speech.ts';
import { answers, composer, speech, voiceTarget } from '../state/app-state.ts';
import type { VoiceTarget } from '../state/app-state.ts';
import { connectVoice } from '../state/commands.ts';

export const VOICE_UNAVAILABLE = "Voice isn't available here. Pinch a suggestion instead.";

export class VoiceSystem extends createSystem({}) {
  private port: SpeechPort | null = null;
  /** Bumped on each press, so a late event from an earlier utterance is ignored. */
  private utterance = 0;

  init() {
    this.port = (this.globals.speech as SpeechPort | undefined) ?? null;
    if (!this.port) this.markUnavailable();
    else
      void this.port.available().then(ok => {
        if (!ok) this.markUnavailable();
      });
    this.cleanupFuncs.push(
      connectVoice({
        press: target => this.press(target),
        release: () => this.release(),
      }),
    );
  }

  private markUnavailable() {
    this.step({ type: 'error', code: 'not-allowed' });
    composer.value = { ...composer.peek(), notice: VOICE_UNAVAILABLE };
  }

  private step(event: SpeechEvent) {
    speech.value = speechStep(speech.peek(), event);
  }

  private press(target: VoiceTarget) {
    if (!this.port || speech.peek().phase === 'unavailable' || speech.peek().phase === 'listening') return;
    voiceTarget.value = target;
    const id = ++this.utterance;
    this.step({ type: 'press', now: performance.now() });
    const live = () => id === this.utterance;
    this.port.start({
      partial: text => live() && this.step({ type: 'partial', text }),
      final: text => live() && this.step({ type: 'final', text }),
      error: code => {
        if (!live()) return;
        this.step({ type: 'error', code });
        if (speech.peek().phase === 'unavailable') composer.value = { ...composer.peek(), notice: VOICE_UNAVAILABLE };
      },
      end: () => live() && this.step({ type: 'end' }),
    });
  }

  private release() {
    if (speech.peek().phase !== 'listening') return;
    this.step({ type: 'release', now: performance.now() });
    this.port?.stop();
  }

  update() {
    const s = speech.peek();
    if (s.phase === 'listening' && s.releasedAt != null) this.step({ type: 'tick', now: performance.now() });
    if (speech.peek().phase !== 'heard') return;
    const [text, next] = consume(speech.peek());
    speech.value = next;
    if (text) this.deliver(text, voiceTarget.peek());
  }

  private deliver(text: string, target: VoiceTarget) {
    if (target.kind === 'answer') {
      const current = answers.peek().get(target.requestId);
      if (!current) return;
      answers.value = new Map(answers.peek()).set(target.requestId, speak(current, target.questionId, text));
    } else if (target.kind === 'queue') composer.value = replaceQueued(composer.peek(), target.id, text);
    else composer.value = heard(composer.peek(), text);
  }
}
