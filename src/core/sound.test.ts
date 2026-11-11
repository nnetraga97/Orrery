import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_GAIN, lengthOf, soundFor } from './sound.ts';
import type { SoundEvent } from './sound.ts';

const events: SoundEvent[] = ['hover', 'press', 'send', 'replyStarted', 'editAccepted', 'error', 'replayStep'];

test('every sound is quiet and short', () => {
  for (const e of events) {
    const r = soundFor(e, 1, false)!;
    assert.ok(r.gain > 0 && r.gain <= MAX_GAIN, e);
    assert.ok(lengthOf(r) <= 0.3, e);
  }
  // The hover tick is the softest.
  assert.ok(events.every(e => soundFor('hover', 1, false)!.gain <= soundFor(e, 1, false)!.gain));
});

test('an accepted edit is two rising notes; an error is one low note', () => {
  const ok = soundFor('editAccepted', 1, false)!;
  assert.equal(ok.tones.length, 2);
  assert.ok(ok.tones[1].frequency > ok.tones[0].frequency && ok.tones[1].start > ok.tones[0].start);
  const err = soundFor('error', 1, false)!;
  assert.equal(err.tones.length, 1);
  assert.ok(err.tones[0].frequency < 300);
});

test('volume scales the gain; mute and zero volume are silent', () => {
  assert.equal(soundFor('press', 0.5, false)!.gain, soundFor('press', 1, false)!.gain / 2);
  assert.equal(soundFor('press', 1, true), null);
  assert.equal(soundFor('press', 0, false), null);
  assert.equal(soundFor('press', 7, false)!.gain, soundFor('press', 1, false)!.gain);
});
