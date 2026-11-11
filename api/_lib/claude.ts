// The Claude adapter: one wire request in, wire stream events out, through @anthropic-ai/sdk's streaming helper.
// Checked against the current documentation (2026-11): adaptive thinking with its summary shown (thinking text is
// hidden by default on this model family), the effort level set explicitly in output_config, strict tools with eager
// input streaming, server-side refusal fallback (beta), and the system prompt and tool list cached. Thinking blocks go
// back to the API exactly as they came (the whole block is the wire block's `opaque`).
import Anthropic from '@anthropic-ai/sdk';
import type { AgentRequest, Block, Message, StopReason, StreamEvent, ToolSpec, Usage } from '../../src/core/agent/wire.ts';

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The part of the SDK client this adapter uses (so tests can stub it). */
export type ClaudeClient = {
  beta: {
    messages: {
      stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }): AsyncIterable<Record<string, any>> & { finalMessage(): Promise<Record<string, any>> };
    };
  };
};

/** Keywords strict tools reject (they compile schemas to a grammar); the browser's validator still checks them. */
const UNSUPPORTED = ['minLength', 'maxLength', 'minimum', 'maximum', 'maxItems'];
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED.includes(k)) continue;
    if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
    out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, strictSchema(s)])) : strictSchema(v);
  }
  return out;
}

export function toClaudeTools(tools: ToolSpec[]) {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: strictSchema(t.input_schema),
    strict: true,
    eager_input_streaming: true,
    // The last tool carries the cache breakpoint for the whole tool list.
    ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function toClaudeBlock(b: Block): Record<string, unknown> {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'thinking':
      return b.opaque as Record<string, unknown>;
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
  }
}
export const toClaudeMessages = (messages: Message[]) => messages.map(m => ({ role: m.role, content: m.blocks.map(toClaudeBlock) }));

/** The API's content as wire blocks; thinking (shown or redacted) is kept whole as `opaque`. */
export function fromClaudeContent(content: Record<string, any>[]): Block[] {
  const blocks: Block[] = [];
  for (const c of content) {
    if (c.type === 'thinking') blocks.push({ type: 'thinking', text: c.thinking ?? '', opaque: c });
    else if (c.type === 'redacted_thinking') blocks.push({ type: 'thinking', opaque: c });
    else if (c.type === 'text') blocks.push({ type: 'text', text: c.text });
    else if (c.type === 'tool_use') blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
  }
  return blocks;
}

export function stopReasonOf(reason: string | null | undefined): StopReason {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens';
  if (reason === 'refusal') return 'refusal';
  return 'end';
}

export function claudeParams(request: AgentRequest) {
  const model = request.model && CLAUDE_MODELS.includes(request.model) ? request.model : CLAUDE_DEFAULT_MODEL;
  return {
    model,
    max_tokens: 64000,
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    tools: toClaudeTools(request.tools),
    tool_choice: { type: 'auto' },
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: request.effort && EFFORTS.includes(request.effort) ? request.effort : 'medium' },
    messages: toClaudeMessages(request.messages),
    // The conversation's last block is cached too, so each turn reads the turns before it from the cache.
    cache_control: { type: 'ephemeral' },
    fallbacks: 'default',
    betas: [FALLBACK_BETA],
  };
}

/** A provider error as a wire error code. */
export function errorCode(e: unknown): Extract<StreamEvent, { type: 'error' }> {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof Anthropic.RateLimitError) return { type: 'error', code: 'rate_limited', message: 'The provider is busy. Try again in a moment.' };
  if (e instanceof Anthropic.APIConnectionError) return { type: 'error', code: 'network', message: 'Could not reach the provider.' };
  const status = (e as { status?: number })?.status;
  if (status === 429) return { type: 'error', code: 'rate_limited', message: 'The provider is busy. Try again in a moment.' };
  if (status === 529 || status === 503) return { type: 'error', code: 'overloaded', message: 'The provider is overloaded. Try again in a moment.' };
  if (status === 400 || status === 413 || status === 422) return { type: 'error', code: 'bad_request', message };
  if (status === 401 || status === 403) return { type: 'error', code: 'unavailable', message: 'This provider is not available.' };
  return { type: 'error', code: 'internal', message: 'The provider failed to answer.' };
}

export async function streamClaude(client: ClaudeClient, request: AgentRequest, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<{ model: string; usage: Usage } | null> {
  const params = claudeParams(request);
  try {
    const stream = client.beta.messages.stream(params, { signal });
    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')
        emit({ type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name });
      else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') emit({ type: 'text', delta: event.delta.text });
        else if (event.delta?.type === 'thinking_delta') emit({ type: 'thinking', delta: event.delta.thinking });
      }
    }
    const final = await stream.finalMessage();
    const blocks = fromClaudeContent(final.content ?? []);
    const stopReason = stopReasonOf(final.stop_reason);
    // A refusal can come back with no content; the wire format needs one block.
    emit({ type: 'message', message: { role: 'assistant', blocks: blocks.length ? blocks : [{ type: 'text', text: stopReason === 'refusal' ? 'I can’t help with that request.' : '' }] }, stopReason });
    const u = final.usage ?? {};
    const usage: Usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
    emit({ type: 'usage', usage });
    return { model: final.model ?? params.model, usage };
  } catch (e) {
    if (signal.aborted) return null;
    emit(errorCode(e));
    return null;
  }
}

export const createClaudeClient = (apiKey: string): ClaudeClient => new Anthropic({ apiKey }) as unknown as ClaudeClient;
