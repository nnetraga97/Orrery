// Records a live run in the recorded-session format (recorded.ts), so a real run can become the fallback, and keeps
// each request's token usage so cache hits can be checked in the browser. Thinking blocks keep their text but not the
// provider's opaque data: a signature is tied to its provider and must not be shipped in a static file.
import type { Message, StopReason, Usage } from './wire.ts';
import type { RecordedSession, RecordedTurn } from './recorded.ts';

export type UsageEntry = Usage & { at: number };

export function createRecording(id: string) {
  const turns: RecordedTurn[] = [];
  const usage: UsageEntry[] = [];
  return {
    /** A finished reply from the model. */
    reply(message: Message, stopReason: StopReason) {
      turns.push({
        stopReason,
        blocks: message.blocks.map(b => (b.type === 'thinking' ? { type: 'thinking', text: b.text ?? '', opaque: { recorded: true } } : b)),
      });
    },
    /** A request's usage, as the relay reported it. */
    usage(u: Usage, at: number) {
      usage.push({ ...u, at });
    },
    get turns(): readonly RecordedTurn[] {
      return turns;
    },
    get usageLog(): readonly UsageEntry[] {
      return usage;
    },
    /** The run as a recorded session, ready to save as src/adapters/fake-sessions/<id>.json. */
    session(note: string): RecordedSession & { note: string } {
      return { id, note, turns: turns.map(t => ({ ...t, blocks: [...t.blocks] })) };
    },
    /** Whether any request after the first read from the prompt cache. */
    cacheHit(): boolean {
      return usage.slice(1).some(u => (u.cacheRead ?? 0) > 0);
    },
  };
}
export type Recording = ReturnType<typeof createRecording>;
