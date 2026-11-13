// The agent behind the chat, switchable: the relay to the chosen provider when the server holds its key, else the
// recorded agent. When the day's budget is spent, the recorded agent takes over, but only for a chat that has not
// started: its script fits no other conversation. A chat under way keeps its provider and the turn fails with the
// relay's message, as it does when the visitor's rate limit is reached; the chat and its edits stay.
import type { AgentRequest, StreamEvent } from '../core/agent/wire.ts';
import type { AgentPort } from '../ports/agent.ts';
import { createHttpAgent } from './http-agent.ts';

export const FELL_BACK = "Today's budget for the live agent is spent, so the recorded agent answers. It replays one prepared fix.";

export function createAgentSwitch(recorded: AgentPort, onFallback: (message: string) => void) {
  let live: { id: string; port: AgentPort } | null = null;
  let current: AgentPort = recorded;
  const port: AgentPort = {
    get label() {
      return current.label;
    },
    async send(request: AgentRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
      if (current === recorded || !live) return recorded.send({ ...request, provider: 'recorded' }, onEvent, signal);
      let fellBack = false;
      const fresh = !request.messages.some(m => m.role === 'assistant');
      await live.port.send({ ...request, provider: live.id }, e => {
        if (e.type === 'error' && e.code === 'budget_spent' && fresh) fellBack = true;
        else onEvent(e);
      }, signal);
      if (fellBack) {
        current = recorded;
        onFallback(FELL_BACK);
        await recorded.send({ ...request, provider: 'recorded' }, onEvent, signal);
      }
    },
  };
  return {
    port,
    /** Uses the relay for `id`, or the recorded agent for 'recorded'. */
    choose(id: string, label: string) {
      if (id === 'recorded') {
        current = recorded;
        live = null;
      } else {
        live = { id, port: createHttpAgent(label) };
        current = live.port;
      }
    },
    get providerId() {
      return current === recorded ? 'recorded' : (live?.id ?? 'recorded');
    },
  };
}
