// The OpenAI adapter, through OpenAI's own SDK and its Responses API (function calling with reasoning models goes
// through Responses). Checked against the current documentation (2026-11): stateless (`store: false`), so the whole
// history is replayed each turn; reasoning items carry their encrypted content and are passed back unchanged, in
// order, as the wire's `opaque`. Tools are not strict here: OpenAI's strict mode needs every property required, and
// some of this app's tool fields are optional (the browser validates every input either way).
import OpenAI from 'openai';
import type { AgentRequest, Block, Message, StopReason, StreamEvent, ToolSpec, Usage } from '../../src/core/agent/wire.ts';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-astra';
export const OPENAI_MODELS = ['gpt-6-astra', 'gpt-5.6-terra'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export type OpenAIClient = {
  responses: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<AsyncIterable<Record<string, any>>> };
};

export const toOpenAITools = (tools: ToolSpec[]) =>
  tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }));

/** The conversation as Responses input items, in order. */
export function toOpenAIInput(messages: Message[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages)
    for (const b of m.blocks) {
      if (b.type === 'text') {
        if (b.text) out.push(m.role === 'user' ? { role: 'user', content: b.text } : { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: b.text }] });
      } else if (b.type === 'thinking') {
        // Only OpenAI's own reasoning items go back; another provider's thinking (or the recording's) is left out.
        const item = b.opaque as Record<string, unknown> | null;
        if (item && item.type === 'reasoning' && typeof item.id === 'string') out.push(item);
      }
      else if (b.type === 'tool_use') out.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      else out.push({ type: 'function_call_output', call_id: b.toolUseId, output: b.isError ? `Error: ${b.content}` : b.content });
    }
  return out;
}

export function fromOpenAIOutput(output: Record<string, any>[]): { blocks: Block[]; refused: boolean } {
  const blocks: Block[] = [];
  let refused = false;
  for (const item of output) {
    if (item.type === 'reasoning')
      blocks.push({ type: 'thinking', text: (item.summary ?? []).map((s: { text?: string }) => s.text ?? '').join('\n'), opaque: item });
    else if (item.type === 'message')
      for (const part of item.content ?? []) {
        if (part.type === 'output_text') blocks.push({ type: 'text', text: part.text });
        else if (part.type === 'refusal') {
          refused = true;
          blocks.push({ type: 'text', text: part.refusal });
        }
      }
    else if (item.type === 'function_call') {
      let input: unknown;
      try {
        input = JSON.parse(item.arguments || '{}');
      } catch {
        input = { INVALID_JSON: item.arguments };
      }
      blocks.push({ type: 'tool_use', id: item.call_id, name: item.name, input });
    }
  }
  return { blocks, refused };
}

export function openaiParams(request: AgentRequest) {
  const model = request.model && OPENAI_MODELS.includes(request.model) ? request.model : OPENAI_DEFAULT_MODEL;
  return {
    model,
    instructions: request.system,
    input: toOpenAIInput(request.messages),
    tools: toOpenAITools(request.tools),
    tool_choice: 'auto',
    reasoning: { effort: request.effort && EFFORTS.includes(request.effort) ? request.effort : 'medium', summary: 'auto' },
    store: false,
    // Stateless: reasoning items must carry their encrypted content to be sent back on the next request.
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 64000,
    stream: true,
  };
}

function errorOf(e: unknown): Extract<StreamEvent, { type: 'error' }> {
  // The provider's own rate limit is a busy moment; `rate_limited` is reserved for the relay's visitor limit.
  if (e instanceof OpenAI.RateLimitError || (e as { status?: number })?.status === 429)
    return { type: 'error', code: 'overloaded', message: 'The provider is busy. Try again in a moment.' };
  if (e instanceof OpenAI.APIConnectionError) return { type: 'error', code: 'network', message: 'Could not reach the provider.' };
  const status = (e as { status?: number })?.status;
  if (status === 400 || status === 422) return { type: 'error', code: 'bad_request', message: e instanceof Error ? e.message : String(e) };
  if (status === 401 || status === 403) return { type: 'error', code: 'unavailable', message: 'This provider is not available.' };
  if (status === 503) return { type: 'error', code: 'overloaded', message: 'The provider is overloaded. Try again in a moment.' };
  return { type: 'error', code: 'internal', message: 'The provider failed to answer.' };
}

export async function streamOpenAI(client: OpenAIClient, request: AgentRequest, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<{ model: string; usage: Usage } | null> {
  const params = openaiParams(request);
  try {
    const stream = await client.responses.create(params, { signal });
    let final: Record<string, any> | null = null;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') emit({ type: 'text', delta: event.delta });
      else if (event.type === 'response.reasoning_summary_text.delta') emit({ type: 'thinking', delta: event.delta });
      else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') emit({ type: 'tool_use_start', id: event.item.call_id, name: event.item.name });
      else if (event.type === 'response.function_call_arguments.delta') emit({ type: 'progress' });
      else if (event.type === 'response.completed' || event.type === 'response.incomplete') final = event.response;
      else if (event.type === 'response.failed' || event.type === 'error') throw Object.assign(new Error(event.response?.error?.message ?? event.message ?? 'failed'), { status: 500 });
    }
    if (!final) throw new Error('The stream ended without a response.');
    const { blocks, refused } = fromOpenAIOutput(final.output ?? []);
    const cut = final.status === 'incomplete' && final.incomplete_details?.reason === 'max_output_tokens';
    const filtered = final.status === 'incomplete' && final.incomplete_details?.reason === 'content_filter';
    const stopReason: StopReason = refused || filtered ? 'refusal' : cut ? 'max_tokens' : blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end';
    emit({ type: 'message', message: { role: 'assistant', blocks: blocks.length ? blocks : [{ type: 'text', text: '' }] }, stopReason });
    const u = final.usage ?? {};
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    const usage: Usage = { input: (u.input_tokens ?? 0) - cached, output: u.output_tokens ?? 0, cacheRead: cached };
    emit({ type: 'usage', usage });
    return { model: final.model ?? params.model, usage };
  } catch (e) {
    if (signal.aborted) return null;
    emit(errorOf(e));
    return null;
  }
}

export const createOpenAIClient = (apiKey: string): OpenAIClient => new OpenAI({ apiKey }) as unknown as OpenAIClient;
