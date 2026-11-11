// AgentPort over the server relay (/api/agent): posts the wire request and reads the server-sent events back.
import { isStreamEvent } from '../core/agent/wire.ts';
import type { AgentRequest, StreamEvent } from '../core/agent/wire.ts';
import type { AgentPort } from '../ports/agent.ts';

export function createHttpAgent(label: string, url = 'api/agent'): AgentPort {
  return {
    label,
    async send(request: AgentRequest, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        onEvent({ type: 'error', code: res.status === 400 || res.status === 413 ? 'bad_request' : 'unavailable', message: detail?.error ?? `The relay returned HTTP ${res.status}.` });
        return;
      }
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let k;
        while ((k = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, k);
          buffer = buffer.slice(k + 2);
          const data = chunk.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim();
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            if (isStreamEvent(event)) onEvent(event);
          } catch {
            // A malformed line is skipped.
          }
        }
      }
    },
  };
}

/** The providers the server can reach, or null when there is no relay (a static host). */
export async function fetchProviders(url = 'api/providers'): Promise<{ id: string; label: string; models: string[]; model: string; available: boolean }[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.providers) ? body.providers : null;
  } catch {
    return null;
  }
}
