// The Nemotron adapter: plain fetch against Nebius Token Factory's Chat Completions endpoint, as the desktop loop
// does (reference/desktop-app/engine/agent/providers/nemotron-loop.cjs: the endpoint, the default model), but
// streaming. Chat Completions has no thinking to send back; reasoning text the model streams is shown and kept as a
// thinking block whose opaque data is not sent again.
import type { AgentRequest, Block, Message, StopReason, StreamEvent, ToolSpec, Usage } from '../../src/core/agent/wire.ts';

export const NEMOTRON_ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
export const NEMOTRON_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export const toNemotronTools = (tools: ToolSpec[]) =>
  tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

export function toNemotronMessages(system: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
      const calls = m.blocks.flatMap(b => (b.type === 'tool_use' ? [{ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Tool results answer the calls first; any text the user added follows them.
      for (const b of m.blocks) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.isError ? `Error: ${b.content}` : b.content });
      const text = m.blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

/** Server-sent event data lines from a fetch body. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let k;
    while ((k = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, k).trim();
      buffer = buffer.slice(k + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim();
}

export async function streamNemotron(fetchFn: Fetch, key: string, request: AgentRequest, emit: (e: StreamEvent) => void, signal: AbortSignal): Promise<{ model: string; usage: Usage } | null> {
  const model = request.model || NEMOTRON_DEFAULT_MODEL;
  try {
    const res = await fetchFn(NEMOTRON_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: toNemotronMessages(request.system, request.messages),
        tools: toNemotronTools(request.tools),
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 16384,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok || !res.body) {
      emit(
        res.status === 429
          ? { type: 'error', code: 'rate_limited', message: 'The provider is busy. Try again in a moment.' }
          : res.status === 401 || res.status === 403
            ? { type: 'error', code: 'unavailable', message: 'This provider is not available.' }
            : { type: 'error', code: res.status === 400 ? 'bad_request' : 'internal', message: `The provider returned HTTP ${res.status}.` },
      );
      return null;
    }
    let text = '',
      reasoning = '',
      finish = '';
    const calls: { id: string; name: string; args: string }[] = [];
    const usage: Usage = { input: 0, output: 0 };
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') break;
      let chunk: Record<string, any>;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens ?? 0;
        usage.output = chunk.usage.completion_tokens ?? 0;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (typeof d.reasoning_content === 'string' && d.reasoning_content) {
        reasoning += d.reasoning_content;
        emit({ type: 'thinking', delta: d.reasoning_content });
      }
      if (typeof d.content === 'string' && d.content) {
        text += d.content;
        emit({ type: 'text', delta: d.content });
      }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        if (!calls[i]) {
          calls[i] = { id: tc.id ?? `call_${i}`, name: tc.function?.name ?? '', args: '' };
          if (calls[i].name) emit({ type: 'tool_use_start', id: calls[i].id, name: calls[i].name });
        }
        if (tc.function?.name && !calls[i].name) calls[i].name = tc.function.name;
        if (tc.function?.arguments) calls[i].args += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    const blocks: Block[] = [];
    if (reasoning) blocks.push({ type: 'thinking', text: reasoning, opaque: null });
    if (text) blocks.push({ type: 'text', text });
    for (const c of calls.filter(Boolean)) {
      let input: unknown;
      try {
        input = JSON.parse(c.args || '{}');
      } catch {
        input = { INVALID_JSON: c.args };
      }
      blocks.push({ type: 'tool_use', id: c.id, name: c.name, input });
    }
    const stopReason: StopReason = finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : calls.length ? 'tool_use' : 'end';
    emit({ type: 'message', message: { role: 'assistant', blocks: blocks.length ? blocks : [{ type: 'text', text: '' }] }, stopReason });
    emit({ type: 'usage', usage });
    return { model, usage };
  } catch (e) {
    if (signal.aborted) return null;
    emit({ type: 'error', code: 'network', message: 'Could not reach the provider.' });
    void e;
    return null;
  }
}
