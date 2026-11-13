import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_BETA, claudeParams, fromClaudeContent, strictSchema, streamClaude, toClaudeMessages } from './claude.ts';
import type { ClaudeClient } from './claude.ts';
import { TOOLS } from '../../src/core/agent/tools.ts';
import type { AgentRequest, Message, StreamEvent } from '../../src/core/agent/wire.ts';

const request = (messages: Message[] = [{ role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] }]): AgentRequest => ({
  provider: 'claude',
  system: 'You are a coding agent.',
  tools: TOOLS,
  messages,
});

/** A stub client that streams the given events and ends with the given message. */
function stub(events: Record<string, any>[], final: Record<string, any> | Error, seen: Record<string, unknown>[] = []): ClaudeClient {
  return {
    beta: {
      messages: {
        stream(params) {
          seen.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              if (final instanceof Error) throw final;
              yield* events;
            },
            finalMessage: async () => final as Record<string, any>,
          };
        },
      },
    },
  };
}
const run = async (client: ClaudeClient, req = request()) => {
  const out: StreamEvent[] = [];
  await streamClaude(client, req, e => out.push(e), new AbortController().signal);
  return out;
};

test('the request: adaptive thinking shown, explicit effort, strict eager tools, fallbacks, caching', () => {
  const p = claudeParams(request()) as Record<string, any>;
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 64000);
  assert.deepEqual(p.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(p.output_config, { effort: 'medium' });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, [FALLBACK_BETA]);
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.ok(p.tools.every((t: any) => t.strict === true && t.eager_input_streaming === true));
  assert.deepEqual(p.tools.at(-1).cache_control, { type: 'ephemeral' });
  assert.equal(p.tools.filter((t: any) => t.cache_control).length, 1);
  // Byte-stable: the same request makes the same system and tools.
  assert.equal(JSON.stringify(claudeParams(request()).tools), JSON.stringify(p.tools));
  assert.equal((claudeParams({ ...request(), effort: 'high', model: 'claude-sonnet-5-5' }) as any).output_config.effort, 'high');
  assert.equal((claudeParams({ ...request(), model: 'something-else' }) as any).model, 'claude-opus-5-5');
});

test('strict schemas drop the keywords strict tools reject', () => {
  const s = strictSchema({ type: 'object', properties: { a: { type: 'string', minLength: 1, maxLength: 9 }, n: { type: 'integer', minimum: 1 }, l: { type: 'array', maxItems: 8, minItems: 1, items: { type: 'string' } } }, required: ['a'], additionalProperties: false });
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'string' }, n: { type: 'integer' }, l: { type: 'array', minItems: 1, items: { type: 'string' } } }, required: ['a'], additionalProperties: false });
  assert.ok(!JSON.stringify(claudeParams(request()).tools).match(/maxLength|minimum|maxItems/));
});

test('a text-only turn', async () => {
  const out = await run(
    stub(
      [
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      ],
      { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello' }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5 } },
    ),
  );
  assert.deepEqual(out, [
    { type: 'text', delta: 'Hel' },
    { type: 'text', delta: 'lo' },
    { type: 'message', message: { role: 'assistant', blocks: [{ type: 'text', text: 'Hello' }] }, stopReason: 'end' },
    { type: 'usage', usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 0 } },
  ]);
});

test('a turn with two tool calls and thinking', async () => {
  const thinking = { type: 'thinking', thinking: 'Look first.', signature: 'sig' };
  const out = await run(
    stub(
      [
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Look first.' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'search', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern":"x"}' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't2', name: 'read_file', input: {} } },
      ],
      {
        stop_reason: 'tool_use',
        content: [thinking, { type: 'tool_use', id: 't1', name: 'search', input: { pattern: 'x' } }, { type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'a' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ),
  );
  // A tool's input has nothing to show, but says the call is alive.
  assert.deepEqual(out.slice(0, 4), [
    { type: 'thinking', delta: 'Look first.' },
    { type: 'tool_use_start', id: 't1', name: 'search' },
    { type: 'progress' },
    { type: 'tool_use_start', id: 't2', name: 'read_file' },
  ]);
  const message = out[4];
  assert.ok(message.type === 'message' && message.stopReason === 'tool_use');
  assert.deepEqual(message.message.blocks.map(b => b.type), ['thinking', 'tool_use', 'tool_use']);
});

test('a refusal with no content still makes a valid message', async () => {
  const out = await run(stub([], { stop_reason: 'refusal', content: [], usage: {} }));
  const m = out.find(e => e.type === 'message');
  assert.ok(m && m.type === 'message' && m.stopReason === 'refusal' && m.message.blocks.length === 1);
});

test("the provider's own rate limit is a busy error, not the relay's visitor limit", async () => {
  const err = Object.assign(new Error('429'), { status: 429 });
  const out = await run(stub([], err));
  assert.deepEqual(out.map(e => e.type === 'error' && e.code), ['overloaded']);
});

test("another provider's thinking and empty text are not sent; a message never goes empty", () => {
  const sent = toClaudeMessages([
    { role: 'user', blocks: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', blocks: [{ type: 'thinking', text: 'x', opaque: { recorded: true } }, { type: 'thinking', opaque: null }, { type: 'thinking', opaque: { type: 'reasoning', id: 'rs_1' } }, { type: 'text', text: '' }] },
  ]);
  assert.deepEqual(sent[1].content, [{ type: 'text', text: '…' }]);
});

test('an assistant message survives the round trip unchanged, thinking signature included', () => {
  const content = [
    { type: 'thinking', thinking: 'why', signature: 'abc' },
    { type: 'redacted_thinking', data: 'xyz' },
    { type: 'text', text: 'Here.' },
    { type: 'tool_use', id: 't', name: 'read_file', input: { path: 'a.ts' } },
  ];
  const blocks = fromClaudeContent(content);
  const back = toClaudeMessages([{ role: 'assistant', blocks }])[0].content;
  assert.deepEqual(back, content);
  // And through JSON, as it travels between server and browser.
  assert.deepEqual(toClaudeMessages(JSON.parse(JSON.stringify([{ role: 'assistant', blocks }])))[0].content, content);
});
