import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromOpenAIOutput, openaiParams, streamOpenAI, toOpenAIInput } from './openai.ts';
import type { OpenAIClient } from './openai.ts';
import { TOOLS } from '../../src/core/agent/tools.ts';
import type { AgentRequest, StreamEvent } from '../../src/core/agent/wire.ts';

const request: AgentRequest = { provider: 'openai', system: 'sys', tools: TOOLS, messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] }] };
const stub = (events: Record<string, any>[] | Error): OpenAIClient => ({
  responses: {
    async create() {
      if (events instanceof Error) throw events;
      return (async function* () {
        yield* events;
      })();
    },
  },
});
const run = async (client: OpenAIClient) => {
  const out: StreamEvent[] = [];
  await streamOpenAI(client, request, e => out.push(e), new AbortController().signal);
  return out;
};
const completed = (output: Record<string, any>[], extra: Record<string, any> = {}) => ({
  type: 'response.completed',
  response: { status: 'completed', model: 'gpt-6-astra', output, usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } }, ...extra },
});

test('the request: stateless, reasoning summaries, the default model', () => {
  const p = openaiParams(request) as Record<string, any>;
  assert.equal(p.model, 'gpt-6-astra');
  assert.equal(p.store, false);
  assert.deepEqual(p.include, ['reasoning.encrypted_content']);
  assert.deepEqual(p.reasoning, { effort: 'medium', summary: 'auto' });
  assert.equal(p.instructions, 'sys');
  assert.equal(p.tools.length, TOOLS.length);
});

test('a text-only turn', async () => {
  const out = await run(stub([{ type: 'response.output_text.delta', delta: 'Hi' }, completed([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }])]));
  assert.deepEqual(out, [
    { type: 'text', delta: 'Hi' },
    { type: 'message', message: { role: 'assistant', blocks: [{ type: 'text', text: 'Hi' }] }, stopReason: 'end' },
    { type: 'usage', usage: { input: 6, output: 3, cacheRead: 4 } },
  ]);
});

test('a turn with two tool calls', async () => {
  const out = await run(
    stub([
      { type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c1', name: 'search' } },
      { type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c2', name: 'read_file' } },
      completed([
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Look first' }], encrypted_content: 'enc' },
        { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{"pattern":"x"}' },
        { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{"path":"a"}' },
      ]),
    ]),
  );
  const m = out.find(e => e.type === 'message');
  assert.ok(m && m.type === 'message' && m.stopReason === 'tool_use');
  assert.deepEqual(m.message.blocks.map(b => b.type), ['thinking', 'tool_use', 'tool_use']);
  assert.deepEqual(out.filter(e => e.type === 'tool_use_start').map(e => e.type === 'tool_use_start' && e.id), ['c1', 'c2']);
});

test('a refusal', async () => {
  const out = await run(stub([completed([{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }] }])]));
  const m = out.find(e => e.type === 'message');
  assert.ok(m && m.type === 'message' && m.stopReason === 'refusal');
});

test("the provider's own rate limit is a busy error", async () => {
  const out = await run(stub(Object.assign(new Error('slow'), { status: 429 })));
  assert.deepEqual(out.map(e => e.type === 'error' && e.code), ['overloaded']);
});

test("another provider's thinking and empty text are left out", () => {
  const input = toOpenAIInput([
    { role: 'assistant', blocks: [{ type: 'thinking', opaque: { type: 'thinking', thinking: 'x', signature: 's' } }, { type: 'thinking', opaque: { recorded: true } }, { type: 'text', text: '' }, { type: 'text', text: 'Hi' }] },
  ]);
  assert.deepEqual(input, [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi' }] }]);
});

test('an assistant message survives the round trip: reasoning items go back unchanged and in order', () => {
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'why' }], encrypted_content: 'enc' };
  const { blocks } = fromOpenAIOutput([reasoning, { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }]);
  const input = toOpenAIInput(JSON.parse(JSON.stringify([{ role: 'assistant', blocks }])));
  assert.deepEqual(input, [reasoning, { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }]);
  assert.deepEqual(toOpenAIInput([{ role: 'user', blocks: [{ type: 'tool_result', toolUseId: 'c1', content: 'text', isError: false }] }]), [{ type: 'function_call_output', call_id: 'c1', output: 'text' }]);
});
