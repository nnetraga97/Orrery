// The bottom of the chat window (docs/visual-style.md, "The chat window", and the review's composer row): the context
// line, the suggested prompts as chips, then only when they apply Stop, the follow-up row, the queue and the More row,
// the "What I'm looking at" chip, and the composer itself: one rounded row with the placeholder or the heard text,
// Send and Cancel, and the microphone button at its right end. Laid out top to bottom; the window draws it against its
// bottom edge.
import { SLASH_COMMANDS } from './composer.ts';
import type { ComposerState, Mode, Permission } from './composer.ts';
import { Builder, fitText, wrapRuns } from './layout.ts';
import type { ChatLayout, ChatMetrics, Measure, Span } from './layout.ts';

export const PLACEHOLDER = 'Hold the microphone and talk';
export const UNAVAILABLE = 'This provider is not available.';

export type ProviderChoice = { id: string; label: string; available: boolean };
export type ComposerView = {
  state: ComposerState;
  prompts: readonly string[];
  project: string;
  changedFiles: number;
  /** The open file and lines ("range.ts:90–101"), or null when no code is open. */
  looking: string | null;
  /** The chosen provider has a key on the server (or the recorded agent is chosen). */
  available: boolean;
  mic: 'idle' | 'listening' | 'unavailable';
  /** The words heard so far while listening. */
  partial: string;
  providers: readonly ProviderChoice[];
  provider: string;
  models: readonly string[];
  model: string;
};

const MODES: [Mode, string][] = [
  ['work', 'Work'],
  ['plan', 'Plan'],
];
const PERMISSIONS: [Permission, string][] = [
  ['readOnly', 'Read only'],
  ['workspace', 'Workspace'],
  ['full', 'Full access'],
];

export function layoutComposer(view: ComposerView, metrics: ChatMetrics, measure: Measure): ChatLayout {
  const b = new Builder(metrics, measure);
  const s = view.state;
  b.y = 16;
  if (s.notice) {
    b.text('notice', [{ text: s.notice, font: 'small', tone: 'amber' }], b.left);
    b.gap(8);
  }
  // The context line: the project, and how many files the agent changed (pinch to ask for a review).
  const ctx: Span[] = [{ text: view.project.toUpperCase(), x: b.left, font: 'label', tone: 'dim' }];
  const ctxLine = b.line('notice', ctx, 'label');
  if (view.changedFiles > 0) {
    const label = `${view.changedFiles} ${view.changedFiles === 1 ? 'file' : 'files'} changed`,
      w = measure(label, 'small') + b.icon() + 14;
    ctx.push({ text: label, x: b.right - measure(label, 'small'), font: 'small', tone: 'line' });
    ctxLine.icon = { name: 'diff', x: b.right - w, tone: 'line' };
    b.region('button:review', b.right - w - 10, ctxLine.y - 6, w + 20, ctxLine.height + 12);
  }
  b.gap(10);
  b.chips([
    ...view.prompts.map((label, i) => ({ id: `chip:prompt:${i}`, label })),
    { id: 'chip:more', label: s.more ? 'Less' : 'More', lit: s.more },
  ]);
  if (s.running) {
    b.gap(12);
    b.buttons([{ id: 'button:stop', label: 'Stop', tone: 'alert' }]);
  }
  if (s.choosing && s.pending) {
    b.gap(12);
    const first = b.lines.length;
    b.buttons([
      { id: 'button:steer', label: 'Steer' },
      { id: 'button:queue', label: 'Queue' },
      { id: 'button:dropFollowUp', label: '✕' },
    ]);
    b.lines[first].spans.push({ text: 'Send follow-up:', x: b.left, font: 'body', tone: 'line' });
  }
  if (s.queue.length) {
    b.gap(12);
    b.line('cardTitle', [{ text: `${s.queue.length} QUEUED`, x: b.left, font: 'label', tone: 'line' }], 'label');
    for (const q of s.queue) {
      const first = b.lines.length;
      b.buttons([
        { id: `queue:again:${q.id}`, label: 'Say it again' },
        { id: `queue:remove:${q.id}`, label: 'Remove' },
      ]);
      const row = b.lines[first],
        room = (row.buttons?.[0]?.x ?? b.right) - 16 - b.left;
      row.spans.push({ text: fitText(q.text, room, 'body', measure), x: b.left, font: 'body', tone: 'text' });
    }
    if (s.queuePaused) b.buttons([{ id: 'button:resumeQueue', label: 'Resume queue' }]);
  }
  if (s.more) {
    b.gap(12);
    b.chips(SLASH_COMMANDS.map(name => ({ id: `slash:${name}`, label: `/${name}` })));
    b.gap(10);
    b.chips(MODES.map(([id, label]) => ({ id: `choice:mode:${id}`, label, lit: s.mode === id })));
    b.gap(10);
    b.chips(PERMISSIONS.map(([id, label]) => ({ id: `choice:permission:${id}`, label, lit: s.permission === id, icon: id === 'readOnly' ? 'lock' : id === 'full' ? 'unlock' : 'shield' })));
    b.gap(10);
    b.chips(view.providers.map(p => ({ id: `choice:provider:${p.id}`, label: p.available ? p.label : `${p.label} (no key)`, lit: view.provider === p.id })));
    if (view.models.length > 1) {
      b.gap(10);
      b.chips(view.models.map(m => ({ id: `choice:model:${m}`, label: m, lit: view.model === m })));
    }
  }
  if (view.looking) {
    b.gap(12);
    b.chips([{ id: 'chip:context', label: `What I'm looking at: ${view.looking}`, lit: s.attachContext, icon: 'paperclip' }]);
  }
  // The composer row.
  b.gap(12);
  const top = b.y,
    pad = 24,
    micD = b.lh('body') + 28,
    rowRight = b.right - micD - 14;
  let textRight = rowRight - pad;
  const pending = s.pending.trim();
  const listening = view.mic === 'listening';
  const buttonsLine = pending && !listening && !s.choosing;
  if (buttonsLine) textRight = rowRight - pad;
  const words = !view.available ? UNAVAILABLE : listening ? view.partial || 'Listening…' : pending || PLACEHOLDER;
  const tone = !view.available ? 'failed' : listening || pending ? 'text' : 'dim';
  b.gap(14);
  const wrapped = wrapRuns([{ text: words, font: 'body', tone }], textRight - (b.left + pad), measure).slice(0, 4);
  for (const spans of wrapped) {
    for (const span of spans) span.x += b.left + pad;
    b.line('text', spans, 'body');
  }
  if (buttonsLine) {
    b.gap(8);
    b.buttons(
      [
        { id: 'button:cancel', label: 'Cancel' },
        { id: 'button:send', label: 'Send' },
      ],
      rowRight - pad,
    );
  }
  b.gap(14);
  const h = Math.max(b.y - top, micD);
  b.y = top + h;
  b.box('field', b.left, top, rowRight - b.left, h, { tone: !view.available ? 'failed' : listening ? 'line' : undefined });
  // The microphone: a round button at the row's right end, as tall as one line of the row.
  const micX = b.right - micD,
    micY = top + h - micD;
  b.box('mic', micX, micY, micD, micD, { id: 'mic', tone: view.mic === 'unavailable' || !view.available ? 'amber' : listening ? 'line' : 'dim' });
  b.lines.push({ y: micY, height: micD, kind: 'notice', spans: [], icon: { name: 'mic', x: micX + (micD - b.icon()) / 2, tone: view.mic === 'unavailable' ? 'amber' : listening ? 'text' : 'line' } });
  if (view.mic !== 'unavailable' && view.available) b.region('mic', micX, micY, micD, micD);
  b.gap(18);
  return { lines: b.lines, boxes: b.boxes, regions: b.regions, height: b.y };
}
