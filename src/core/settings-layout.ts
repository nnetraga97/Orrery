// The Settings tab of the chat window: each setting is a labelled row of large pinchable choices (`set:<key>:<value>`),
// the open project is chosen from the baked projects (`project:<name>`), and two actions restart the tutorial and put
// the windows back (`action:restartTutorial`, `action:resetLayout`). Under them is the key to the galaxy (key.ts).
import { Builder } from './chat/layout.ts';
import type { ChatLayout, ChatMetrics, Measure } from './chat/layout.ts';
import { KEY } from './key.ts';
import { EFFORTS, SEAT_HEIGHTS, TEXT_SCALES, VOLUMES } from './settings.ts';
import type { Settings } from './settings.ts';

export type SettingsView = {
  settings: Settings;
  projects: { name: string; title: string }[];
  project: string | null;
  providers: { id: string; label: string }[];
  models: string[];
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const cm = (v: number) => (v === 0 ? 'Level' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} cm`);

export function layoutSettings(view: SettingsView, metrics: ChatMetrics, measure: Measure): ChatLayout {
  const b = new Builder(metrics, measure);
  const s = view.settings;
  const row = (title: string, choices: { id: string; label: string; lit: boolean }[]) => {
    b.line('cardTitle', [{ text: title.toUpperCase(), x: b.left, font: 'label', tone: 'line' }], 'label');
    b.gap(6);
    b.chips(choices);
    b.gap(b.m.gap);
  };
  const set = <T>(key: keyof Settings, values: readonly T[], label: (v: T) => string) =>
    values.map(v => ({ id: `set:${key}:${String(v)}`, label: label(v), lit: s[key] === v }));
  const onOff = (key: keyof Settings) => set(key, [false, true], v => (v ? 'On' : 'Off'));
  if (view.projects.length) row('Project', view.projects.map(p => ({ id: `project:${p.name}`, label: p.title, lit: view.project === p.name })));
  row('Text size', set('textScale', TEXT_SCALES, v => pct(v)));
  row('Seat height', set('seatHeight', SEAT_HEIGHTS, cm));
  row('Hand for the microphone', set('handedness', ['left', 'right'] as const, v => (v === 'left' ? 'Left' : 'Right')));
  row('High contrast', onOff('highContrast'));
  row('Reduce motion', onOff('reduceMotion'));
  row('Volume', set('volume', VOLUMES, v => (v === 0 ? 'Silent' : pct(v))));
  row('Sounds', set('mute', [false, true], v => (v ? 'Muted' : 'On')));
  if (view.providers.length > 1) row('Provider', view.providers.map(p => ({ id: `set:provider:${p.id}`, label: p.label, lit: s.provider === p.id })));
  if (view.models.length > 1) row('Model', set('model', view.models, v => v));
  row('Effort', set('effort', EFFORTS, v => v[0].toUpperCase() + v.slice(1)));
  row('Permission', set('permission', ['readOnly', 'workspace', 'full'] as const, v => (v === 'readOnly' ? 'Read only' : v === 'full' ? 'Full access' : 'Workspace')));
  row('Mode', set('mode', ['work', 'plan'] as const, v => (v === 'work' ? 'Work' : 'Plan')));
  row('Follow the agent', onOff('followAgent'));
  b.buttons([
    { id: 'action:restartTutorial', label: 'Restart tutorial' },
    { id: 'action:resetLayout', label: 'Reset layout' },
  ]);
  b.gap(metrics.pad);
  // The key: what the galaxy's sizes, looks and colours mean (src/core/key.ts).
  b.line('cardTitle', [{ text: 'WHAT THE GALAXY SHOWS', x: b.left, font: 'label', tone: 'line' }], 'label');
  b.gap(6);
  for (const group of KEY) {
    b.text('heading', [{ text: group.title, font: 'bold', tone: 'line' }], b.left);
    for (const line of group.lines) b.text('text', [{ text: line, font: 'body', tone: 'text' }], b.left);
    b.gap(b.m.gap);
  }
  b.gap(metrics.pad);
  return { lines: b.lines, boxes: b.boxes, regions: b.regions, height: b.y };
}
