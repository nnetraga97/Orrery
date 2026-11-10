// "About this view and legend": what the current view shows, the group legend and counts.
import { useMemo } from 'react';
import type { ViewName } from '../state.ts';
import { INFO } from '../views.js';
import { useStore } from './use-store.ts';

const VIEW_INFO = INFO as Record<ViewName, [title: string, description: string]>;
const LEGEND_LIMIT = 24;

export function ViewInfo() {
  const current = useStore('current');
  const [title, description] = VIEW_INFO[current];
  return (
    <>
      <h2 id="title">{title}</h2>
      <p id="desc">{description}</p>
      {/* Filled by the constellation with its own key (constellation.js). */}
      <div id="legendExtra" />
      <Legend />
      <Stats />
    </>
  );
}

function Legend() {
  const groups = useStore('groups');
  const color = useStore('color');
  const nodes = useStore('nodes');
  const grouping = useStore('grouping');
  const sizes = useMemo(() => {
    const count = new Map<string, number>();
    for (const n of nodes) {
      const g = n[grouping] ?? '';
      count.set(g, (count.get(g) || 0) + 1);
    }
    return count;
  }, [nodes, grouping]);
  const shown = groups.slice(0, LEGEND_LIMIT);
  return (
    <div id="legend" style={{ marginTop: 10 }}>
      {shown.map(g => (
        <div key={g}>
          <i style={{ background: color(g) }} />
          {g} <span style={{ color: 'var(--muted)' }}>{sizes.get(g) ?? 0}</span>
        </div>
      ))}
      {groups.length > shown.length && (
        <div style={{ color: 'var(--muted)' }}>+ {groups.length - shown.length} more groups</div>
      )}
    </div>
  );
}

function Stats() {
  const nodes = useStore('nodes');
  const links = useStore('links');
  const loadError = useStore('loadError');
  const clusters = useMemo(() => new Set(nodes.map(n => n.cluster)).size, [nodes]);
  return (
    <div id="stats" style={{ marginTop: 8 }}>
      {loadError ??
        `${nodes.length.toLocaleString()} files · ${links.length.toLocaleString()} imports · ${clusters} import clusters`}
    </div>
  );
}
