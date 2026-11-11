import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, applyChoice, loadSettings, validSettings } from './settings.ts';

test('defaults, and no palm menu', () => {
  assert.deepEqual(validSettings(null), DEFAULT_SETTINGS);
  assert.ok(!('palmMenu' in DEFAULT_SETTINGS));
});

test('values snap to their allowed choices; unknown keys and bad types are dropped', () => {
  const s = validSettings({ textScale: 1.25, seatHeight: 0.5, volume: 0.6, handedness: 'both', effort: 'max', permission: 'root', palmMenu: true, mute: 'yes' });
  assert.equal(s.textScale, 1.2);
  assert.equal(s.seatHeight, 0.15);
  assert.equal(s.volume, 0.5);
  assert.equal(s.handedness, 'right');
  assert.equal(s.effort, 'medium');
  assert.equal(s.permission, 'workspace');
  assert.equal(s.mute, false);
  assert.ok(!('palmMenu' in s));
});

test('a pinched choice is parsed by the setting type', () => {
  let s = applyChoice(DEFAULT_SETTINGS, 'textScale', '1.4');
  assert.equal(s.textScale, 1.4);
  s = applyChoice(s, 'highContrast', 'true');
  assert.equal(s.highContrast, true);
  s = applyChoice(s, 'handedness', 'left');
  assert.equal(s.handedness, 'left');
  s = applyChoice(s, 'seatHeight', '-0.1');
  assert.equal(s.seatHeight, -0.1);
  assert.equal(applyChoice(s, 'nope', '1'), s);
});

test('stored settings round-trip; damaged ones fall back to the defaults', () => {
  const s = applyChoice(DEFAULT_SETTINGS, 'reduceMotion', 'true');
  assert.deepEqual(loadSettings(JSON.stringify(s)), s);
  assert.deepEqual(loadSettings('{oops'), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
});
