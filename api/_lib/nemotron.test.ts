import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEMOTRON_ENDPOINT, streamNemotron, toNemotronMessages } from './nemotron.ts';
import { TOOLS } from '../../src/core/agent/tools.ts';
import type { AgentRequest, StreamEvent } from '../../src/core/agent/wire.ts';

const request: AgentRequest = { provider: 'nemotron', system: 'sys', tools: TOOLS, messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] }] };
const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      c.close();
    },
  }), { status: 200 });
const run = async (response: Response, seen: { url?: string; body?: any; auth?: string } = {}) => {
  const out: StreamEvent[] = [];
  await streamNemotron(
    async (url, init) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).Authorization;
      return response;
    },
    'test-key',
    request,
    e => out.push(e),
    new AbortController().signal,
  );
  return out;
};

test('a text-only turn, sent to the Token Factory endpoint with the key as a bearer token', async () => {
  const seen: { url?: string; body?: any; auth?: string } = {};
  const out = await run(sse([{ choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }]), seen);
  assert.equal(seen.url, NEMOTRON_ENDPOINT);
  assert.equal(seen.auth, 'Bearer test-key');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.messages[0].role, 'system');
  assert.deepEqual(out, [
    { type: 'text', delta: 'Hel' },
    { type: 'text', delta: 'lo' },
    { type: 'message', message: { role: 'assistant', blocks: [{ type: 'text', text: 'Hello' }] }, stopReason: 'end' },
    { type: 'usage', usage: { input: 5, output: 2 } },
  ]);
});

test('a turn with two tool calls streamed in pieces', async () => {
  const out = await run(
    sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'search', arguments: '{"pat' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'tern":"x"}' } }, { index: 1, id: 'b', function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }] },
    ]),
  );
  const m = out.find(e => e.type === 'message');
  assert.ok(m && m.type === 'message' && m.stopReason === 'tool_use');
  assert.deepEqual(m.message.blocks, [
    { type: 'tool_use', id: 'a', name: 'search', input: { pattern: 'x' } },
    { type: 'tool_use', id: 'b', name: 'read_file', input: { path: 'a' } },
  ]);
});

test('a refusal (content filter) and a rate-limit error', async () => {
  const refused = await run(sse([{ choices: [{ delta: { content: 'No.' }, finish_reason: 'content_filter' }] }]));
  assert.ok(refused.some(e => e.type === 'message' && e.stopReason === 'refusal'));
  const limited = await run(new Response('slow down', { status: 429 }));
  assert.deepEqual(limited.map(e => e.type === 'error' && e.code), ['rate_limited']);
});

test('an assistant message survives the round trip as Chat Completions messages', () => {
  const msgs = toNemotronMessages('sys', [
    { role: 'user', blocks: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', blocks: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'a', name: 'read_file', input: { path: 'x' } }] },
    { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 'a', content: 'text', isError: false }, { type: 'text', text: 'and explain' }] },
  ]);
  assert.deepEqual(msgs.slice(1), [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'text' },
    { role: 'user', content: 'and explain' },
  ]);
});
