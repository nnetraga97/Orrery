import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFunctionIndex, classifyPath, planetCap } from './importance.ts';
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
  assert.equal(planetCap(200), 8);
});
