import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimits } from './limits.ts';
import { providerList } from './providers.ts';
import { MAX_BODY_BYTES, createRelay } from './relay.ts';
import type { Adapter } from './relay.ts';
import { TOOLS } from '../../src/core/agent/tools.ts';

const good = { provider: 'claude', system: 's', tools: TOOLS, messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] }] };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://local/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const events = async (res: Response) =>
  (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map(chunk => JSON.parse(chunk.replace(/^data: /, '')));
const echo: Adapter = async (_req, emit) => {
  emit({ type: 'text', delta: 'ok' });
  emit({ type: 'message', message: { role: 'assistant', blocks: [{ type: 'text', text: 'ok' }] }, stopReason: 'end' });
  return { model: 'claude-opus-5-5', usage: { input: 1000, output: 1000 } };
};
const relay = (env: Record<string, string> = { ANTHROPIC_API_KEY: 'k' }, limits = createLimits()) => ({ limits, handler: createRelay({ env, limits, adapter: () => echo }) });

test('a valid request streams the adapter events and counts its cost', async () => {
  const { handler, limits } = relay();
  const res = await handler(post(good));
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.deepEqual((await events(res)).map(e => e.type), ['text', 'message']);
  assert.ok(limits.spentToday > 0);
});

test('bad requests are refused: not JSON, invalid wire, other tools, over 2 MB, not POST', async () => {
  const { handler } = relay();
  assert.equal((await handler(post('nope'))).status, 400);
  assert.equal((await handler(post({ ...good, messages: [] }))).status, 400);
  assert.equal((await handler(post({ ...good, tools: [{ name: 'shell', description: 'x', input_schema: {} }] }))).status, 400);
  const huge = { ...good, system: 'x'.repeat(MAX_BODY_BYTES) };
  assert.equal((await handler(post(huge))).status, 413);
  assert.equal((await handler(new Request('http://local/api/agent'))).status, 405);
});

test('a provider without a key answers with the unavailable error', async () => {
  const { handler } = relay({});
  assert.deepEqual((await events(await handler(post(good))))[0].code, 'unavailable');
});

test('over the rate limit or the budget, an error event (the browser falls back to the recorded agent)', async () => {
  const limits = createLimits({ budgetCents: 1 });
  limits.spend(5);
  const { handler } = relay({ ANTHROPIC_API_KEY: 'k' }, limits);
  assert.equal((await events(await handler(post(good))))[0].code, 'budget_spent');
  const { handler: h2 } = relay();
  let last: any = null;
  for (let i = 0; i < 31; i++) last = await events(await h2(post(good, { 'x-forwarded-for': '9.9.9.9' })));
  assert.equal(last[0].code, 'rate_limited');
});

test('the provider list says which keys are present and holds no key material', () => {
  const list = providerList({ ANTHROPIC_API_KEY: 'secret-value' });
  assert.deepEqual(list.map(p => [p.id, p.available]), [['claude', true], ['openai', false], ['nemotron', false]]);
  assert.ok(!JSON.stringify(list).includes('secret-value'));
});
