// The constellation layout (viewer/galaxy/galaxy-layout.js): folders become arms, a folder holding most of the groups splits
// into its subfolders, systems never overlap or crowd the cannon, and along an arm the group the others import takes
// the innermost spot. Offline; plain arrays.
import assert from 'node:assert/strict';
import { folderArms, layoutGalaxy } from '../viewer/galaxy/galaxy-layout.js';

const files = (dir, names) => names.map(name => `${dir}/${name}`);
const groupFiles = [
  files('src/core', ['a.ts', 'b.ts', 'c.ts']), // 0: imported by everything
  files('src/core', ['d.ts', 'e.ts']),
  files('src/core', ['f.ts', 'g.ts']),
  files('src/ui', ['a.tsx', 'b.tsx', 'c.tsx']), // 3: imported by the rest of ui
  files('src/ui/panels', ['x.tsx', 'y.tsx']),
  files('src/ui', ['d.tsx', 'e.tsx']),
  files('src/net', ['http.ts', 'ws.ts']),
  files('test', ['a.test.ts', 'b.test.ts']),
  ['scripts/build.mjs'],
];
const arms = folderArms(groupFiles);
assert.deepEqual(
  Object.fromEntries(arms.map(arm => [arm.name, [...arm.members].sort()])),
  { 'src/core': [0, 1, 2], 'src/ui': [3, 4, 5], 'src/net': [6], test: [7], scripts: [8] },
  'src holds most groups, so its subfolders are arms; the rest stay top-level folders',
);
// No folder dominates three groups in three folders: they stay three arms.
assert.deepEqual(
  folderArms([['a/x.ts'], ['b/x.ts'], ['c/x.ts']]).map(arm => arm.name),
  ['a', 'b', 'c'],
);

const links = [
  [1, 0, 6],
  [2, 0, 4],
  [4, 3, 5],
  [5, 3, 3],
  [3, 0, 8],
  [6, 0, 5],
  [7, 3, 4],
  [7, 0, 2],
].map(([a, b, w]) => ({ a, b, w }));
const groups = groupFiles.map(f => ({ reach: 6 + 2 * f.length }));
const options = { arms, keepOut: 20, gap: 3 };
const galaxy = layoutGalaxy(groups, links, options);
const r = gi => Math.hypot(...galaxy.centers[gi]);
groups.forEach((g, a) => {
  assert.ok(r(a) >= options.keepOut + g.reach - 1e-6, `system ${a} keeps out of the cannon's surroundings`);
  for (let b = a + 1; b < groups.length; b++) {
    const d = Math.hypot(galaxy.centers[a][0] - galaxy.centers[b][0], galaxy.centers[a][1] - galaxy.centers[b][1]);
    assert.ok(d >= g.reach + groups[b].reach + options.gap - 1e-6, `systems ${a} and ${b} do not overlap`);
  }
});
// The group the others import takes the arm's innermost spot; smaller groups may share that ring beside it.
const inner = gi => r(gi) - groups[gi].reach;
assert.ok(Math.abs(inner(0) - options.keepOut) < 1e-6 && inner(0) <= Math.min(inner(1), inner(2)) + 1e-6, 'core');
assert.ok(Math.abs(inner(3) - options.keepOut) < 1e-6 && inner(3) <= Math.min(inner(4), inner(5)) + 1e-6, 'ui');
assert.deepEqual(
  galaxy.arms.map(arm => arm.name),
  arms.map(arm => arm.name),
  'arms keep their order, so their colours match',
);
galaxy.arms.forEach(arm =>
  assert.ok(
    arm.members.every(gi => Math.hypot(...arm.at) > r(gi)),
    `${arm.name}'s name sits beyond its systems`,
  ),
);
assert.ok(galaxy.extent >= Math.max(...groups.map((g, gi) => r(gi) + g.reach)) - 1e-6);
assert.deepEqual(layoutGalaxy(groups, links, options), galaxy, 'the same graph lays out the same way');
assert.deepEqual(layoutGalaxy([], [], { arms: [], keepOut: 20, gap: 3 }), { centers: [], arms: [], extent: 0 });

// Remembered centres: the same galaxy lays out the same way, a new system fits around the old ones without moving
// them, and a system that grew moves straight outward until it is clear again.
const fixed = galaxy.centers;
assert.deepEqual(layoutGalaxy(groups, links, { ...options, fixed }).centers, fixed, 'remembered centres stay');
const clear = (centers, reaches) => {
  centers.forEach((c, a) => {
    assert.ok(Math.hypot(...c) >= options.keepOut + reaches[a] - 1e-6);
    for (let b = a + 1; b < centers.length; b++)
      assert.ok(Math.hypot(c[0] - centers[b][0], c[1] - centers[b][1]) >= reaches[a] + reaches[b] + options.gap - 1e-6);
  });
};
const grownFiles = [...groupFiles, files('src/ui', ['f.tsx', 'g.tsx'])];
const grown = layoutGalaxy([...groups, { reach: 10 }], links, { ...options, arms: folderArms(grownFiles), fixed });
assert.deepEqual(grown.centers.slice(0, groups.length), fixed, 'a new system does not move the others');
clear(grown.centers, [...groups.map(g => g.reach), 10]);
const bigger = groups.map((g, gi) => (gi === 0 ? { reach: g.reach * 2.5 } : g));
const pushed = layoutGalaxy(bigger, links, { ...options, fixed });
clear(
  pushed.centers,
  bigger.map(g => g.reach),
);
const angle = ([x, z]) => Math.atan2(z, x);
pushed.centers.forEach((c, gi) => {
  assert.ok(Math.abs(angle(c) - angle(fixed[gi])) < 1e-9, `system ${gi} keeps its direction`);
  assert.ok(Math.hypot(...c) >= Math.hypot(...fixed[gi]) - 1e-9, `system ${gi} only moves outward`);
});

console.log(JSON.stringify({ arms: arms.map(arm => arm.name), extent: +galaxy.extent.toFixed(1) }));
