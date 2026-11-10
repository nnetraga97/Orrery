// The last few agent actions over the canvas. Clicking an action that names a file lands on that file.
import { AgentEvents } from './agent-events.js';

export function createWorkspaceLog({ dom, inspect }) {
  const el = document.createElement('div');
  el.id = 'workspaceLog';
  const rows = [];
  const ICON = {
    tracer: '·',
    flak: '✱',
    shell: '●',
    siege: '◆',
    mortar: '▲',
    drone: '✈',
    beam: '↗',
    station: '◎',
    belt: '☰',
    load: '+',
    beacon: '?',
  };
  function add(e) {
    e = AgentEvents.toVisual(e) || e;
    let text = null,
      icon = '·',
      cls = '',
      file = null,
      line = null;
    if (e.kind === 'prompt') {
      text = e.text;
      icon = '›';
      cls = 'prompt';
    } else if (e.kind === 'fire') {
      text = e.label;
      icon = ICON[e.ammo] || '·';
      cls = e.ammo;
      file = e.files?.[0];
      line = e.lines?.[0];
    } else if (e.kind === 'file-change') {
      text = `${e.workspace ? 'Workspace · ' : ''}${e.created ? 'created' : e.deleted ? 'deleted' : 'changed'} ${e.files[0]}${e.added != null ? `  +${e.added} −${e.removed}` : ''}`;
      icon = e.created ? '✦' : '●';
      cls = e.created ? 'siege' : 'shell';
      file = e.deleted ? null : e.files[0];
      line = e.lines?.[0];
    } else if (e.kind === 'entity-created') {
      text = `${e.workspace ? 'Workspace · ' : ''}created ${e.entity === 'directory' ? 'directory' : 'file'} · ${e.path}`;
      icon = '✦';
      cls = 'siege';
      file = e.entity === 'file' ? e.path : null;
    } else if (e.kind === 'workspace-change') {
      text = `Workspace · ${e.created ? 'created' : e.deleted ? 'deleted' : 'changed'} ${e.path || e.files?.[0]}${e.attribution?.confidence === 'ambiguous' ? ' · ambiguous agent attribution' : ''}`;
      icon = '◇';
      cls = 'dim';
      file = e.deleted ? null : e.path;
    } else if (e.kind === 'resolve' && e.action === 'question') {
      text = e.ok ? 'Question answered' : 'Question cancelled';
      icon = e.ok ? '✓' : '■';
      cls = 'dim';
    } else if (e.kind === 'resolve' && !e.ok) {
      text = `${e.denied ? 'blocked' : 'failed'} · ${e.tool}`;
      icon = '✗';
      cls = 'err';
    } else if (e.kind === 'evidence-update') {
      text = `Attribution updated · ${e.path} · ${e.attribution.confidence}`;
      cls = 'dim';
    } else if (e.kind === 'question-wait') {
      text = 'Waiting for your answer';
      icon = '?';
    } else if (e.kind === 'error') {
      text = e.text;
      icon = '✗';
      cls = 'err';
    } else if (e.kind === 'turn-end') {
      text = 'Turn done';
      icon = '✓';
      cls = 'dim';
    } else if (e.kind === 'interrupt') {
      text = 'Interrupted';
      icon = '■';
      cls = 'err';
    }
    if (!text) return;
    rows.unshift({ text, icon, cls, file, line });
    rows.length = Math.min(rows.length, 7);
    el.replaceChildren(
      ...rows.map(r => {
        const d = document.createElement('div');
        d.className = `gl ${r.cls}${r.file ? ' link' : ''}`;
        const i = document.createElement('i');
        i.textContent = r.icon;
        const s = document.createElement('span');
        s.textContent = r.text;
        d.append(i, s);
        if (r.file) {
          d.title = 'Inspect source';
          d.onclick = () => inspect(r.file, r.line);
        }
        return d;
      }),
    );
  }
  document.addEventListener('DOMContentLoaded', () => dom('stage').appendChild(el));
  return {
    add,
    clear: () => {
      rows.length = 0;
      el.replaceChildren();
    },
  };
}
