// Speech recognition, push-to-talk: start when the microphone is pinched, stop when it is let go.
export interface SpeechHandlers {
  partial(text: string): void;
  final(text: string): void;
  error(code: string): void;
  /** Recognition has stopped (after the final result, an error, or silence). */
  end(): void;
}
export interface SpeechPort {
  /** Whether recognition can run here (the browser has it and the microphone is allowed). Asked once at start. */
  available(): Promise<boolean>;
  start(handlers: SpeechHandlers): void;
  stop(): void;
}
