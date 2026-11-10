// Accept only complete versioned layouts. A rejected record is replaced as a unit, never partly trusted.
const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function validLayoutMemory(m) {
  if (!record(m) || m.version !== 1 || (m.layoutVersion != null && m.layoutVersion !== 1)) return false;
  if (!['clusters', 'colors', 'layouts'].every(k => record(m[k]))) return false;
  if (!Object.values(m.clusters).every(v => typeof v === 'string')) return false;
  if (!Object.values(m.colors).every(c => record(c) && Object.values(c).every(v => typeof v === 'string')))
    return false;
  for (const l of Object.values(m.layouts)) {
    if (!record(l) || !record(l.kinds) || !record(l.systems)) return false;
    if (!Object.values(l.kinds).every(k => ['planet', 'asteroid', 'comet'].includes(k))) return false;
    if (
      !Object.values(l.systems).every(
        s =>
          record(s) &&
          Array.isArray(s.at) &&
          s.at.length === 2 &&
          s.at.every(Number.isFinite) &&
          Array.isArray(s.order) &&
          s.order.every(v => typeof v === 'string'),
      )
    )
      return false;
  }
  if (
    m.files != null &&
    (!record(m.files) || !Object.values(m.files).every(f => record(f) && typeof f.path === 'string'))
  )
    return false;
  if (m.towns != null) {
    if (!record(m.towns)) return false;
    for (const towns of Object.values(m.towns)) {
      if (!record(towns)) return false;
      for (const t of Object.values(towns)) {
        if (!record(t) || typeof t.id !== 'string') return false;
        // Retired pad placements and pins never invalidate file or town identities.
      }
    }
  }
  return true;
}
