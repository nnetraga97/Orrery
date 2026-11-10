// The agent's work in the transcript, laid out like a coding agent's desktop app. Each action is one compact row (an
// icon, what was done, to what) that expands to its output or diff. The actions between two messages fold into one
// group whose summary says what happened ("Thought, read 3 files, ran 2 commands"); a group stays open while the
// agent works in it and closes when the turn ends, unless the reader chose otherwise. Thinking folds the same way.
// While a turn runs, a line at the end of the transcript says what the agent is doing and for how long.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CodexChange, CodexItem, CodexThread } from '../codex-chat.ts';
import { projectStore } from '../project-store.ts';
import { Icon } from './Icon.tsx';
import { Markdown } from './Markdown.tsx';

// ---------- timing ----------
// When an item was first seen running and when it finished, for "Thought for 8s"; when each turn began, for the
// elapsed time. Items loaded from history were never seen running and carry no duration.
const seen = new Map<string, { start: number; end?: number }>(),
  turns = new Map<string, number>();
const isLive = (item: CodexItem) => item.status === 'inProgress' || item.status === 'running';
export function track(thread: CodexThread | null) {
  const now = Date.now();
  if (thread?.turnId && !turns.has(thread.turnId)) turns.set(thread.turnId, now);
  for (const item of thread?.items || []) {
    if (!item.id) continue;
    let t = seen.get(item.id);
    if (!t && isLive(item)) seen.set(item.id, (t = { start: now }));
    if (t && !isLive(item) && t.end == null) t.end = now;
  }
}
const durationOf = (item: CodexItem) => {
  const t = item.id ? seen.get(item.id) : null;
  return t?.end != null ? t.end - t.start : (item.durationMs ?? null);
};
const seconds = (ms: number) =>
  ms < 60000
    ? `${Math.max(1, Math.round(ms / 1000))}s`
    : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

// ---------- what an item did ----------
const text = (value: unknown) => (Array.isArray(value) ? value.join(' ') : String(value ?? ''));
const firstLine = (value: unknown) => text(value).trim().split('\n')[0];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function textOf(item: CodexItem) {
  if (typeof item.text === 'string') return item.text;
  if (Array.isArray(item.content)) return item.content.map(c => c.text || '').join('\n');
  if (Array.isArray(item.summary)) return item.summary.map(s => (typeof s === 'string' ? s : s.text || '')).join('\n');
  return '';
}
const kindOf = (change: CodexChange) => (typeof change.kind === 'string' ? change.kind : change.kind?.type) || 'update';
// Lines added and removed by a change. A new file's diff may be its plain contents: every line is an addition.
function stat(change: CodexChange) {
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
const total = (changes: CodexChange[]) =>
  changes
    .map(stat)
    .reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 });
function Stat({ added, removed }: { added: number; removed: number }) {
  if (!added && !removed) return null;
  return (
    <span className="agent-stat">
      {!!added && <span className="added">+{added}</span>}
      {!!removed && <span className="removed">−{removed}</span>}
    </span>
  );
}
const pathOf = (change: CodexChange) => change.path || change.file || 'file';

type Action = { icon: string; verb: string; target?: string; meta?: ReactNode; failed?: boolean };
const commandKind = (item: CodexItem) => {
  const kinds = new Set((item.commandActions || []).map(a => (a.type === 'list_files' ? 'listFiles' : a.type)));
  return kinds.size === 1 ? [...kinds][0] : 'command';
};
export function describe(item: CodexItem): Action {
  const live = isLive(item);
  switch (item.type) {
    case 'commandExecution': {
      const actions = item.commandActions || [],
        failed = item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0);
      const kind = commandKind(item);
      if (kind === 'read')
        return {
          icon: 'file',
          verb: live ? 'Reading' : 'Read',
          target: actions.map(a => a.name || a.path?.split('/').pop() || '').join(', '),
          failed,
        };
      if (kind === 'search')
        return {
          icon: 'search',
          verb: live ? 'Searching for' : 'Searched for',
          target: actions.map(a => a.query || a.command || '').join(', '),
          meta: actions[0]?.path ? `in ${actions[0].path}` : null,
          failed,
        };
      if (kind === 'listFiles')
        return {
          icon: 'list',
          verb: live ? 'Listing' : 'Listed',
          target: actions.map(a => a.path || '.').join(', '),
          failed,
        };
      return {
        icon: 'terminal',
        verb: live ? 'Running' : 'Ran',
        target: firstLine(item.command),
        meta: failed ? (item.exitCode != null ? `exit ${item.exitCode}` : 'failed') : null,
        failed,
      };
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
      return {
        icon: verb.startsWith('Creat') ? 'fileAdd' : verb.startsWith('Delet') ? 'fileRemove' : 'pencil',
        verb,
        target: changes.length === 1 ? pathOf(changes[0]) : plural(changes.length, 'file'),
        meta: <Stat {...total(changes)} />,
        failed: item.status === 'failed' || item.status === 'declined',
      };
    }
    case 'mcpToolCall':
    case 'dynamicToolCall':
      if (item.tool === 'show_user' && item.title)
        return { icon: 'sparkles', verb: item.title, failed: item.status === 'failed' };
      return {
        icon: 'plug',
        verb: live ? 'Calling' : 'Called',
        target: [item.server, item.tool].filter(Boolean).join(' · ') || 'a tool',
        failed: item.status === 'failed',
      };
    case 'webSearch':
      return { icon: 'globe', verb: live ? 'Searching the web for' : 'Searched the web for', target: item.query || '' };
    case 'contextCompaction':
      return { icon: 'compress', verb: live ? 'Compacting the conversation' : 'Compacted the conversation' };
    default:
      return { icon: 'sparkles', verb: item.title || String(item.type || 'Activity') };
  }
}

// Messages, plans and turn diffs stand on their own; everything else is an action that folds into a group.
export const isAction = (item: CodexItem) =>
  !['userMessage', 'agentMessage', 'assistantMessage', 'plan', 'turnDiff', 'imageView', 'imageGeneration'].includes(
    item.type || '',
  ) &&
  item.role !== 'user' &&
  item.role !== 'assistant';

// "Thought, read 3 files, ran 2 commands, edited main.ts"
export function summarize(items: CodexItem[]) {
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

// ---------- rows ----------
function Diff({ changes }: { changes: CodexChange[] }) {
  return (
    <div className="agent-diffs">
      {changes.map((change, i) => (
        <div key={i} className="agent-diff">
          <div className="agent-diff-path">
            <span>{pathOf(change)}</span>
            <Stat {...stat(change)} />
          </div>
          <pre>
            {String(change.diff || change.patch || '')
              .split('\n')
              .map((line, j) => (
                <span
                  key={j}
                  className={
                    line.startsWith('@@')
                      ? 'hunk'
                      : line.startsWith('+')
                        ? 'addition'
                        : line.startsWith('-')
                          ? 'deletion'
                          : undefined
                  }
                >{`${line}\n`}</span>
              ))}
          </pre>
        </div>
      ))}
    </div>
  );
}
export { Diff as ChangeDiff };

function Detail({ item }: { item: CodexItem }) {
  if (item.type === 'commandExecution') {
    const output = item.output || item.aggregatedOutput;
    return (
      <div className="agent-terminal">
        <div className="agent-terminal-command">
          <span aria-hidden="true">$</span> {text(item.command)}
        </div>
        {output && <pre>{output}</pre>}
        {item.exitCode != null && item.exitCode !== 0 && <div className="agent-exit">Exit code {item.exitCode}</div>}
      </div>
    );
  }
  if (item.type === 'fileChange') return <Diff changes={item.changes || []} />;
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const args = item.arguments == null ? '' : JSON.stringify(item.arguments, null, 2),
      // Codex reports a dynamic tool's output as contentItems; the other providers as result.
      output = item.result ?? item.contentItems?.map(content => content.text ?? '').join('\n'),
      result = output == null ? '' : typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    return (
      <div className="agent-terminal">
        {args && <pre className="agent-args">{args}</pre>}
        {result && <pre>{result}</pre>}
      </div>
    );
  }
  const body = textOf(item) || item.query || '';
  return body ? <Markdown text={body} /> : null;
}
const hasDetail = (item: CodexItem) =>
  item.type === 'commandExecution' ||
  (item.type === 'fileChange' && !!item.changes?.length) ||
  item.type === 'mcpToolCall' ||
  item.type === 'dynamicToolCall' ||
  !!textOf(item);

export function ActionRow({ item }: { item: CodexItem }) {
  const [open, setOpen] = useState(false);
  const a = describe(item),
    live = isLive(item),
    expandable = hasDetail(item);
  return (
    <div className={`agent-action${a.failed ? ' failed' : ''}`}>
      <button
        type="button"
        className="agent-row"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        title={a.target ? `${a.verb} ${a.target}` : a.verb}
      >
        <span className="agent-row-icon">
          <Icon name={a.failed ? 'alert' : a.icon} />
        </span>
        <span className={`agent-verb${live ? ' shimmer' : ''}`}>{a.verb}</span>
        {a.target && <code className="agent-target">{a.target}</code>}
        {a.meta && <span className="agent-meta">{a.meta}</span>}
        {expandable && (
          <span className={`agent-chevron${open ? ' open' : ''}`}>
            <Icon name="chevron" />
          </span>
        )}
      </button>
      {open && (
        <div className="agent-detail">
          <Detail item={item} />
        </div>
      )}
    </div>
  );
}

// Codex reasoning summaries open with a bold title; it names the row, and the rest is what expands.
export function ThinkingRow({ item }: { item: CodexItem }) {
  const [open, setOpen] = useState(false);
  const body = textOf(item),
    live = isLive(item),
    title = body.match(/^\s*\*\*(.+?)\*\*/)?.[1],
    rest = title ? body.replace(/^\s*\*\*(.+?)\*\*\s*/, '') : body,
    ms = durationOf(item);
  const label = live ? title || 'Thinking' : title || (ms != null ? `Thought for ${seconds(ms)}` : 'Thought');
  return (
    <div className="agent-action agent-thinking">
      <button
        type="button"
        className="agent-row"
        aria-expanded={rest ? open : undefined}
        disabled={!rest}
        onClick={() => setOpen(!open)}
      >
        <span className="agent-row-icon">
          <Icon name="thought" />
        </span>
        <span className={`agent-verb${live ? ' shimmer' : ''}`}>{label}</span>
        {!live && title && ms != null && <span className="agent-meta">{seconds(ms)}</span>}
        {rest && (
          <span className={`agent-chevron${open ? ' open' : ''}`}>
            <Icon name="chevron" />
          </span>
        )}
      </button>
      {open && (
        <div className="agent-detail agent-thought">
          <Markdown text={rest} />
        </div>
      )}
    </div>
  );
}

const Row = ({ item }: { item: CodexItem }) =>
  item.type === 'reasoning' ? <ThinkingRow item={item} /> : <ActionRow item={item} />;

export function ActionGroup({ items, live }: { items: CodexItem[]; live: boolean }) {
  // Open while the agent works in it; afterwards it follows the reader's last choice.
  const [chosen, setChosen] = useState<boolean | null>(null);
  if (items.length === 1) return <Row item={items[0]} />;
  const open = chosen ?? live,
    failed = items.filter(item => describe(item).failed).length;
  return (
    <div className={`agent-group${open ? ' open' : ''}`}>
      <button type="button" className="agent-group-head" aria-expanded={open} onClick={() => setChosen(!open)}>
        <span className={`agent-verb${live ? ' shimmer' : ''}`}>{summarize(items)}</span>
        {failed > 0 && <span className="agent-meta failed">{plural(failed, 'failure')}</span>}
        <span className={`agent-chevron${open ? ' open' : ''}`}>
          <Icon name="chevron" />
        </span>
      </button>
      {open && (
        <div className="agent-group-items">
          {items.map((item, i) => (
            <Row key={item.id || i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// The turn's plan as a checklist that updates in place.
export function PlanCard({ item }: { item: CodexItem }) {
  const steps = item.plan || [],
    done = steps.filter(s => s.status === 'completed').length;
  return (
    <section className="agent-plan" aria-label="Plan">
      <div className="agent-plan-head">
        <Icon name="checklist" />
        <span>Plan</span>
        <span className="agent-meta">
          {done} of {steps.length} done
        </span>
      </div>
      {textOf(item) && <Markdown text={textOf(item)} />}
      <ol>
        {steps.map((step, i) => (
          <li key={i} className={step.status || 'pending'}>
            <span className="agent-step-mark" aria-hidden="true">
              {step.status === 'completed' && <Icon name="check" />}
            </span>
            <span>{step.step || step.text || ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Everything the turn changed, as one expandable summary.
export function TurnChanges({ item }: { item: CodexItem }) {
  const [open, setOpen] = useState(false);
  const files = String(item.diff || textOf(item))
    .split(/^(?=diff --git )/m)
    .filter(part => part.trim());
  const changes = files.map(part => ({
    path: part.match(/^diff --git a\/(\S+)/)?.[1] || 'Working changes',
    diff: part
      .split('\n')
      .slice(part.startsWith('diff --git') ? 4 : 0)
      .join('\n'),
  }));
  if (!changes.length) return null;
  return (
    <div className="agent-action agent-turn-changes">
      <button type="button" className="agent-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="agent-row-icon">
          <Icon name="diff" />
        </span>
        <span className="agent-verb">Changed {plural(changes.length, 'file')} this turn</span>
        <span className="agent-meta">
          <Stat {...total(changes)} />
        </span>
        <span className={`agent-chevron${open ? ' open' : ''}`}>
          <Icon name="chevron" />
        </span>
      </button>
      {open && (
        <div className="agent-detail">
          <Diff changes={changes} />
        </div>
      )}
    </div>
  );
}

// ---------- the live line ----------
export function WorkingLine({ thread }: { thread: CodexThread }) {
  const [, tick] = useState(0);
  const panelOpen = useSyncExternalStore(projectStore.subscribe, () => projectStore.get().panelOpen);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const visible = panelOpen && documentVisible;
  useEffect(() => {
    if (!visible) return;
    tick(n => n + 1);
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [visible]);
  const started = (thread.turnId && turns.get(thread.turnId)) || Date.now();
  const current = useMemo(() => {
    const items = thread.items || [];
    for (let i = items.length - 1; i >= 0; i--) if (isLive(items[i])) return items[i];
  }, [thread.items]);
  // The verb only: the live row above already names its target.
  let doing = 'Working';
  if (current?.type === 'reasoning') doing = 'Thinking';
  else if (current && isAction(current)) doing = describe(current).verb.replace(/ (for|the web for)$/, '');
  else if (current) doing = 'Writing';
  return (
    <div className="agent-working" role="status" data-paused={!visible || undefined}>
      <span className="agent-glyph" aria-hidden="true">
        ✳
      </span>
      <span className="agent-working-text shimmer">{doing}…</span>
      <span className="agent-elapsed">{seconds(Date.now() - started)}</span>
    </div>
  );
}
