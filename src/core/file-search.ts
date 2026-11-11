// Finding a file by voice. Speech gives words ("cursor common", "range dot ts", "find the word separator file"); file
// names are written as one token (cursorCommon.ts, range.ts, wordSeparators.ts). spokenQueries turns what was said into
// the written forms worth trying, and findFiles runs each through the copied search (galaxy/viewer/app/graph.ts),
// keeping the first ranking each file got. The Search page lists the results; pinching one selects the file.
import { Builder } from './chat/layout.ts';
import type { ChatLayout, ChatMetrics, Measure } from './chat/layout.ts';

export type FoundFile = { path: string; name: string };

// Words that ask rather than name: "find", "open the", "show me", "go to", "file".
const FILLER = new Set(['find', 'open', 'show', 'me', 'go', 'to', 'the', 'a', 'an', 'file', 'files', 'please', 'search', 'for', 'where', 'is', 'called', 'named']);

/** The written forms of a spoken file name, best first: the words joined, then joined by - and _, then the longest word. */
export function spokenQueries(spoken: string): string[] {
  const words = spoken
    .toLowerCase()
    .replace(/\s+dot\s+/g, '.')
    .replace(/\bslash\b/g, '/')
    .replace(/[^a-z0-9./_\-\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !FILLER.has(w));
  if (!words.length) return [];
  const out = [words.join(''), words.join('-'), words.join('_'), [...words].sort((a, b) => b.length - a.length)[0]];
  return [...new Set(out.filter(q => q.length > 1))];
}

/** Files for what was said, at most `limit`, from `search` (the copied search over the open project). */
export function findFiles(spoken: string, search: (query: string) => FoundFile[], limit = 8): FoundFile[] {
  const seen = new Set<string>();
  const out: FoundFile[] = [];
  for (const q of spokenQueries(spoken))
    for (const f of search(q)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(f);
      if (out.length >= limit) return out;
    }
  return out;
}

export type SearchView = {
  /** What was heard, or null before anything was said. */
  heard: string | null;
  results: FoundFile[];
  listening: boolean;
  partial: string;
  selected: string | null;
  micAvailable: boolean;
};

/** The Search page: a hold-to-talk button (`search:mic`), what was heard, and the files found (`file:<path>`). */
export function layoutSearch(view: SearchView, metrics: ChatMetrics, measure: Measure): ChatLayout {
  const b = new Builder(metrics, measure);
  b.line('cardTitle', [{ text: 'FIND A FILE', x: b.left, font: 'label', tone: 'line' }], 'label');
  b.gap(6);
  b.text('notice', [{ text: view.micAvailable ? 'Pinch and hold, then say part of a file name.' : "Voice isn't available here.", font: 'small', tone: 'dim' }], b.left);
  b.gap(10);
  if (view.micAvailable) b.chips([{ id: 'search:mic', label: view.listening ? 'Listening…' : 'Hold to speak', icon: 'mic', lit: true }]);
  if (view.listening && view.partial) {
    b.gap(8);
    b.text('notice', [{ text: `“${view.partial}”`, font: 'body', tone: 'text' }], b.left);
  }
  if (view.heard != null && !view.listening) {
    b.gap(b.m.gap);
    b.text('notice', [{ text: `“${view.heard}”`, font: 'body', tone: 'text' }], b.left);
    b.gap(8);
    if (!view.results.length) b.text('notice', [{ text: 'No file matches that. Try another part of its name.', font: 'small', tone: 'dim' }], b.left);
    for (const f of view.results) {
      const top = b.y;
      const h = b.lh('body') + b.lh('small') + 20;
      b.box('chip', b.left, top, b.right - b.left, h, { id: `file:${f.path}`, tone: f.path === view.selected ? 'line' : undefined });
      b.y += 10;
      b.line('notice', [{ text: f.name, x: b.left + 20, font: 'body', tone: 'line' }], 'body');
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      b.line('notice', dir ? [{ text: dir, x: b.left + 20, font: 'small', tone: 'dim' }] : [], 'small');
      b.y = top + h;
      b.region(`file:${f.path}`, b.left, top, b.right - b.left, h);
      b.gap(10);
    }
  }
  b.gap(metrics.pad);
  return { lines: b.lines, boxes: b.boxes, regions: b.regions, height: b.y };
}
