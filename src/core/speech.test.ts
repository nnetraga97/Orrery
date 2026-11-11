import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_CAUGHT, consume, idleSpeech, speechStep } from './speech.ts';
import type { SpeechEvent, SpeechState } from './speech.ts';

const run = (events: SpeechEvent[], from: SpeechState = idleSpeech()) => events.reduce(speechStep, from);

test('press listens; partial text shows; release after a final result is heard', () => {
  let s = run([{ type: 'press', now: 0 }]);
  assert.equal(s.phase, 'listening');
  s = run([{ type: 'partial', text: 'fix' }], s);
  assert.equal(s.text, 'fix');
  s = run([{ type: 'final', text: 'Fix it' }, { type: 'release', now: 900 }], s);
  assert.deepEqual([s.phase, s.text], ['heard', 'Fix it']);
});

test('a final result after the release is still heard', () => {
  const s = run([{ type: 'press', now: 0 }, { type: 'release', now: 500 }, { type: 'tick', now: 1000 }, { type: 'final', text: 'Fix it' }]);
  assert.deepEqual([s.phase, s.text], ['heard', 'Fix it']);
});

test("no final result 1.5 s after release: back to idle with I didn't catch that", () => {
  let s = run([{ type: 'press', now: 0 }, { type: 'partial', text: 'fi' }, { type: 'release', now: 500 }, { type: 'tick', now: 1999 }]);
  assert.equal(s.phase, 'listening');
  s = run([{ type: 'tick', now: 2000 }], s);
  assert.deepEqual([s.phase, s.note], ['idle', NOT_CAUGHT]);
  assert.equal(NOT_CAUGHT, "I didn't catch that");
  // An end of recognition with nothing heard does the same.
  assert.equal(run([{ type: 'press', now: 0 }, { type: 'release', now: 1 }, { type: 'end' }]).note, NOT_CAUGHT);
});

test('permission errors make voice unavailable; other errors go back to idle', () => {
  for (const code of ['not-allowed', 'service-not-allowed']) {
    const s = run([{ type: 'press', now: 0 }, { type: 'error', code }]);
    assert.equal(s.phase, 'unavailable', code);
    // From unavailable, press does nothing.
    assert.equal(run([{ type: 'press', now: 5 }], s).phase, 'unavailable');
  }
  const s = run([{ type: 'press', now: 0 }, { type: 'error', code: 'network' }]);
  assert.equal(s.phase, 'idle');
  assert.equal(s.note, NOT_CAUGHT);
});

test('consume takes the heard text and returns to idle', () => {
  const s = run([{ type: 'press', now: 0 }, { type: 'final', text: 'Fix it' }, { type: 'release', now: 1 }]);
  const [text, next] = consume(s);
  assert.equal(text, 'Fix it');
  assert.equal(next.phase, 'idle');
  assert.deepEqual(consume(idleSpeech()), [null, idleSpeech()]);
});

test('a second press while listening is ignored; press clears an old note', () => {
  const s = run([{ type: 'press', now: 0 }, { type: 'partial', text: 'a' }, { type: 'press', now: 10 }]);
  assert.equal(s.text, 'a');
  assert.equal(run([{ type: 'press', now: 0 }], { ...idleSpeech(), note: NOT_CAUGHT }).note, null);
});
