import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyBreak, isBroken, isFixed, validateScenario } from './scenario.ts';

const json = JSON.parse(fs.readFileSync(new URL('../../public/scenarios/range-edge.json', import.meta.url), 'utf8'));
const source = fs.readFileSync(new URL('../../public/data/editor-core/source/core/range.ts', import.meta.url), 'utf8');

test('the range-edge scenario is valid', () => {
  const result = validateScenario(json);
  assert.ok(result.ok, JSON.stringify(result));
});

test('its patch and its broken text each match exactly once, inside containsPosition', () => {
  const s = validateScenario(json);
  assert.ok(s.ok);
  assert.equal(source.split(s.scenario.breakPatch.old).length - 1, 1);
  // The strict version already has the `>=` line: the broken text must still be unique, or "fixed" could not be told.
  assert.equal(source.split(s.scenario.breakPatch.new).length - 1, 0);
  const broken = applyBreak(s.scenario, source);
  assert.ok(!isFixed(s.scenario, broken));
  assert.ok(isBroken(s.scenario, broken));
  assert.ok(isFixed(s.scenario, source));
  // A change that only removes the broken text is not a fix: the original must be back.
  const wrong = broken.replace('position.column >= range.endColumn) {\n\t\t\treturn false;\n\t\t}\n\t\treturn true;', 'position.column < range.endColumn) {\n\t\t\treturn false;\n\t\t}\n\t\treturn true;');
  assert.notEqual(wrong, broken);
  assert.ok(!isBroken(s.scenario, wrong));
  assert.ok(!isFixed(s.scenario, wrong));
  // The changed line is the scenario's line, inside the static containsPosition.
  const lines = broken.split('\n');
  assert.ok(lines[s.scenario.line - 1].includes('position.column >= range.endColumn'));
  const fn = lines.findIndex(l => l.includes('public static containsPosition('));
  const end = lines.findIndex((l, k) => k > fn && l === '\t}');
  assert.ok(fn < s.scenario.line - 1 && s.scenario.line - 1 < end);
});

test('a patch that matches twice is refused', () => {
  const s = validateScenario(json);
  assert.ok(s.ok);
  assert.throws(() => applyBreak(s.scenario, source + source), /matches 2 places/);
});

test('validation lists what is missing', () => {
  const result = validateScenario({ id: 'x' });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.includes('dataset must be a non-empty string'));
});
