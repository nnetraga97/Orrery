// Chats per provider and project, kept on this device: a new chat, its title and badge, the list newest first, and a
// size-capped JSON form for storage. A thread carries both what the transcript shows (items, requests) and the
// conversation sent to the model (messages, in the wire format), so a restored chat can carry on.
import type { ChatThread } from './types.ts';

export type StoredThread = ChatThread & {
  provider: string;
  dataset: string;
  /** The conversation in the wire format (src/core/agent/wire.ts). */
  messages: unknown[];
  /** The workspace files this chat changed, by path, with their text: restored together with the chat. */
  files?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
};
export type ThreadSummary = {
  id: string;
  provider: string;
  dataset: string;
  title: string;
  badge: Badge;
  updatedAt: number;
};
export type Badge = 'Working' | 'Needs input' | null;

export const MAX_THREAD_BYTES = 2 * 1024 * 1024;
const REMOVED = '[output removed to save space]';

let counter = 0;
const newId = (now: number) => `t${now.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createThread(provider: string, dataset: string, now = Date.now(), id = newId(now)): StoredThread {
  return { id, provider, dataset, items: [], requests: [], messages: [], status: 'idle', createdAt: now, updatedAt: now };
}

/** The thread's own title, else its first user message on one line, cut at 48 characters, else "New chat". */
export function titleFor(thread: ChatThread): string {
  if (thread.title?.trim()) return thread.title.trim();
  const first = thread.items?.find(item => item.type === 'userMessage' || item.role === 'user');
  const text = String(first?.text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 48 ? text.slice(0, 47).trimEnd() + '…' : text;
}

export function badge(thread: ChatThread): Badge {
  if (thread.requests?.length) return 'Needs input';
  if (thread.status === 'running') return 'Working';
  return null;
}

/** The list with the thread put in (replacing one with its id), newest first. */
export function upsert<T extends { id: string; updatedAt: number }>(list: readonly T[], thread: T): T[] {
  return [thread, ...list.filter(t => t.id !== thread.id)].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function lastFor<T extends { provider: string; dataset: string; updatedAt: number }>(list: readonly T[], provider: string, dataset: string): T | null {
  let best: T | null = null;
  for (const t of list) if (t.provider === provider && t.dataset === dataset && (!best || t.updatedAt > best.updatedAt)) best = t;
  return best;
}

export const summaryOf = (t: StoredThread): ThreadSummary => ({
  id: t.id,
  provider: t.provider,
  dataset: t.dataset,
  title: titleFor(t),
  badge: badge(t),
  updatedAt: t.updatedAt,
});

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Tool output fields, oldest first: in the transcript's items and the conversation's tool results. */
function* outputs(thread: StoredThread): Generator<() => boolean> {
  for (const item of thread.items ?? []) {
    const i = item as unknown as Record<string, unknown>;
    for (const key of ['output', 'aggregatedOutput', 'result', 'contentItems'] as const)
      if (i[key] != null && i[key] !== REMOVED)
        yield () => {
          i[key] = REMOVED;
          return true;
        };
  }
  for (const message of thread.messages as { blocks?: { type?: string; content?: unknown }[] }[])
    for (const block of message?.blocks ?? [])
      if (block.type === 'tool_result' && block.content !== REMOVED)
        yield () => {
          block.content = REMOVED;
          return true;
        };
}

/** The thread as JSON of at most 2 MB: the oldest tool output is cut first; messages are never cut. */
export function toJSON(thread: StoredThread): string {
  let json = JSON.stringify(thread);
  if (bytes(json) <= MAX_THREAD_BYTES) return json;
  const copy = JSON.parse(json) as StoredThread;
  for (const cut of outputs(copy)) {
    cut();
    json = JSON.stringify(copy);
    if (bytes(json) <= MAX_THREAD_BYTES) break;
  }
  return json;
}

export function fromJSON(json: string): StoredThread | null {
  try {
    const t = JSON.parse(json) as StoredThread;
    if (!t || typeof t.id !== 'string' || typeof t.provider !== 'string' || typeof t.dataset !== 'string') return null;
    return { ...t, messages: Array.isArray(t.messages) ? t.messages : [], items: t.items ?? [], requests: t.requests ?? [] };
  } catch {
    return null;
  }
}
