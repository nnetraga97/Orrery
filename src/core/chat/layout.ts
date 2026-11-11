// The transcript as drawable lines: the arranged items (arrange.ts) wrapped to the panel's width, with the boxes drawn
// behind them (bubbles, cards, code and terminal blocks, bands) and the regions a pinch can hit. Text is measured
// through a function passed in, so this stays pure: the panel passes the canvas's measureText, tests a fake.
// Everything is in canvas pixels, top to bottom; the panel scrolls by drawing visibleSlice(layout, scrollTop, view).
import { arrange } from './arrange.ts';
import { describe, failures, isLive, pathOf, stat, summarize, textOf, thinkingLabel, total } from './describe.ts';
import { parseMarkdown } from './markdown.ts';
import type { Block, Run } from './markdown.ts';
import { NO_SECRETS, answerOf, answerState, isQuestionRequest, questionId } from './requests.ts';
import type { AnswerState } from './requests.ts';
import type { ChatChange, ChatItem, ChatRequest } from './types.ts';

export type FontKey = 'body' | 'bold' | 'mono' | 'label' | 'small';
export type Tone = 'text' | 'dim' | 'line' | 'added' | 'removed' | 'failed' | 'ok' | 'hunk' | 'work' | 'amber';
export type Measure = (text: string, font: FontKey) => number;

export type Span = { text: string; x: number; font: FontKey; tone: Tone };
export type LineKind =
  | 'user'
  | 'attachment'
  | 'text'
  | 'heading'
  | 'bullet'
  | 'code'
  | 'codeLanguage'
  | 'thinking'
  | 'action'
  | 'groupHead'
  | 'terminal'
  | 'output'
  | 'exit'
  | 'diffFile'
  | 'diffLine'
  | 'json'
  | 'planHead'
  | 'planStep'
  | 'changes'
  | 'error'
  | 'footer'
  | 'working'
  | 'welcome'
  | 'cardTitle'
  | 'question'
  | 'option'
  | 'say'
  | 'spoken'
  | 'buttons'
  | 'notice';
export type Line = {
  y: number;
  height: number;
  kind: LineKind;
  spans: Span[];
  /** An icon drawn at x, centred on the line. */
  icon?: { name: string; x: number; tone: Tone };
  /** A verb that is still running: drawn pulsing. */
  live?: boolean;
  /** An expandable row's chevron. */
  chevron?: { x: number; open: boolean };
  /** A plan step's marker. */
  marker?: { x: number; status: 'pending' | 'inProgress' | 'completed' };
  /** An option's choice circle. */
  choice?: { x: number; chosen: boolean };
  /** Buttons drawn on the line; each also has a region. */
  buttons?: { id: string; label: string; x: number; w: number; tone?: 'ok' | 'alert'; disabled?: boolean }[];
};
export type BoxKind = 'bubble' | 'card' | 'code' | 'terminal' | 'band' | 'errorBar' | 'chip' | 'option';
export type Box = { kind: BoxKind; x: number; y: number; w: number; h: number; tone?: Tone; id?: string };
export type Region = { id: string; x: number; y: number; w: number; h: number };
export type ChatLayout = { lines: Line[]; boxes: Box[]; regions: Region[]; height: number };

export type ChatMetrics = {
  /** The transcript's width in canvas pixels. */
  width: number;
  /** Space left and right of the transcript, and above its first line. */
  pad: number;
  body: number;
  mono: number;
  small: number;
  label: number;
  /** Line height as a multiple of the font size. */
  leading: number;
  /** Space between entries. */
  gap: number;
  /** Indent of rows inside an open group, and of details inside a row. */
  indent: number;
  /** An icon's box. */
  icon: number;
};

/** The chat window's metrics on its 1200-pixel canvas, at a text scale. */
export function chatMetrics(width: number, textScale = 1): ChatMetrics {
  const s = (v: number) => Math.round(v * textScale);
  return {
    width,
    pad: 40,
    body: s(26),
    mono: s(22),
    small: s(21),
    label: s(20),
    leading: 1.5,
    gap: s(22),
    indent: s(34),
    icon: s(26),
  };
}

export type ChatModel = {
  items: ChatItem[];
  /** A turn is running. */
  live: boolean;
  /** The reader's choices for expandable rows and groups, by toggle key. */
  open?: ReadonlyMap<string, boolean>;
  /** How long each thinking item was seen running, by item id. */
  thinking?: ReadonlyMap<string, number>;
  /** Shown when there are no items. */
  welcome?: string;
  /** The working line: a word and the elapsed time, while a turn runs and nothing waits on the user. */
  working?: { word: string; time: string } | null;
  error?: string | null;
  /** "Waiting for your response", "Stopped", "Turn failed". */
  footer?: string | null;
  /** The agent's open questions and approvals, drawn as cards after the messages. */
  requests?: ChatRequest[];
  /** The answers given so far, by request id. */
  answers?: ReadonlyMap<string, AnswerState>;
  /** The message under a question card's Send button, by request id ("Answer each question before sending."). */
  notices?: ReadonlyMap<string, string>;
  /** The "Say your answer" row being held, as its region id. */
  listening?: string | null;
  /** Rows after everything else (the composer's queue or follow-up rows may use it). */
  extras?: (b: Builder) => void;
};

const MAX_OUTPUT_LINES = 40,
  MAX_DIFF_LINES = 120,
  MAX_JSON_LINES = 30;

/** Wraps runs of text to a width, word by word; a word wider than the width is broken by characters. */
export function wrapRuns(
  runs: { text: string; font: FontKey; tone: Tone }[],
  width: number,
  measure: Measure,
): Span[][] {
  const lines: Span[][] = [[]];
  let x = 0;
  const put = (text: string, font: FontKey, tone: Tone) => {
    const line = lines[lines.length - 1],
      last = line[line.length - 1];
    if (last && last.font === font && last.tone === tone) last.text += text;
    else line.push({ text, x, font, tone });
    x += measure(text, font);
  };
  const newLine = () => {
    lines.push([]);
    x = 0;
  };
  for (const run of runs)
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      const w = measure(piece, run.font);
      if (/^\s+$/.test(piece)) {
        if (x > 0 && x + w <= width) put(piece, run.font, run.tone);
        else if (x > 0) newLine();
        continue;
      }
      if (x > 0 && x + w > width) newLine();
      if (w <= width) {
        put(piece, run.font, run.tone);
        continue;
      }
      // A word wider than the line: break it where it fills the line.
      let chunk = '';
      for (const ch of piece) {
        if (chunk && x + measure(chunk + ch, run.font) > width) {
          put(chunk, run.font, run.tone);
          newLine();
          chunk = '';
        }
        chunk += ch;
      }
      if (chunk) put(chunk, run.font, run.tone);
    }
  // Trailing spaces are not drawn.
  for (const line of lines) {
    const last = line[line.length - 1];
    if (last) last.text = last.text.replace(/\s+$/, '');
  }
  return lines;
}

const fontOf = (run: Run): FontKey => (run.code ? 'mono' : run.bold ? 'bold' : 'body');

/** Builds the layout top to bottom. Exposed so request cards (requests layout) can add to it. */
export class Builder {
  y: number;
  readonly lines: Line[] = [];
  readonly boxes: Box[] = [];
  readonly regions: Region[] = [];
  readonly left: number;
  readonly right: number;
  readonly m: ChatMetrics;
  readonly measure: Measure;
  constructor(m: ChatMetrics, measure: Measure) {
    this.m = m;
    this.measure = measure;
    this.left = m.pad;
    this.right = m.width - m.pad;
    this.y = m.pad;
  }
  icon() {
    return this.m.icon;
  }
  lh(font: FontKey) {
    const px = font === 'mono' ? this.m.mono : font === 'small' ? this.m.small : font === 'label' ? this.m.label : this.m.body;
    return Math.round(px * this.m.leading);
  }
  line(kind: LineKind, spans: Span[], font: FontKey, extra: Partial<Line> = {}): Line {
    const line: Line = { y: this.y, height: this.lh(font), kind, spans, ...extra };
    this.lines.push(line);
    this.y += line.height;
    return line;
  }
  /** Wrapped text from x to the right edge (or to x + width). */
  text(kind: LineKind, runs: { text: string; font: FontKey; tone: Tone }[], x: number, width = this.right - x, extra: Partial<Line> = {}) {
    const font = runs[0]?.font ?? 'body';
    for (const spans of wrapRuns(runs, width, this.measure)) {
      for (const s of spans) s.x += x;
      this.line(kind, spans, font === 'bold' ? 'body' : font, extra);
    }
  }
  /** One line of unwrapped text (code, output, diffs), clipped by the drawing. */
  mono(kind: LineKind, text: string, x: number, tone: Tone = 'text') {
    return this.line(kind, text ? [{ text, x, font: 'mono', tone }] : [], 'mono');
  }
  gap(px = this.m.gap) {
    this.y += px;
  }
  region(id: string, x: number, y: number, w: number, h: number) {
    this.regions.push({ id, x, y, w, h });
  }
  box(kind: BoxKind, x: number, y: number, w: number, h: number, extra: Partial<Box> = {}) {
    const box: Box = { kind, x, y, w, h, ...extra };
    this.boxes.push(box);
    return box;
  }
  /** A button row: buttons laid right to left from the right edge. */
  buttons(defs: { id: string; label: string; tone?: 'ok' | 'alert'; disabled?: boolean }[], right = this.right) {
    // About 2.3 cm tall in the room: a comfortable target for a pinch or a glance.
    const h = this.lh('label') + 40,
      pad = 30,
      gap = 14;
    let x = right;
    // Placed from the right edge leftward, so the last button sits rightmost; listed left to right.
    const buttons = [...defs]
      .reverse()
      .map(d => {
        const w = Math.ceil(this.measure(d.label.toUpperCase(), 'label')) + pad * 2;
        x -= w;
        const b = { ...d, x, w };
        x -= gap;
        return b;
      })
      .reverse();
    const line: Line = { y: this.y, height: h, kind: 'buttons', spans: [], buttons };
    this.lines.push(line);
    for (const b of buttons) if (!b.disabled) this.region(b.id, b.x, this.y, b.w, h);
    this.y += h;
    return line;
  }
}

function markdown(b: Builder, blocks: Block[], x: number) {
  const width = b.right - x;
  blocks.forEach((block, k) => {
    if (k) b.gap(Math.round(b.m.gap / 2));
    if (block.kind === 'paragraph')
      for (const runs of block.lines)
        b.text('text', runs.map(r => ({ text: r.text, font: fontOf(r), tone: 'text' as Tone })), x, width);
    else if (block.kind === 'heading')
      b.text('heading', block.runs.map(r => ({ text: r.text, font: r.code ? 'mono' : 'bold', tone: 'text' as Tone })), x, width);
    else if (block.kind === 'list')
      block.items.forEach((runs, i) => {
        const mark = block.ordered ? `${i + 1}.` : '•',
          markW = b.measure('00. ', 'body');
        const first = b.lines.length;
        b.text('bullet', runs.map(r => ({ text: r.text, font: fontOf(r), tone: 'text' as Tone })), x + markW, width - markW);
        b.lines[first]?.spans.unshift({ text: mark, x, font: 'body', tone: 'dim' });
      });
    else {
      const top = b.y,
        inset = 18;
      b.gap(10);
      if (block.language) b.line('codeLanguage', [{ text: block.language.toUpperCase(), x: x + inset, font: 'label', tone: 'line' }], 'label');
      for (const line of block.lines) b.mono('code', line, x + inset);
      b.gap(10);
      b.box('code', x, top, width, b.y - top);
    }
  });
}

function userMessage(b: Builder, item: ChatItem) {
  const maxW = Math.floor((b.right - b.left) * 0.8),
    pad = 22,
    top = b.y;
  const textLines = textOf(item)
    .split('\n')
    .map(t => wrapRuns([{ text: t, font: 'body', tone: 'text' }], maxW - pad * 2, b.measure));
  const flat = textLines.flat();
  const widthOf = (spans: Span[]) => spans.reduce((w, s) => Math.max(w, s.x + b.measure(s.text, s.font)), 0);
  const chips = item.attachmentNames ?? [],
    chipW = (name: string) => b.icon() + 8 + b.measure(name, 'small') + 24;
  const chipsW = chips.reduce((w, n, i) => w + chipW(n) + (i ? 10 : 0), 0);
  const inner = Math.min(maxW - pad * 2, Math.max(...flat.map(widthOf), Math.min(chipsW, maxW - pad * 2), 0));
  const bw = inner + pad * 2,
    x = b.right - bw;
  b.gap(14);
  if (chips.length) {
    let cx = x + pad;
    const y = b.y,
      h = b.lh('small') + 8;
    for (const name of chips) {
      const w = Math.min(chipW(name), b.right - pad - cx);
      if (w <= 0) break;
      b.box('chip', cx, y, w, h);
      b.lines.push({ y, height: h, kind: 'attachment', spans: [{ text: name, x: cx + 12 + b.icon() + 8, font: 'small', tone: 'line' }], icon: { name: 'paperclip', x: cx + 12, tone: 'line' } });
      cx += w + 10;
    }
    b.y += h + 10;
  }
  for (const spans of flat) {
    for (const s of spans) s.x += x + pad;
    b.line('user', spans, 'body');
  }
  b.gap(14);
  b.box('bubble', x, top, bw, b.y - top);
}

/** The detail under an expanded row. */
function detail(b: Builder, item: ChatItem, x: number) {
  if (item.type === 'reasoning') {
    markdown(b, parseMarkdown(thinkingLabel(item, null).rest), x);
    return;
  }
  if (item.type === 'commandExecution') {
    const top = b.y,
      inset = 18;
    b.gap(8);
    const command = Array.isArray(item.command) ? item.command.join(' ') : String(item.command ?? '');
    b.mono('terminal', `$ ${command}`, x + inset, 'line');
    const output = item.output || item.aggregatedOutput;
    if (output) clipped(b, output.replace(/\n$/, '').split('\n'), MAX_OUTPUT_LINES, l => b.mono('output', l, x + inset));
    if (item.exitCode != null && item.exitCode !== 0) b.mono('exit', `Exit code ${item.exitCode}`, x + inset, 'failed');
    b.gap(8);
    b.box('terminal', x, top, b.right - x, b.y - top);
    return;
  }
  if (item.type === 'fileChange') {
    diffs(b, item.changes || [], x);
    return;
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const args = item.arguments == null ? '' : JSON.stringify(item.arguments, null, 2),
      output = item.result ?? item.contentItems?.map(c => c.text ?? '').join('\n'),
      result = output == null ? '' : typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    const top = b.y,
      inset = 18;
    b.gap(8);
    if (args) clipped(b, args.split('\n'), MAX_JSON_LINES, l => b.mono('json', l, x + inset, 'line'));
    if (result) clipped(b, result.split('\n'), MAX_JSON_LINES, l => b.mono('json', l, x + inset));
    b.gap(8);
    b.box('terminal', x, top, b.right - x, b.y - top);
  }
}

function clipped(b: Builder, lines: string[], max: number, draw: (line: string) => void) {
  lines.slice(0, max).forEach(draw);
  if (lines.length > max) b.line('notice', [{ text: `… ${lines.length - max} more lines`, x: b.left + b.m.indent, font: 'small', tone: 'dim' }], 'small');
}

/** Diffs: a header per file with its counts, then its lines on bands. */
export function diffs(b: Builder, changes: ChatChange[], x: number) {
  for (const change of changes) {
    const s = stat(change);
    const spans: Span[] = [{ text: pathOf(change), x, font: 'mono', tone: 'line' }];
    const pathW = b.measure(pathOf(change), 'mono');
    if (s.added) spans.push({ text: `+${s.added}`, x: x + pathW + 16, font: 'small', tone: 'added' });
    if (s.removed)
      spans.push({ text: `−${s.removed}`, x: x + pathW + 16 + (s.added ? b.measure(`+${s.added} `, 'small') : 0), font: 'small', tone: 'removed' });
    b.line('diffFile', spans, 'mono');
    const lines = String(change.diff || change.patch || '')
      .replace(/\n$/, '')
      .split('\n')
      // The file headers repeat the path drawn above.
      .filter(l => !/^(--- |\+\+\+ |diff --git |index )/.test(l));
    clipped(b, lines, MAX_DIFF_LINES, l => {
      const tone: Tone = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'added' : l.startsWith('-') ? 'removed' : 'text';
      const line = b.mono('diffLine', l, x + 12, tone);
      if (tone === 'added' || tone === 'removed') b.box('band', x, line.y, b.right - x, line.height, { tone });
    });
    b.gap(8);
  }
}

/** One action or thinking row; its detail below when open. */
function row(b: Builder, item: ChatItem, key: string, x: number, model: ChatModel) {
  const id = `toggle:${item.id ?? key}`,
    open = model.open?.get(item.id ?? key) ?? false,
    iconX = x,
    textX = x + b.icon() + 14;
  if (item.type === 'reasoning') {
    const t = thinkingLabel(item, item.id ? (model.thinking?.get(item.id) ?? null) : null);
    const expandable = !!t.rest.trim();
    const spans: Span[] = [{ text: t.label, x: textX, font: 'body', tone: 'line' }];
    if (t.meta) spans.push({ text: t.meta, x: textX + b.measure(t.label, 'body') + 14, font: 'small', tone: 'dim' });
    const line = b.line('thinking', spans, 'body', {
      icon: { name: 'thought', x: iconX, tone: 'line' },
      live: t.live,
      chevron: expandable ? { x: b.right - b.icon(), open } : undefined,
    });
    if (expandable) b.region(id, x, line.y, b.right - x, line.height);
    if (expandable && open) detail(b, item, textX);
    return;
  }
  const a = describe(item);
  const tone: Tone = a.failed ? 'failed' : 'line';
  const spans: Span[] = [{ text: a.verb, x: textX, font: 'body', tone: a.failed ? 'failed' : 'text' }];
  let cx = textX + b.measure(a.verb, 'body') + 12;
  const room = b.right - b.icon() - 20;
  if (a.target) {
    const target = fitText(a.target, room - cx, 'mono', b.measure);
    spans.push({ text: target, x: cx, font: 'mono', tone: a.failed ? 'failed' : 'line' });
    cx += b.measure(target, 'mono') + 12;
  }
  if (a.added || a.removed) {
    if (a.added) {
      spans.push({ text: `+${a.added}`, x: cx, font: 'small', tone: 'added' });
      cx += b.measure(`+${a.added}`, 'small') + 8;
    }
    if (a.removed) spans.push({ text: `−${a.removed}`, x: cx, font: 'small', tone: 'removed' });
  } else if (a.meta) spans.push({ text: a.meta, x: cx, font: 'small', tone: a.failed ? 'failed' : 'dim' });
  const expandable =
    item.type === 'commandExecution' ||
    (item.type === 'fileChange' && !!item.changes?.length) ||
    ((item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') && (item.arguments != null || item.result != null || !!item.contentItems?.length));
  const line = b.line('action', spans, 'body', {
    icon: { name: a.failed ? 'alert' : a.icon, x: iconX, tone },
    live: a.live,
    chevron: expandable ? { x: b.right - b.icon(), open } : undefined,
  });
  if (expandable) b.region(id, x, line.y, b.right - x, line.height);
  if (expandable && open) detail(b, item, textX);
}

/** Text cut with an ellipsis to fit a width. */
export function fitText(text: string, width: number, font: FontKey, measure: Measure) {
  if (measure(text, font) <= width) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + '…', font) <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function group(b: Builder, items: ChatItem[], itemKey: string, live: boolean, model: ChatModel) {
  const key = `group:${itemKey}`;
  const open = model.open?.get(key) ?? live,
    failed = failures(items);
  const failText = failed ? `${failed} ${failed === 1 ? 'failure' : 'failures'}` : '';
  const room = b.right - b.icon() - 20 - b.left - (failed ? b.measure(failText, 'small') + 14 : 0);
  const summary = fitText(summarize(items), room, 'body', b.measure);
  const spans: Span[] = [{ text: summary, x: b.left, font: 'body', tone: 'line' }];
  if (failed) spans.push({ text: failText, x: b.left + b.measure(summary, 'body') + 14, font: 'small', tone: 'failed' });
  const line = b.line('groupHead', spans, 'body', { live, chevron: { x: b.right - b.icon(), open } });
  b.region(`toggle:${key}`, b.left, line.y, b.right - b.left, line.height);
  if (open) items.forEach((item, i) => row(b, item, `${itemKey}.${i}`, b.left + b.m.indent, model));
}

function planCard(b: Builder, item: ChatItem) {
  const steps = item.plan || [],
    done = steps.filter(s => s.status === 'completed').length,
    top = b.y,
    x = b.left + 22;
  b.gap(12);
  const line = b.line('planHead', [{ text: 'PLAN', x, font: 'label', tone: 'line' }], 'label');
  const count = `${done} of ${steps.length} done`;
  line.spans.push({ text: count, x: b.right - 22 - b.measure(count, 'small'), font: 'small', tone: 'dim' });
  for (const step of steps) {
    const status = step.status === 'completed' ? 'completed' : step.status === 'inProgress' || step.status === 'in_progress' ? 'inProgress' : 'pending';
    const first = b.lines.length;
    b.text('planStep', [{ text: step.step || step.text || '', font: 'body', tone: status === 'completed' ? 'dim' : 'text' }], x + b.icon() + 14, b.right - 22 - (x + b.icon() + 14));
    b.lines[first].marker = { x, status };
  }
  b.gap(12);
  b.box('card', b.left, top, b.right - b.left, b.y - top);
}

/** The turn's diff as "Changed N files this turn", expanding to the diffs. */
export function turnChanges(diff: string): ChatChange[] {
  return String(diff || '')
    .split(/^(?=diff --git )/m)
    .filter(part => part.trim())
    .map(part => ({
      path: part.match(/^diff --git a\/(\S+)/)?.[1] || 'Working changes',
      diff: part
        .split('\n')
        .slice(part.startsWith('diff --git') ? 4 : 0)
        .join('\n'),
    }));
}

function turnDiff(b: Builder, item: ChatItem, key: string, model: ChatModel) {
  const changes = turnChanges(item.diff || '');
  if (!changes.length) return;
  const open = model.open?.get(item.id ?? key) ?? false,
    sum = total(changes),
    textX = b.left + b.icon() + 14;
  const label = `Changed ${changes.length} ${changes.length === 1 ? 'file' : 'files'} this turn`;
  const spans: Span[] = [{ text: label, x: textX, font: 'body', tone: 'text' }];
  let cx = textX + b.measure(label, 'body') + 14;
  if (sum.added) {
    spans.push({ text: `+${sum.added}`, x: cx, font: 'small', tone: 'added' });
    cx += b.measure(`+${sum.added}`, 'small') + 8;
  }
  if (sum.removed) spans.push({ text: `−${sum.removed}`, x: cx, font: 'small', tone: 'removed' });
  const line = b.line('changes', spans, 'body', { icon: { name: 'diff', x: b.left, tone: 'line' }, chevron: { x: b.right - b.icon(), open } });
  b.region(`toggle:${item.id ?? key}`, b.left, line.y, b.right - b.left, line.height);
  if (open) diffs(b, changes, textX);
}

/**
 * A question or approval card: a small glass panel. Questions: "A question for you", each question's text, one row per
 * option (`option:<requestId>:<questionId>:<index>`), a "Say your answer" row (`say:<requestId>:<questionId>`), the
 * spoken answer once given, and Send answer (`button:send:<requestId>`) with the validation message. Approvals: the
 * title, reason and command, a "Review changes" row (`toggle:review:<requestId>`) that opens the diff, and Decline and
 * Approve once (`button:decline:<id>`, `button:approve:<id>`).
 */
function requestCard(b: Builder, request: ChatRequest, model: ChatModel) {
  const firstBox = b.boxes.length,
    top = b.y,
    inset = 22,
    x = b.left + inset,
    inner = b.right - inset - x;
  b.gap(14);
  if (isQuestionRequest(request)) {
    const state = model.answers?.get(request.id) ?? answerState(request);
    b.line('cardTitle', [{ text: 'A QUESTION FOR YOU', x, font: 'label', tone: 'line' }], 'label');
    (request.questions ?? []).forEach((q, qi) => {
      const qid = questionId(q, qi);
      b.gap(8);
      b.text('question', [{ text: q.question || q.header || 'Your answer', font: 'bold', tone: 'text' }], x, inner);
      if (q.isSecret) {
        b.text('notice', [{ text: NO_SECRETS, font: 'small', tone: 'failed' }], x, inner);
        return;
      }
      const chosen = state.spoken[qid] ? -1 : (state.choices[qid] ?? -1);
      (q.options ?? []).forEach((option, oi) => {
        const id = `option:${request.id}:${qid}:${oi}`,
          rowTop = b.y,
          textX = x + 16 + b.icon() + 14;
        b.gap(8);
        const first = b.lines.length;
        b.text('option', [{ text: option.label || option.value || String(oi), font: 'bold', tone: 'text' }], textX, b.right - inset - 16 - textX);
        b.lines[first].choice = { x: x + 16, chosen: chosen === oi };
        if (option.description) b.text('option', [{ text: option.description, font: 'small', tone: 'line' }], textX, b.right - inset - 16 - textX);
        b.gap(8);
        b.box('option', x, rowTop, inner, b.y - rowTop, { id });
        b.region(id, x, rowTop, inner, b.y - rowTop);
        b.gap(8);
      });
      const say = `say:${request.id}:${qid}`,
        sayTop = b.y,
        held = model.listening === say;
      b.gap(6);
      b.line('say', [{ text: held ? 'Listening…' : 'Say your answer', x: x + 16 + b.icon() + 14, font: 'body', tone: held ? 'text' : 'line' }], 'body', {
        icon: { name: 'mic', x: x + 16, tone: held ? 'text' : 'line' },
      });
      b.gap(6);
      b.box('option', x, sayTop, inner, b.y - sayTop, { id: say });
      b.region(say, x, sayTop, inner, b.y - sayTop);
      if (state.spoken[qid]) {
        b.gap(6);
        b.text('spoken', [{ text: `“${state.spoken[qid]}”`, font: 'body', tone: 'text' }], x + 16, inner - 16);
      }
    });
    b.gap(12);
    const answered = (request.questions ?? []).every((q, i) => answerOf(state, q, i) != null);
    b.buttons([{ id: `button:send:${request.id}`, label: 'Send answer', disabled: (request.questions ?? []).some(q => q.isSecret) }], b.right - inset);
    const notice = model.notices?.get(request.id);
    if (notice && !answered) b.text('notice', [{ text: notice, font: 'small', tone: 'amber' }], x, inner);
  } else {
    b.line('cardTitle', [{ text: request.type === 'fileChangeApproval' ? 'APPROVE FILE CHANGES' : 'APPROVE THIS ACTION', x, font: 'label', tone: 'line' }], 'label');
    if (request.reason) {
      b.gap(6);
      b.text('text', [{ text: request.reason, font: 'body', tone: 'text' }], x, inner);
    }
    if (request.command) {
      b.gap(6);
      const t = b.y;
      b.gap(8);
      b.mono('terminal', request.command, x + 14, 'line');
      b.gap(8);
      b.box('terminal', x, t, inner, b.y - t);
    }
    if (request.cwd) b.text('notice', [{ text: request.cwd, font: 'small', tone: 'dim' }], x, inner);
    if (request.changes?.length) {
      const id = `review:${request.id}`,
        open = model.open?.get(id) ?? false;
      b.gap(6);
      const line = b.line('changes', [{ text: 'Review changes', x: x + b.icon() + 14, font: 'body', tone: 'line' }], 'body', {
        icon: { name: 'diff', x, tone: 'line' },
        chevron: { x: b.right - inset - b.icon(), open },
      });
      b.region(`toggle:${id}`, x, line.y, inner, line.height);
      if (open) diffs(b, request.changes, x);
    }
    b.gap(12);
    b.buttons(
      [
        { id: `button:decline:${request.id}`, label: 'Decline' },
        { id: `button:approve:${request.id}`, label: 'Approve once', tone: 'ok' },
      ],
      b.right - inset,
    );
  }
  b.gap(14);
  // The card goes behind the option rows and blocks inside it.
  b.boxes.splice(firstBox, 0, {
    kind: 'card',
    x: b.left,
    y: top,
    w: b.right - b.left,
    h: b.y - top,
  });
}

export function layoutChat(model: ChatModel, metrics: ChatMetrics, measure: Measure): ChatLayout {
  const b = new Builder(metrics, measure);
  const entries = arrange(model.items);
  if (!entries.length && model.welcome) {
    b.gap(b.m.gap * 3);
    b.text('welcome', [{ text: model.welcome, font: 'body', tone: 'line' }], b.left);
  }
  entries.forEach((entry, i) => {
    if (i) b.gap();
    const last = i === entries.length - 1;
    if (entry.kind === 'group') group(b, entry.items, entry.key, model.live && last, model);
    else if (entry.kind === 'row') row(b, entry.item, entry.key, b.left, model);
    else {
      const item = entry.item;
      if (item.type === 'userMessage' || item.role === 'user') userMessage(b, item);
      else if (item.type === 'plan') planCard(b, item);
      else if (item.type === 'turnDiff') turnDiff(b, item, entry.key, model);
      else markdown(b, parseMarkdown(textOf(item)), b.left);
    }
  });
  for (const request of model.requests ?? []) {
    b.gap();
    requestCard(b, request, model);
  }
  model.extras?.(b);
  if (model.working) {
    b.gap();
    const w = model.working,
      x = b.left + b.icon() + 14;
    b.line('working', [
      { text: w.word, x, font: 'body', tone: 'line' },
      { text: w.time, x: x + measure(w.word, 'body') + 14, font: 'small', tone: 'dim' },
    ], 'body', { icon: { name: 'working', x: b.left, tone: 'work' }, live: true });
  }
  if (model.error) {
    b.gap();
    const top = b.y;
    b.gap(10);
    const first = b.lines.length,
      x = b.left + b.icon() + 28;
    b.text('error', [{ text: model.error, font: 'body', tone: 'failed' }], x, b.right - 18 - x);
    b.lines[first].icon = { name: 'alert', x: b.left + 14, tone: 'failed' };
    b.gap(10);
    b.box('errorBar', b.left, top, b.right - b.left, b.y - top, { tone: 'failed' });
  }
  if (model.footer) {
    b.gap();
    b.line('footer', [{ text: model.footer, x: b.left, font: 'small', tone: 'dim' }], 'small');
  }
  b.gap(metrics.pad);
  return { lines: b.lines, boxes: b.boxes, regions: b.regions, height: b.y };
}

/** The lines, boxes and regions that fall within [scrollTop, scrollTop + viewHeight). */
export function visibleSlice(layout: ChatLayout, scrollTop: number, viewHeight: number): ChatLayout {
  const bottom = scrollTop + viewHeight,
    inView = (y: number, h: number) => y + h > scrollTop && y < bottom;
  return {
    lines: layout.lines.filter(l => inView(l.y, l.height)),
    boxes: layout.boxes.filter(bx => inView(bx.y, bx.h)),
    regions: layout.regions.filter(r => inView(r.y, r.h)),
    height: layout.height,
  };
}

/** Where to scroll after the transcript grows: follow new output only if the reader was within 90 px of the bottom. */
export function stickToBottom(previousScrollTop: number, previousHeight: number, newHeight: number, viewHeight: number) {
  const wasNearBottom = previousHeight - (previousScrollTop + viewHeight) <= 90;
  const max = Math.max(0, newHeight - viewHeight);
  return wasNearBottom ? max : Math.min(previousScrollTop, max);
}

/** A scroll position kept within the transcript. */
export const clampScroll = (scrollTop: number, height: number, viewHeight: number) =>
  Math.max(0, Math.min(scrollTop, Math.max(0, height - viewHeight)));

export { isLive };

/**
 * The chat list, shown in the chat window in place of the transcript: "New chat" at the top (`button:newChat`), then
 * one row per chat with its title and badge (`thread:<id>`); the open chat is marked.
 */
export function layoutThreadList(
  threads: readonly { id: string; title: string; badge: 'Working' | 'Needs input' | null }[],
  currentId: string | null,
  metrics: ChatMetrics,
  measure: Measure,
): ChatLayout {
  const b = new Builder(metrics, measure);
  b.line('cardTitle', [{ text: 'CHATS', x: b.left, font: 'label', tone: 'line' }], 'label');
  b.gap(10);
  const newTop = b.y;
  b.gap(10);
  b.line('option', [{ text: 'New chat', x: b.left + 16 + b.icon() + 14, font: 'bold', tone: 'text' }], 'body', {
    icon: { name: 'plus', x: b.left + 16, tone: 'line' },
  });
  b.gap(10);
  b.box('option', b.left, newTop, b.right - b.left, b.y - newTop, { id: 'button:newChat' });
  b.region('button:newChat', b.left, newTop, b.right - b.left, b.y - newTop);
  for (const t of threads) {
    b.gap(10);
    const id = `thread:${t.id}`,
      top = b.y,
      x = b.left + 16;
    b.gap(10);
    const badgeW = t.badge ? measure(t.badge.toUpperCase(), 'label') + 20 : 0;
    const title = fitText(t.title, b.right - 16 - badgeW - x, 'body', measure);
    const spans: Span[] = [{ text: title, x, font: t.id === currentId ? 'bold' : 'body', tone: t.id === currentId ? 'text' : 'line' }];
    if (t.badge)
      spans.push({ text: t.badge.toUpperCase(), x: b.right - 16 - badgeW + 20, font: 'label', tone: t.badge === 'Needs input' ? 'amber' : 'line' });
    b.line('option', spans, 'body');
    b.gap(10);
    b.box('option', b.left, top, b.right - b.left, b.y - top, { id });
    b.region(id, b.left, top, b.right - b.left, b.y - top);
  }
  b.gap(metrics.pad);
  return { lines: b.lines, boxes: b.boxes, regions: b.regions, height: b.y };
}
