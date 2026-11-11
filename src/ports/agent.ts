// The model behind the chat: send the request, receive stream events until the reply's message (or an error).
import type { AgentRequest, StreamEvent } from '../core/agent/wire.ts';

export interface AgentPort {
  /** A short name for the transcript and the settings ("Recorded", "Claude"). */
  readonly label: string;
  send(request: AgentRequest, onEvent: (event: StreamEvent) => void, signal: AbortSignal): Promise<void>;
}
