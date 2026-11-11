// The agent behind the chat, switchable: the recorded agent by default; with ?agent=live, the relay to the chosen
// provider when the server holds its key. When the relay answers rate_limited or budget_spent, the recorded agent takes
// over for the rest of the visit and the chat says so.
import type { AgentRequest, StreamEvent } from '../core/agent/wire.ts';
import type { AgentPort } from '../ports/agent.ts';
import { createHttpAgent } from './http-agent.ts';

export const FELL_BACK = 'The live agent is unavailable right now, so the recorded agent takes over.';

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
      await live.port.send({ ...request, provider: live.id }, e => {
        if (e.type === 'error' && (e.code === 'rate_limited' || e.code === 'budget_spent')) fellBack = true;
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
