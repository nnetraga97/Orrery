// A recorded session: replies in the wire format, chosen by how many tool results the request holds, so a recording
// follows the real loop whatever the user pinches.
import { resultCount, toolUses } from './wire.ts';
import type { Message, StopReason } from './wire.ts';

export type RecordedTurn = { blocks: Message['blocks']; stopReason: StopReason };
export type RecordedSession = { id: string; turns: RecordedTurn[] };

export const END_OF_RECORDING = 'That is the end of the recorded session. Start a new chat to watch it again.';

/** The reply for a conversation: the first turn whose earlier turns hold as many tool calls as there are results.
 * Once the recording has given its final answer, or past its end, a plain reply saying so. */
export function recordedReply(session: RecordedSession, messages: Message[]): RecordedTurn {
  const finished = messages.some(m => m.role === 'assistant' && !toolUses(m).length);
  const results = resultCount(messages);
  let calls = 0;
  if (!finished)
    for (const turn of session.turns) {
      if (calls >= results) return turn;
      calls += turn.blocks.filter(b => b.type === 'tool_use').length;
    }
  return { blocks: [{ type: 'text', text: END_OF_RECORDING }], stopReason: 'end' };
}
