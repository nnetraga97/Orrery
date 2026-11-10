// First-class Claude chat activity comes from the live stream-json output, never a transcript tail.
// The chat service owns the conversation; this bridge replays its CLI messages through the same
// record mapping that observes Claude transcripts (claude.mjs), so a chat turn fires the cannon,
// launches subagent drones and finishes turns exactly as an observed session does.
import { createClaudeAdapter } from './claude.mjs';

/** Feed `{ kind: 'begin' | 'message' | 'end', ... }` events for one app-owned Claude chat. */
export function createClaudeChatEvents({ root, sessionId, emit, displayName = 'Claude Code' }) {
  const adapter = createClaudeAdapter({ root, sessionId, emit, displayName });
  let started = false,
    stopped = false,
    turn = null;
  function accept(event) {
    if (stopped || !event || typeof event !== 'object') return false;
    if (!started) {
      adapter.start();
      started = true;
    }
    if (event.kind === 'begin') {
      if (turn) adapter.finish('interrupted');
      turn = event.turnId;
      adapter.begin(event.prompt || 'Claude Code turn', event.turnId);
    } else if (event.kind === 'message' && turn && event.message) {
      // The CLI's own result record finishes the turn with cost and outcome.
      adapter.record(event.message);
      if (event.message.type === 'result') turn = null;
    } else if (event.kind === 'end') {
      if (turn === event.turnId) adapter.finish(event.outcome || 'completed');
      turn = null;
    } else return false;
    return true;
  }
  return {
    accept,
    stop(outcome = 'interrupted') {
      if (stopped) return;
      if (turn) adapter.finish(outcome);
      stopped = true;
    },
  };
}
