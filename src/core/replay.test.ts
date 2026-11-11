import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReplay, replayErrors } from './replay.ts';
import type { ReplayData } from './replay.ts';

const root = new URL('../../', import.meta.url);
const load = (name: string) => JSON.parse(fs.readFileSync(new URL(`public/scenarios/${name}`, root), 'utf8')) as ReplayData;
const lines = (file: string) => {
  try {
    return fs.readFileSync(new URL(`public/data/editor-core/source/${file}`, root), 'utf8').split('\n').length;
  } catch {
    return null;
  }
};

test('both recorded runs name real files and lines', () => {
  for (const name of ['range-edge.failing.json', 'range-edge.fixed.json']) assert.deepEqual(replayErrors(load(name), lines), [], name);
});

test('the failing run returns false with the expected note; the fixed run returns true', () => {
  const failing = load('range-edge.failing.json'),
    fixed = load('range-edge.fixed.json');
  assert.equal(failing.outcome, 'fails');
  assert.equal(failing.steps.at(-1)!.note, 'Expected true: the end edge counts as inside');
  assert.ok(failing.steps.at(-1)!.variables.some(v => v.name === 'result' && v.value === 'false'));
  assert.equal(fixed.outcome, 'passes');
  assert.ok(fixed.steps.at(-1)!.variables.some(v => v.name === 'result' && v.value === 'true'));
  // The steps are the scenario's call: (3, 9) in (3, 1)–(3, 9).
  assert.ok(failing.steps[0].variables.some(v => v.value === '(3, 9)'));
});

test('validation finds missing files and lines past the end', () => {
  const bad = { title: 't', outcome: 'fails', steps: [{ file: 'nope.ts', line: 1, label: 'x', stack: [{ file: 'core/range.ts', line: 99999, label: 'y' }], variables: [] }] };
  assert.deepEqual(replayErrors(bad, lines), ['step 1: there is no file nope.ts', 'step 1 frame 1: line 99999 is not in core/range.ts (' + lines('core/range.ts') + ' lines)']);
});

test('step, back, restart and the end', () => {
  const r = createReplay(load('range-edge.failing.json'));
  assert.equal(r.index, 0);
  r.back();
  assert.equal(r.index, 0);
  r.step();
  r.step();
  assert.equal(r.index, 2);
  r.back();
  assert.equal(r.index, 1);
  while (!r.atEnd()) r.step();
  r.step();
  assert.equal(r.index, r.data.steps.length - 1);
  r.restart();
  assert.equal(r.index, 0);
});

test('play advances one step per interval by the clock given, and stops at the end', () => {
  const r = createReplay(load('range-edge.fixed.json'));
  r.play(1000, 0);
  assert.equal(r.tick(999), false);
  assert.equal(r.tick(1000), true);
  assert.equal(r.index, 1);
  for (let t = 2000; t < 10000; t += 1000) r.tick(t);
  assert.ok(r.atEnd());
  assert.equal(r.playing, false);
  // Play at the end starts again from the top.
  r.play(500, 0);
  assert.equal(r.index, 0);
});
