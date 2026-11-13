// What the galaxy's shapes, sizes and colours mean, in the words the Settings tab shows. Each line names one thing the
// user sees and the measure behind it; the drawing code that makes it true is named beside each group.

export interface KeyGroup {
  title: string;
  lines: readonly string[];
}

export const KEY: readonly KeyGroup[] = [
  {
    // galaxy/viewer/galaxy/constellation-orbits.js (starRadius), star-bodies.js (shine)
    title: 'Stars are files',
    lines: ['Size: lines of code.', 'Glow: how many files import it.', 'Colour: its folder.'],
  },
  {
    // planet-orbits.js (planetSize), planet-profiles.js (gradeWorld), src/core/importance.ts (gradeOf, scoreOf)
    title: 'Planets are functions',
    lines: [
      'Size: lines of code.',
      'Look: an ocean world is straightforward, pale is some branching, dark and cratered is tangled, red is very tangled.',
      'The inner orbits hold the functions that matter most.',
    ],
  },
  {
    // constellation-fleet.js (import lanes), function-planets.js (call lanes), traffic/call-routes.js (landed arcs)
    title: 'Lines',
    lines: ['Warm: what the selection imports or calls.', 'Cool: what imports or calls it.', 'Dashed: an import of types only.'],
  },
  {
    // towns/town-layout.js (roads), towns/town-ground.js (nesting tint)
    title: 'On a planet',
    lines: [
      'The road is the function, from top to bottom.',
      'A fork is an if, a ring is a loop, each building is a statement.',
      'Shaded ground is nested code: amber is three deep, orange is deeper.',
    ],
  },
];
