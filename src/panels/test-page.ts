// panels.html: every panel drawn on a plain canvas from fixed sample data, stacked down the page, so each can be
// checked with a screenshot. Sets window.__panels = { ready, regions } for tests.
import type { HitRegion } from '../core/panel-hit.ts';
import { visibleLines } from '../core/code-view.ts';
import type { CodeView, Segment } from '../core/code-view.ts';
import { TUTORIAL_TEXT } from '../core/tutorial.ts';
import { STYLE_PX_PER_M } from './canvas-panel.ts';
import { chatMetrics, layoutChat } from '../core/chat/layout.ts';
import type { ChatModel } from '../core/chat/layout.ts';
import { answerState, choose } from '../core/chat/requests.ts';
import { APPROVAL_FIXTURE, CHAT_FIXTURE, CHAT_FIXTURE_OPEN, QUESTION_FIXTURE } from './chat-fixture.ts';
import { canvasMeasure, chatView, drawTranscript } from './draw-chat.ts';
import { CHAT_WINDOW, drawChatShell } from './draw-chat-shell.ts';
import { TAB_STRIP, drawTabStrip } from './draw-tab-strip.ts';
import { CODE_CARD, CODE_LAYOUT, codeCardSize, drawCodeCard } from './draw-code-card.ts';
import { INFO_CARD, drawInfoCard, infoCardTitle } from './draw-info-card.ts';
import { STATUS_CARD, drawStatusCard, statusTitle } from './draw-status-card.ts';
import { TUTORIAL_PANEL, drawTutorial, tutorialTitle } from './draw-tutorial.ts';
import { loadFonts } from './fonts.ts';
import { THEME, closeMark, glassPanel, grabBar } from './paint.ts';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number) => HitRegion[];
const regions: Record<string, HitRegion[]> = {};

// A small TypeScript sample, tokenised by keyword, string and number.
const SAMPLE = `/**
 * A range in the editor. (startLineNumber,startColumn) is <= (endLineNumber,endColumn)
 */
export class Range {
	public readonly startLineNumber: number;
	public readonly endLineNumber: number;

	/**
	 * Test if position is in this range. If the position is at the edges, will return true.
	 */
	public static containsPosition(range: IRange, position: IPosition): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
			return false;
		}
		return true;
	}

	public static readonly name = 'range';
	public static readonly limit = 1024;
}`;
const KEYWORDS = /^(export|class|public|readonly|static|if|return|false|true|number|boolean)$/;
function tokenise(line: string): Segment[] {
  const out: Segment[] = [];
  const comment = line.match(/^\s*(\/\*\*|\*)/);
  if (comment) return [{ text: line, cls: 'tok-comment' }];
  for (const part of line.split(/(\b\w+\b|'[^']*')/)) {
    if (!part) continue;
    const cls = KEYWORDS.test(part) ? 'tok-keyword' : /^'/.test(part) ? 'tok-string' : /^\d+$/.test(part) ? 'tok-number' : undefined;
    out.push(cls ? { text: part, cls } : { text: part });
  }
  return out;
}
const sampleView: CodeView = {
  file: 'core/range.ts',
  lines: SAMPLE.split('\n').map(tokenise),
  regions: [{ name: 'containsPosition', start: 11, end: 19 }],
  selectedRegion: 0,
  selectedRange: { start: 12, end: 14 },
  hoveredRange: { start: 15, end: 15 },
};

interface Size {
  widthPx: number;
  heightPx: number;
  widthM: number;
}
interface Frame {
  title: string;
  hue?: string;
  closable?: boolean;
  movable?: boolean;
}

/** Draws one panel on its own canvas, inside the same window frame CanvasPanel draws in the room. */
function show(name: string, size: Size, draw: Draw, frame?: Frame) {
  const u = size.widthPx / size.widthM / STYLE_PX_PER_M;
  const strip = frame ? Math.round(26 * u) : 0;
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = name;
  const canvas = document.createElement('canvas');
  canvas.width = size.widthPx;
  canvas.height = size.heightPx + strip;
  canvas.style.width = `${Math.round(size.widthPx / 2)}px`;
  figure.append(caption, canvas);
  document.getElementById('panels')!.append(figure);
  const ctx = canvas.getContext('2d')!;
  const w = size.widthPx,
    h = size.heightPx;
  if (frame) glassPanel(ctx, 0, 0, w, h, u, { title: frame.title, hue: frame.hue });
  const out = draw(ctx, w, h, u);
  if (frame?.closable) out.push(closeMark(ctx, 0, 0, w, u));
  if (frame?.movable) grabBar(ctx, w / 2, h + 10 * u, u);
  regions[name] = out;
}

/** Every panel, in the order the plan adds them. Later tasks append here. */
export async function drawAll() {
  await loadFonts();
  const cannon = {
    key: 'cannon',
    kind: 'Cannon',
    title: 'Agent cannon',
    sub: 'Fires the agent at a function',
    text: 'Pinch a town, then Fire to send the agent there.',
    actions: [{ label: 'Fire', primary: true }, { label: 'Dismiss' }],
  };
  show('infoCard', INFO_CARD, (ctx, w, h, u) => drawInfoCard(ctx, w, h, u, cannon, 'action:0'), {
    title: infoCardTitle(cannon),
    closable: true,
    movable: true,
  });
  const card = (rows: number, more: boolean) => (ctx: CanvasRenderingContext2D, w: number, h: number, u: number) => {
    const shown = visibleLines(sampleView, { rows, columns: CODE_LAYOUT.columns, scrollTop: 0 });
    return drawCodeCard(ctx, w, h, u, shown, {
      shown: { first: shown[0].number, last: shown[shown.length - 1].number, total: sampleView.lines.length },
      more,
      hovered: 'line:17',
    });
  };
  const codeFrame = { title: 'range.ts · containsPosition', closable: true, movable: true };
  show('codeCard', CODE_CARD, card(CODE_LAYOUT.rows, false), codeFrame);
  show('codeCardMore', { ...CODE_CARD, heightPx: codeCardSize(CODE_LAYOUT.moreRows).heightPx }, card(CODE_LAYOUT.moreRows, true), codeFrame);
  (['point', 'turn', 'open', 'read'] as const).forEach((step, k) =>
    show(`tutorial-${step}`, TUTORIAL_PANEL, (ctx, w, h, u) => drawTutorial(ctx, w, h, u, step, TUTORIAL_TEXT[step]), {
      title: tutorialTitle(k + 1),
    }),
  );
  show('chatWindow', CHAT_WINDOW, (ctx, w, h, u) => drawChatShell(ctx, w, h, u), {
    title: 'Agent',
    closable: true,
    movable: true,
  });
  show('tabStrip', TAB_STRIP, (ctx, w, h) =>
    drawTabStrip(ctx, w, h, { active: 'chat', hovered: 'tab:home', disabled: ['replay', 'settings'] }),
  );
  // The transcript: every item kind once, drawn in full, then the window scrolled to its end with the turn running.
  const transcript = (scrollToEnd: boolean, extra: Partial<ChatModel> = {}) => (ctx: CanvasRenderingContext2D, w: number, h: number, u: number) => {
    const m = chatMetrics(w);
    const view = chatView(w, h, u);
    const layout = layoutChat(
      {
        items: CHAT_FIXTURE,
        live: true,
        open: CHAT_FIXTURE_OPEN,
        thinking: new Map([['r1', 8000]]),
        working: { word: 'Reading…', time: '1m 5s' },
        ...extra,
      },
      { ...m, width: view.w },
      canvasMeasure(ctx, m),
    );
    const scrollTop = scrollToEnd ? Math.max(0, layout.height - view.h) : 0;
    return drawTranscript(ctx, view.x, view.y, view.w, view.h, layout, m, u, { scrollTop, clock: 0.4, hovered: 'toggle:c1' });
  };
  {
    // Measure first, so the full transcript gets a canvas tall enough.
    const probe = document.createElement('canvas').getContext('2d')!;
    const m = chatMetrics(CHAT_WINDOW.widthPx);
    const full = layoutChat(
      { items: CHAT_FIXTURE, live: true, open: CHAT_FIXTURE_OPEN, working: { word: 'Reading…', time: '1m 5s' }, error: 'Turn failed: the provider stopped answering.', footer: 'Stopped' },
      { ...m, width: chatView(CHAT_WINDOW.widthPx, CHAT_WINDOW.heightPx, 1).w },
      canvasMeasure(probe, m),
    );
    const top = chatView(CHAT_WINDOW.widthPx, CHAT_WINDOW.heightPx, CHAT_WINDOW.widthPx / CHAT_WINDOW.widthM / STYLE_PX_PER_M).y;
    const tall = { ...CHAT_WINDOW, heightPx: full.height + top + 40 };
    show('chatTranscript', tall, transcript(false, { error: 'Turn failed: the provider stopped answering.', footer: 'Stopped' }), {
      title: 'Agent · Range end edge',
      closable: true,
    });
  }
  show('chatWindowEnd', CHAT_WINDOW, transcript(true), { title: 'Agent · Range end edge', closable: true, movable: true });
  show('chatWelcome', CHAT_WINDOW, transcript(false, { items: [], live: false, working: null, welcome: 'What would you like to fix?' }), {
    title: 'Agent · New chat',
    closable: true,
    movable: true,
  });
  show('chatRequests', CHAT_WINDOW, transcript(false, {
    items: CHAT_FIXTURE.slice(0, 2),
    live: false,
    working: null,
    requests: [QUESTION_FIXTURE, APPROVAL_FIXTURE],
    answers: new Map([['q1', choose(answerState(QUESTION_FIXTURE), 'scope', 0)]]),
    notices: new Map([['q1', 'Answer each question before sending.']]),
    open: new Map([['review:a1', true]]),
    footer: 'Waiting for your response',
  }), { title: 'Agent · Range end edge', closable: true, movable: true });
  const loadingCard = { kind: 'loading', title: 'Opening project', detail: 'editor-core' } as const;
  show('loadingCard', STATUS_CARD, (ctx, w, h, u) => drawStatusCard(ctx, w, h, u, loadingCard), {
    title: statusTitle(loadingCard),
  });
  const errorCard = { kind: 'error', text: 'Could not open editor-core: Failed to fetch' } as const;
  show('errorCard', STATUS_CARD, (ctx, w, h, u) => drawStatusCard(ctx, w, h, u, errorCard, 'retry'), {
    title: statusTitle(errorCard),
    hue: THEME.alert,
  });
}

drawAll().then(() => {
  window.__panels = { ready: true, regions };
});

declare global {
  interface Window {
    __panels?: { ready: boolean; regions: Record<string, HitRegion[]> };
  }
}
