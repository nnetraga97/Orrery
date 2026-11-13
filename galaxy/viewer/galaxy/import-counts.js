// How one file is tied to the others, split by what the import carries. A type-only import vanishes when the code is
// built, so "who depends on this file" means the importers that use its values (re-exports included). A dataset that
// does not classify its imports counts every one as a real use.
export function importCounts(host, i) {
  const real = (s, t) => host.graph.importUse(s, t)?.kind !== 'type';
  const inc = host.data.inc()[i] || [],
    out = host.data.out()[i] || [];
  const inRun = inc.filter(s => real(s, i)).length,
    outRun = out.filter(t => real(i, t)).length;
  return { inRun, inType: inc.length - inRun, outRun, outType: out.length - outRun };
}
