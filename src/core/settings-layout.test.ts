import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMetrics } from './chat/layout.ts';
import { layoutSettings } from './settings-layout.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const measure = (t: string) => t.length * 10;
const view = {
  settings: DEFAULT_SETTINGS,
  projects: [
    { name: 'editor-core', title: 'Editor core' },
    { name: 'other', title: 'Other' },
  ],
  project: 'editor-core',
  providers: [{ id: 'recorded', label: 'Recorded' }],
  models: [],
};

test('every setting is a row of pinchable choices, with the current one lit', () => {
  const layout = layoutSettings(view, chatMetrics(1200), measure);
  const ids = layout.regions.map(r => r.id);
  for (const id of ['project:editor-core', 'set:textScale:1.4', 'set:seatHeight:-0.15', 'set:handedness:left', 'set:highContrast:true', 'set:reduceMotion:true', 'set:volume:0', 'set:mute:true', 'set:effort:high', 'set:permission:full', 'set:mode:plan', 'set:followAgent:true', 'action:restartTutorial', 'action:resetLayout'])
    assert.ok(ids.includes(id), id);
  const lit = layout.boxes.filter(b => b.kind === 'chip' && b.tone === 'line').map(b => b.id);
  assert.ok(lit.includes('set:textScale:1') && lit.includes('project:editor-core') && lit.includes('set:handedness:right'));
  assert.ok(!ids.some(id => id.includes('palmMenu')));
});

test('provider and model rows show only when there is a choice', () => {
  const one = layoutSettings(view, chatMetrics(1200), measure).regions.map(r => r.id);
  assert.ok(!one.some(id => id.startsWith('set:provider:')));
  const many = layoutSettings({ ...view, providers: [{ id: 'recorded', label: 'Recorded' }, { id: 'claude', label: 'Claude' }], models: ['a', 'b'] }, chatMetrics(1200), measure).regions.map(r => r.id);
  assert.ok(many.includes('set:provider:claude') && many.includes('set:model:b'));
});
