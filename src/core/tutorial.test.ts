import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIAL_STEPS, TUTORIAL_TEXT, nextStep, tutorialText } from './tutorial.ts';
import type { TutorialEvent, TutorialStep } from './tutorial.ts';

test('the steps run point, turn, open, read, done', () => {
  assert.deepEqual(TUTORIAL_STEPS, ['point', 'turn', 'open', 'read', 'done']);
});

test('each step advances on its own event', () => {
  const path: [TutorialStep, TutorialEvent, TutorialStep][] = [
    ['point', 'selected', 'turn'],
    ['turn', 'orbited', 'open'],
    ['open', 'landed', 'read'],
    ['read', 'codeShown', 'done'],
  ];
  for (const [from, event, to] of path) assert.equal(nextStep(from, event), to);
});

test("another step's event leaves the step unchanged", () => {
  assert.equal(nextStep('point', 'orbited'), 'point');
  assert.equal(nextStep('turn', 'landed'), 'turn');
  assert.equal(nextStep('read', 'selected'), 'read');
  assert.equal(nextStep('done', 'selected'), 'done');
});

test('skip goes to done from anywhere', () => {
  for (const step of TUTORIAL_STEPS) assert.equal(nextStep(step, 'skip'), 'done');
});

test('unknown events leave the step unchanged', () => {
  assert.equal(nextStep('turn', 'wave' as TutorialEvent), 'turn');
});

test('every step says what to do in twelve words or fewer', () => {
  for (const step of TUTORIAL_STEPS.filter(s => s !== 'done')) {
    const words = TUTORIAL_TEXT[step].split(/\s+/).filter(Boolean).length;
    assert.ok(words > 0 && words <= 12, `${step}: ${words} words`);
  }
});

test('with gaze the pointing steps say look, and stay within twelve words', () => {
  assert.equal(tutorialText('point', false), TUTORIAL_TEXT.point);
  assert.match(tutorialText('point', true), /^Look at /);
  assert.match(tutorialText('read', true), /^Look at /);
  assert.equal(tutorialText('turn', true), TUTORIAL_TEXT.turn);
  for (const step of TUTORIAL_STEPS.filter(s => s !== 'done'))
    assert.ok(tutorialText(step as 'point', true).split(/\s+/).length <= 12);
});
