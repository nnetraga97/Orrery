// panels.html: every panel drawn on a plain canvas from fixed sample data, stacked down the page, so each can be
// checked with a screenshot. Sets window.__panels = { ready, regions } for tests.
import type { HitRegion } from '../core/panel-hit.ts';
import { visibleLines } from '../core/code-view.ts';
import type { CodeView, Segment } from '../core/code-view.ts';
import { loadCodeFont } from './code-font.ts';
import { CODE_LAYOUT, CODE_PAGE, drawCodePage } from './draw-code-page.ts';
import { INFO_CARD, drawInfoCard } from './draw-info-card.ts';
import { STATUS_CARD, drawStatusCard } from './draw-status-card.ts';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => HitRegion[];
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
  mode: 'file',
};

function show(name: string, widthPx: number, heightPx: number, draw: Draw) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = name;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  canvas.style.width = `${Math.round(widthPx / 2)}px`;
  figure.append(caption, canvas);
  document.getElementById('panels')!.append(figure);
  regions[name] = draw(canvas.getContext('2d')!, widthPx, heightPx);
}

/** Every panel, in the order the plan adds them. Later tasks append here. */
export async function drawAll() {
  await loadCodeFont();
  show('infoCard', INFO_CARD.widthPx, INFO_CARD.heightPx, (ctx, w, h) =>
    drawInfoCard(ctx, w, h, {
      key: 'file:core/range.ts',
      kind: 'File',
      title: 'range.ts',
      sub: 'core/range.ts',
      color: '#7cc4ff',
      text: '461 lines · imports 2 · imported by 41\nGroup: core',
      actions: [{ label: 'Open', primary: true }, { label: 'Deselect' }],
    }),
  );
  show('codePage', CODE_PAGE.widthPx, CODE_PAGE.heightPx, (ctx, w, h) => {
    const rows = visibleLines(sampleView, { rows: CODE_LAYOUT.rows, columns: CODE_LAYOUT.columns, scrollTop: 0 });
    return drawCodePage(ctx, w, h, rows, {
      file: sampleView.file,
      functionName: 'containsPosition',
      mode: sampleView.mode,
      shown: { first: rows[0].number, last: rows[rows.length - 1].number, total: sampleView.lines.length },
      hovered: 'line:11',
    });
  });
  show('loadingCard', STATUS_CARD.widthPx, STATUS_CARD.heightPx, (ctx, w, h) =>
    drawStatusCard(ctx, w, h, { kind: 'loading', title: 'Opening project', detail: 'editor-core' }),
  );
  show('errorCard', STATUS_CARD.widthPx, STATUS_CARD.heightPx, (ctx, w, h) =>
    drawStatusCard(ctx, w, h, { kind: 'error', text: 'Could not open editor-core: Failed to fetch' }),
  );
}

drawAll().then(() => {
  window.__panels = { ready: true, regions };
});

declare global {
  interface Window {
    __panels?: { ready: boolean; regions: Record<string, HitRegion[]> };
  }
}
