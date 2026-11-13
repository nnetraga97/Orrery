// What a function planet's card says: the measures behind its look (grade), its size (lines) and its call lanes.
// `grade` is the grade in words, or null for a dataset without measures, which then gives the line range alone.
const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function planetFacts(p, grade) {
  const lines = p.end - p.start + 1;
  if (!grade) return [`Lines ${p.start}–${p.end} · ${count(lines, 'line')}`];
  // Three lines, each short enough for the room's card to show whole (about 27 characters).
  const branches = count(p.branches, 'branch', 'branches');
  let shape = `${branches} · ${p.depth ? `nested ${p.depth} deep` : 'no nesting'}`;
  if (shape.length > 27) shape = `${branches} · ${p.depth} deep`;
  return [`${grade} · ${count(lines, 'line')}`, shape, `Called by ${p.callers} · calls ${p.callees}`];
}
