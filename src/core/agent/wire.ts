// The one message format the browser and the server share, whatever the provider: a request carries the system prompt,
// the tools and the conversation; the server streams events back. Thinking blocks carry the provider's own data as
// `opaque`, returned unchanged on the next request (providers check it).

export type TextBlock = { type: 'text'; text: string };
export type ThinkingBlock = { type: 'thinking'; text?: string; opaque: unknown };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: 'tool_result'; toolUseId: string; content: string; isError: boolean };
export type Block = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; blocks: Block[] };
export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';
export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type AgentRequest = {
  provider: string;
  /** The open project; the relay builds the system prompt from it. */
  project?: string;
  model?: string;
  effort?: string;
  system: string;
  tools: ToolSpec[];
  messages: Message[];
};
export type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; costCents?: number };
export type ErrorCode = 'rate_limited' | 'budget_spent' | 'overloaded' | 'bad_request' | 'unavailable' | 'network' | 'internal';
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  /** The provider is still sending something the app does not show (a tool's input): the call is alive. */
  | { type: 'progress' }
  | { type: 'message'; message: Message; stopReason: StopReason }
  | { type: 'usage'; usage: Usage }
  | { type: 'error'; code: ErrorCode; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
export const STOP_REASONS: readonly StopReason[] = ['end', 'tool_use', 'max_tokens', 'refusal'];
const ERROR_CODES: readonly ErrorCode[] = ['rate_limited', 'budget_spent', 'overloaded', 'bad_request', 'unavailable', 'network', 'internal'];

export function isBlock(v: unknown): v is Block {
  if (!isObject(v)) return false;
  switch (v.type) {
    case 'text':
      return isString(v.text);
    case 'thinking':
      return 'opaque' in v && (v.text === undefined || isString(v.text));
    case 'tool_use':
      return isString(v.id) && !!v.id && isString(v.name) && 'input' in v;
    case 'tool_result':
      return isString(v.toolUseId) && isString(v.content) && typeof v.isError === 'boolean';
    default:
      return false;
  }
}

export function isMessage(v: unknown): v is Message {
  if (!isObject(v) || (v.role !== 'user' && v.role !== 'assistant') || !Array.isArray(v.blocks) || !v.blocks.length) return false;
  if (!v.blocks.every(isBlock)) return false;
  // Tool calls come only from the assistant; tool results only from the user.
  const blocks = v.blocks as Block[];
  if (v.role === 'user') return blocks.every(b => b.type === 'text' || b.type === 'tool_result');
  return blocks.every(b => b.type !== 'tool_result');
}

/** What is wrong with a request, as sentences; empty when it is valid. */
export function requestErrors(v: unknown): string[] {
  if (!isObject(v)) return ['The request must be an object.'];
  const errors: string[] = [];
  if (!isString(v.provider) || !v.provider) errors.push('provider is required.');
  if (v.model !== undefined && !isString(v.model)) errors.push('model must be a string.');
  if (v.project !== undefined && !isString(v.project)) errors.push('project must be a string.');
  if (v.effort !== undefined && !isString(v.effort)) errors.push('effort must be a string.');
  if (!isString(v.system)) errors.push('system must be a string.');
  if (!Array.isArray(v.tools) || !v.tools.every(t => isObject(t) && isString(t.name) && isString(t.description) && isObject(t.input_schema)))
    errors.push('tools must be a list of tool specs.');
  if (!Array.isArray(v.messages) || !v.messages.length) errors.push('messages must be a non-empty list.');
  else {
    v.messages.forEach((m, i) => {
      if (!isMessage(m)) errors.push(`messages[${i}] is not a valid message.`);
    });
    if ((v.messages[0] as Message)?.role !== 'user') errors.push('The conversation must start with the user.');
    for (let i = 1; i < v.messages.length; i++)
      if ((v.messages[i] as Message)?.role === (v.messages[i - 1] as Message)?.role) {
        errors.push('Messages must alternate between user and assistant.');
        break;
      }
  }
  return errors;
}

export function isStreamEvent(v: unknown): v is StreamEvent {
  if (!isObject(v)) return false;
  switch (v.type) {
    case 'text':
    case 'thinking':
      return isString(v.delta);
    case 'tool_use_start':
      return isString(v.id) && isString(v.name);
    case 'progress':
      return true;
    case 'message':
      return isMessage(v.message) && (v.message as Message).role === 'assistant' && STOP_REASONS.includes(v.stopReason as StopReason);
    case 'usage':
      return isObject(v.usage) && typeof v.usage.input === 'number' && typeof v.usage.output === 'number';
    case 'error':
      return ERROR_CODES.includes(v.code as ErrorCode) && isString(v.message);
    default:
      return false;
  }
}

/** The tool calls in an assistant message, in order. */
export const toolUses = (m: Message) => m.blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
/** How many tool results the conversation holds. */
export const resultCount = (messages: readonly Message[]) =>
  messages.reduce((n, m) => n + m.blocks.filter(b => b.type === 'tool_result').length, 0);
