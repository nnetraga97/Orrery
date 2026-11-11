// What each item in the agent's work did, in the desktop chat's wording (reference/desktop-app/viewer/app/panels/
// CodexActions.tsx), as data instead of React elements: one compact row per action (an icon, a verb, a target, a meta
// note), a one-sentence summary for a group of actions, the label of a thinking row and the working line.
import type { ChatChange, ChatItem } from './types.ts';

export type Stat = { added: number; removed: number };
export type Action = {
  icon: string;
  verb: string;
  target?: string;
  meta?: string;
  /** Lines added and removed, for a file change that has any. */
  added?: number;
  removed?: number;
  failed: boolean;
  live: boolean;
};

export const isLive = (item: ChatItem) => item.status === 'inProgress' || item.status === 'running';

/** "12s" under a minute, "1m 5s" after; never less than 1s. */
export const duration = (ms: number) =>
  ms < 60000
    ? `${Math.max(1, Math.round(ms / 1000))}s`
    : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

const text = (value: unknown) => (Array.isArray(value) ? value.join(' ') : String(value ?? ''));
const firstLine = (value: unknown) => text(value).trim().split('\n')[0];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function textOf(item: ChatItem) {
  if (typeof item.text === 'string') return item.text;
  if (Array.isArray(item.content)) return item.content.map(c => c.text || '').join('\n');
  if (Array.isArray(item.summary)) return item.summary.map(s => (typeof s === 'string' ? s : s.text || '')).join('\n');
  return '';
}

export const kindOf = (change: ChatChange) =>
  (typeof change.kind === 'string' ? change.kind : change.kind?.type) || 'update';
export const pathOf = (change: ChatChange) => change.path || change.file || 'file';

/** Lines added and removed by a change. A new file's diff may be its plain contents: every line is an addition. */
export function stat(change: ChatChange): Stat {
  const lines = String(change.diff || change.patch || '').split('\n');
  if (kindOf(change) === 'add' && !lines.some(l => /^[+-]/.test(l)))
    return { added: lines.filter(Boolean).length, removed: 0 };
  let added = 0,
    removed = 0;
  for (const line of lines)
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  return { added, removed };
}

export const total = (changes: ChatChange[]): Stat =>
  changes.map(stat).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), {
    added: 0,
    removed: 0,
  });

/** "+3 −1", leaving out a zero side; undefined when nothing changed. */
export function statText({ added, removed }: Stat) {
  const parts = [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

const commandKind = (item: ChatItem) => {
  const kinds = new Set((item.commandActions || []).map(a => (a.type === 'list_files' ? 'listFiles' : a.type)));
  return kinds.size === 1 ? [...kinds][0] : 'command';
};

/** Drops undefined fields, so a row compares cleanly. */
function action(a: Action): Action {
  for (const key of Object.keys(a) as (keyof Action)[]) if (a[key] === undefined) delete a[key];
  return a;
}

export function describe(item: ChatItem): Action {
  const live = isLive(item);
  switch (item.type) {
    case 'commandExecution': {
      const actions = item.commandActions || [],
        failed = item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0);
      const kind = commandKind(item);
      if (kind === 'read')
        return action({
          icon: 'file',
          verb: live ? 'Reading' : 'Read',
          target: actions.map(a => a.name || a.path?.split('/').pop() || '').join(', '),
          failed,
          live,
        });
      if (kind === 'search')
        return action({
          icon: 'search',
          verb: live ? 'Searching for' : 'Searched for',
          target: actions.map(a => a.query || a.command || '').join(', '),
          meta: actions[0]?.path ? `in ${actions[0].path}` : undefined,
          failed,
          live,
        });
      if (kind === 'listFiles')
        return action({
          icon: 'list',
          verb: live ? 'Listing' : 'Listed',
          target: actions.map(a => a.path || '.').join(', '),
          failed,
          live,
        });
      return action({
        icon: 'terminal',
        verb: live ? 'Running' : 'Ran',
        target: firstLine(item.command),
        meta: failed ? (item.exitCode != null ? `exit ${item.exitCode}` : 'failed') : undefined,
        failed,
        live,
      });
    }
    case 'fileChange': {
      const changes = item.changes || [],
        kinds = new Set(changes.map(kindOf));
      const verb =
        kinds.size === 1 && kinds.has('add')
          ? live
            ? 'Creating'
            : 'Created'
          : kinds.size === 1 && kinds.has('delete')
            ? live
              ? 'Deleting'
              : 'Deleted'
            : live
              ? 'Editing'
              : 'Edited';
      const sum = total(changes),
        meta = statText(sum);
      return action({
        icon: verb.startsWith('Creat') ? 'fileAdd' : verb.startsWith('Delet') ? 'fileRemove' : 'pencil',
        verb,
        target: changes.length === 1 ? pathOf(changes[0]) : plural(changes.length, 'file'),
        meta,
        added: meta ? sum.added : undefined,
        removed: meta ? sum.removed : undefined,
        failed: item.status === 'failed' || item.status === 'declined',
        live,
      });
    }
    case 'mcpToolCall':
    case 'dynamicToolCall':
      if (item.tool === 'show_user' && item.title)
        return action({ icon: 'sparkles', verb: item.title, failed: item.status === 'failed', live });
      return action({
        icon: 'plug',
        verb: live ? 'Calling' : 'Called',
        target: [item.server, item.tool].filter(Boolean).join(' · ') || 'a tool',
        failed: item.status === 'failed',
        live,
      });
    case 'webSearch':
      return action({
        icon: 'globe',
        verb: live ? 'Searching the web for' : 'Searched the web for',
        target: item.query || '',
        failed: false,
        live,
      });
    case 'contextCompaction':
      return action({
        icon: 'compress',
        verb: live ? 'Compacting the conversation' : 'Compacted the conversation',
        failed: false,
        live,
      });
    default:
      return action({ icon: 'sparkles', verb: item.title || String(item.type || 'Activity'), failed: false, live });
  }
}

/** Messages, plans and turn diffs stand on their own; everything else is an action that folds into a group. */
export const isAction = (item: ChatItem) =>
  !['userMessage', 'agentMessage', 'assistantMessage', 'plan', 'turnDiff', 'imageView', 'imageGeneration'].includes(
    item.type || '',
  ) &&
  item.role !== 'user' &&
  item.role !== 'assistant';

/** A group's sentence: "Thought, read 3 files, ran 2 commands, edited main.ts". */
export function summarize(items: ChatItem[]) {
  let thought = 0,
    commands = 0,
    searches = 0,
    listings = 0,
    tools = 0,
    web = 0,
    compactions = 0;
  const read = new Set<string>(),
    edited = new Set<string>(),
    created = new Set<string>(),
    deleted = new Set<string>();
  for (const item of items) {
    if (item.type === 'reasoning') thought++;
    else if (item.type === 'commandExecution') {
      const kind = commandKind(item);
      if (kind === 'read') for (const a of item.commandActions || []) read.add(a.path || a.name || '');
      else if (kind === 'search') searches++;
      else if (kind === 'listFiles') listings++;
      else commands++;
    } else if (item.type === 'fileChange')
      for (const change of item.changes || [])
        (kindOf(change) === 'add' ? created : kindOf(change) === 'delete' ? deleted : edited).add(pathOf(change));
    else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') tools++;
    else if (item.type === 'webSearch') web++;
    else if (item.type === 'contextCompaction') compactions++;
  }
  const one = (set: Set<string>, verb: string) =>
    set.size
      ? set.size === 1
        ? `${verb} ${[...set][0].split('/').pop()}`
        : `${verb} ${plural(set.size, 'file')}`
      : null;
  const count = (n: number, verb: string, one: string, many: string) =>
    n ? `${verb} ${n === 1 ? one : `${n} ${many}`}` : null;
  const parts = [
    one(read, 'read'),
    count(searches, 'searched', 'once', 'times'),
    count(listings, 'listed', 'a folder', 'folders'),
    count(commands, 'ran', 'a command', 'commands'),
    one(edited, 'edited'),
    one(created, 'created'),
    one(deleted, 'deleted'),
    count(tools, 'called', 'a tool', 'tools'),
    count(web, 'searched the web', '', 'times')?.trim() ?? null,
    compactions ? 'compacted the conversation' : null,
  ].filter(Boolean) as string[];
  // Thinking is only the summary when it is all there was; otherwise it is one of the rows inside.
  const sentence = parts.join(', ') || (thought ? (thought === 1 ? 'Thought' : `Thought ${thought} times`) : 'Worked');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** How many of a group's actions failed. */
export const failures = (items: ChatItem[]) => items.filter(item => describe(item).failed).length;

/**
 * A thinking row: a leading **bold title** if the text has one, else "Thinking" while live, else "Thought for 8s" (or
 * "Thought" when the time is unknown). `elapsedMs` is how long it was seen running, or null; `durationMs` on the item
 * is the fallback. `meta` is the time beside a titled row; `rest` is the text that expands below it.
 */
export function thinkingLabel(item: ChatItem, elapsedMs: number | null) {
  const body = textOf(item),
    live = isLive(item),
    title = body.match(/^\s*\*\*(.+?)\*\*/)?.[1],
    rest = title ? body.replace(/^\s*\*\*(.+?)\*\*\s*/, '') : body,
    ms = elapsedMs ?? item.durationMs ?? null;
  const label = live ? title || 'Thinking' : title || (ms != null ? `Thought for ${duration(ms)}` : 'Thought');
  const meta = !live && title && ms != null ? duration(ms) : undefined;
  return meta ? { label, meta, rest, live } : { label, rest, live };
}

/** The working line: a word for what the latest live item is doing, and the turn's elapsed time. */
export function workingLabel(items: ChatItem[], elapsedMs: number) {
  let current: ChatItem | undefined;
  for (let i = items.length - 1; i >= 0; i--)
    if (isLive(items[i])) {
      current = items[i];
      break;
    }
  // The verb only: the live row above already names its target.
  let doing = 'Working';
  if (current?.type === 'reasoning') doing = 'Thinking';
  else if (current && isAction(current)) doing = describe(current).verb.replace(/ (for|the web for)$/, '');
  else if (current) doing = 'Writing';
  return { word: `${doing}…`, time: duration(elapsedMs) };
}
