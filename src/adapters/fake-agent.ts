// The recorded agent: replays a hand-written session (fake-sessions/*.json) in the wire format, streaming each reply
// with small delays as a live model would. Which reply comes next is chosen by how many tool results the request
// holds, so the recording follows the real loop whatever the user pinches. Past the end of the recording it says so.
import { recordedReply } from '../core/agent/recorded.ts';
import type { RecordedSession } from '../core/agent/recorded.ts';
import type { AgentRequest, StreamEvent } from '../core/agent/wire.ts';
import type { AgentPort } from '../ports/agent.ts';
import rangeEdge from './fake-sessions/range-edge.json';

const SESSIONS: Record<string, RecordedSession> = { 'range-edge': rangeEdge as RecordedSession };

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Stopped', 'AbortError'))), { once: true });
  });

/** `pace` scales every delay (0 in tests). */
export function createFakeAgent(sessionId = 'range-edge', pace = 1): AgentPort {
  const session = SESSIONS[sessionId] ?? SESSIONS['range-edge'];
  return {
    label: 'Recorded',
    async send(request: AgentRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
      const { blocks, stopReason } = recordedReply(session, request.messages);
      await wait(250 * pace, signal);
      for (const block of blocks) {
        if (block.type === 'thinking' || block.type === 'text') {
          const words = (block.text ?? '').split(/(\s+)/);
          for (let i = 0; i < words.length; i += 6) {
            onEvent({ type: block.type, delta: words.slice(i, i + 6).join('') });
            await wait(40 * pace, signal);
          }
        } else if (block.type === 'tool_use') {
          onEvent({ type: 'tool_use_start', id: block.id, name: block.name });
          await wait(120 * pace, signal);
        }
      }
      onEvent({ type: 'message', message: { role: 'assistant', blocks: structuredClone(blocks) }, stopReason });
      onEvent({ type: 'usage', usage: { input: 0, output: 0 } });
    },
  };
}
