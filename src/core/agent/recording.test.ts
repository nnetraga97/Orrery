import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecording } from './recording.ts';
import { recordedReply } from './recorded.ts';
import type { Message } from './wire.ts';

const reply = (blocks: Message['blocks']): Message => ({ role: 'assistant', blocks });

test('a recording replays through recordedReply turn by turn', () => {
  const r = createRecording('live-run');
  r.reply(reply([{ type: 'text', text: 'Searching.' }, { type: 'tool_use', id: 't1', name: 'search', input: { pattern: 'x' } }]), 'tool_use');
  r.reply(reply([{ type: 'text', text: 'Found it.' }]), 'end');
  const session = r.session('A live run.');
  assert.equal(session.note, 'A live run.');
  assert.equal(session.turns.length, 2);
  // No tool results yet: the first turn; one result: the second.
  assert.equal(recordedReply(session, [{ role: 'user', blocks: [{ type: 'text', text: 'Go' }] }]).stopReason, 'tool_use');
  const second = recordedReply(session, [
    { role: 'user', blocks: [{ type: 'text', text: 'Go' }] },
    session.turns[0] && { role: 'assistant', blocks: session.turns[0].blocks },
    { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 't1', content: 'hit', isError: false }] },
  ] as Message[]);
  assert.equal(second.stopReason, 'end');
});

test("thinking keeps its text but not the provider's opaque data", () => {
  const r = createRecording('x');
  r.reply(reply([{ type: 'thinking', text: 'Hmm', opaque: { signature: 'secret-ish' } }]), 'end');
  assert.deepEqual(r.session('').turns[0].blocks[0], { type: 'thinking', text: 'Hmm', opaque: { recorded: true } });
  assert.ok(!JSON.stringify(r.session('')).includes('secret-ish'));
});

test('cacheHit is true once a later request reads from the cache', () => {
  const r = createRecording('x');
  r.usage({ input: 900, output: 50, cacheRead: 0, cacheWrite: 4000 }, 1);
  assert.equal(r.cacheHit(), false);
  r.usage({ input: 120, output: 40, cacheRead: 4000, cacheWrite: 0 }, 2);
  assert.equal(r.cacheHit(), true);
  assert.equal(r.usageLog.length, 2);
});
