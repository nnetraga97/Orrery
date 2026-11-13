import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRADES, buildFunctionIndex, classifyPath, gradeOf, nestingDepth, planetCap } from './importance.ts';
import type { Shard, ShardMember } from './importance.ts';

const fn = (id: string, start: number, end: number, extra: Partial<ShardMember> = {}): ShardMember => ({
  id,
  name: id.split('#')[1],
  kind: 'function',
  start,
  end,
  ...extra,
});

test('a big branchy function is a planet; a getter and a one-liner are not', () => {
  const shard: Shard = {
    path: 'a.ts',
    decls: [
      { ...fn('a.ts#big', 1, 60, { branches: 12, exported: true }) },
      { ...fn('a.ts#tiny', 61, 62) },
      {
        id: 'a.ts#C',
        name: 'C',
        kind: 'class',
        start: 63,
        end: 80,
        exported: true,
        members: [{ ...fn('a.ts#C.v', 64, 66, { kind: 'get', owner: 'C', name: 'v' }) }],
      },
    ],
  };
  const index = buildFunctionIndex([shard]);
  assert.equal(index.files[0].cls, 'star');
  assert.deepEqual(
    index.files[0].planets.map(p => p.name),
    ['big'],
  );
  assert.equal(index.files[0].hidden, 2);
});

test('a short function called from many files is a planet; calls between planets are kept', () => {
  const hub = fn('h.ts#hub', 1, 2);
  const callers: Shard[] = Array.from({ length: 5 }, (_, k) => ({
    path: `c${k}.ts`,
    decls: [
      fn(`c${k}.ts#work`, 1, 40, {
        branches: 6,
        callTargets: [{ id: 'h.ts#hub' }],
      }),
    ],
  }));
  const index = buildFunctionIndex([{ path: 'h.ts', decls: [hub] }, ...callers]);
  assert.equal(index.files[0].cls, 'star');
  assert.deepEqual(
    index.files[0].planets.map(p => p.name),
    ['hub'],
  );
  assert.equal(index.calls.length, 5);
});

test('pins always show; files without callables are types-only; library paths are skipped', () => {
  const index = buildFunctionIndex(
    [
      { path: 'r.ts', decls: [fn('r.ts#small', 1, 2)] },
      { path: 'types.ts', decls: [] },
      {
        path: 'node_modules/x/index.ts',
        decls: [fn('n#big', 1, 90, { branches: 20 })],
      },
    ],
    ['r.ts:small'],
  );
  assert.deepEqual(
    index.files.map(f => f.cls),
    ['star', 'types-only', 'library'],
  );
  assert.equal(index.files[0].planets[0].pinned, true);
  assert.equal(index.files[2].planets.length, 0);
});

test('paths and caps', () => {
  assert.equal(classifyPath('src/foo.test.ts'), 'test');
  assert.equal(classifyPath('lib/x.d.ts'), 'library');
  assert.equal(classifyPath('src/foo.ts'), null);
  assert.equal(planetCap(4), 4);
  assert.equal(planetCap(200), 10);
});

test('nesting depth counts if, loop, switch and try, and an else-if ladder stays at one depth', () => {
  const stmt = { t: 'stmt' };
  assert.equal(nestingDepth([stmt, stmt]), 0);
  assert.equal(nestingDepth([{ t: 'if', then: [stmt] }]), 1);
  assert.equal(nestingDepth([{ t: 'block', body: [{ t: 'loop', body: [{ t: 'if', then: [stmt], else: [stmt] }] }] }]), 2);
  // if … else if … else if: one decision continued, not three levels.
  const ladder = { t: 'if', then: [stmt], else: [{ t: 'if', then: [stmt], else: [{ t: 'if', then: [stmt] }] }] };
  assert.equal(nestingDepth([ladder]), 1);
  // An else holding more than a single if is real nesting.
  assert.equal(nestingDepth([{ t: 'if', then: [stmt], else: [stmt, { t: 'if', then: [stmt] }] }]), 2);
  assert.equal(nestingDepth([{ t: 'switch', cases: [[stmt], [{ t: 'try', body: [stmt], handler: [{ t: 'loop', body: [stmt] }] }]] }]), 3);
  assert.equal(nestingDepth(undefined), 0);
});

test('grades follow depth, and a very high branch count raises a flat function only so far', () => {
  assert.equal(gradeOf(0, 0), 0);
  assert.equal(gradeOf(1, 4), 0);
  assert.equal(gradeOf(2, 3), 1);
  assert.equal(gradeOf(4, 3), 2);
  assert.equal(gradeOf(5, 3), 3);
  // Flat code full of `||` defaults is busy, not very tangled.
  assert.equal(gradeOf(0, 37), 2);
  assert.equal(gradeOf(1, 12), 1);
  assert.equal(GRADES.length, 4);
});

test('a planet carries its measures, and its file counts every function by grade', () => {
  const stmt = { t: 'stmt' };
  const deep = { t: 'loop', body: [{ t: 'if', then: [{ t: 'loop', body: [{ t: 'if', then: [{ t: 'try', body: [stmt] }] }] }] }] };
  const shard: Shard = {
    path: 'a.ts',
    decls: [
      fn('a.ts#knot', 1, 80, { branches: 9, exported: true, params: 3, flow: { body: [deep] }, callTargets: [{ id: 'a.ts#flat' }] }),
      fn('a.ts#flat', 81, 120, { branches: 2, exported: true, params: 1, flow: { body: [stmt, { t: 'if', then: [stmt] }] } }),
      fn('a.ts#tiny', 121, 122),
    ],
  };
  const file = buildFunctionIndex([shard]).files[0];
  const knot = file.planets.find(p => p.name === 'knot')!;
  assert.deepEqual(
    { branches: knot.branches, depth: knot.depth, params: knot.params, callers: knot.callers, callees: knot.callees, grade: knot.grade },
    { branches: 9, depth: 5, params: 3, callers: 0, callees: 1, grade: 3 },
  );
  const flat = file.planets.find(p => p.name === 'flat')!;
  assert.equal(flat.callers, 1);
  assert.equal(flat.grade, 0);
  assert.deepEqual(file.grades, [2, 0, 0, 1]);
  assert.deepEqual(file.rest, []);
});
