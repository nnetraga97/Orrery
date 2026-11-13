// What the app tells the model about where the user is, appended to their message as a bracketed note: the open
// problem card (once, with a chat's first message), then the most specific of the code card's function and selected
// lines, the landed function, or the selected file. The user cannot type, so "fix it" and "what does this do?" only
// make sense with it. The composer's "What I'm looking at" chip shows the label and switches the place part off.
import type { LineRange } from '../code-view.ts';

export type Where = {
  /** The open problem card, while its bug is in the file. */
  problem?: { title: string; text: string; file: string; line: number; fn: string } | null;
  /** The file selected at the overview. */
  selected?: string | null;
  /** The landed file, and the function its globe shows when the file has several. */
  landed?: { file: string; fn: string | null } | null;
  /** The code card: its file, its function and that function's lines, the selected lines, and the file's text. */
  code?: { file: string; fn: string | null; fnRange: LineRange | null; range: LineRange | null; lines: readonly string[] } | null;
};

/** Functions longer than this are sent as their selected lines only. */
export const MAX_FUNCTION_LINES = 60;
export const NOTE_HEAD = '[Note from the app, not said by the user]';

const name = (path: string) => path.split('/').pop() ?? path;
const numbered = (lines: readonly string[], range: LineRange) =>
  lines
    .slice(range.start - 1, range.end)
    .map((text, k) => `${range.start + k}\t${text}`)
    .join('\n');

/** The chip's label ("range.ts:97–99", "range.ts · containsPosition", "range.ts"), or null when nothing is in view. */
export function lookingLabel(w: Where): string | null {
  if (w.code) {
    const r = w.code.range ?? w.code.fnRange;
    return r ? `${name(w.code.file)}:${r.start}–${r.end}` : name(w.code.file);
  }
  if (w.landed) return w.landed.fn ? `${name(w.landed.file)} · ${w.landed.fn}` : name(w.landed.file);
  return w.selected ? name(w.selected) : null;
}

function place(w: Where): string | null {
  const c = w.code;
  if (c) {
    const fn = c.fnRange && c.fn ? `function ${c.fn} (lines ${c.fnRange.start}–${c.fnRange.end})` : null;
    const selected = c.range ? `lines ${c.range.start}–${c.range.end} selected` : null;
    const head = `The user has the code card open on ${c.file}${fn ? `, ${fn}` : ''}${selected ? `, with ${selected}` : ''}.`;
    // The whole function when it is short, so "explain this" needs no tool call; else the selected lines.
    const body = c.fnRange && c.fnRange.end - c.fnRange.start < MAX_FUNCTION_LINES ? c.fnRange : c.range;
    return body ? `${head}\n${numbered(c.lines, body)}` : head;
  }
  if (w.landed) return `The user has landed on ${w.landed.fn ? `the function ${w.landed.fn} in ` : ''}${w.landed.file}.`;
  return w.selected ? `The user has the file ${w.selected} selected.` : null;
}

export const UNDONE = 'The user undid the file changes from your last turn: the files are as they were before it.';

/**
 * The note for a message, or '' when there is nothing to say. `first` adds the open problem (a chat's first message);
 * `attach` is the "What I'm looking at" chip; `undone` says the user took back the last turn's changes.
 */
export function contextNote(w: Where, options: { first: boolean; attach: boolean; undone?: boolean }): string {
  const parts: string[] = options.undone ? [UNDONE] : [];
  const p = w.problem;
  if (options.first && p) parts.push(`A problem card is open: "${p.title}" ${p.text} It names ${p.fn} in ${p.file}, line ${p.line}.`);
  const where = options.attach ? place(w) : null;
  if (where) parts.push(where);
  return parts.length ? `\n\n${NOTE_HEAD}\n${parts.join('\n')}` : '';
}
