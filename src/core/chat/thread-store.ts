// The chats kept on this device: an index of summaries under one key, each thread under its own. Works over any small
// key-value store (the app passes its StoragePort).
import { fromJSON, summaryOf, toJSON, upsert } from './threads.ts';
import type { StoredThread, ThreadSummary } from './threads.ts';

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): boolean | void;
  remove(key: string): void;
}

const INDEX = 'chats';
const KEEP = 50;

export function createThreadStore(kv: KeyValue) {
  const readIndex = (): ThreadSummary[] => {
    try {
      const list = JSON.parse(kv.get(INDEX) ?? '[]');
      return Array.isArray(list) ? list.filter(t => t && typeof t.id === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    /** Summaries, newest first. */
    list: readIndex,
    load(id: string): StoredThread | null {
      const json = kv.get(`chat:${id}`);
      return json ? fromJSON(json) : null;
    },
    /** Saves a thread and its summary; the oldest chats beyond fifty are dropped. */
    save(thread: StoredThread) {
      kv.set(`chat:${thread.id}`, toJSON(thread));
      const list = upsert(readIndex(), summaryOf(thread));
      for (const old of list.slice(KEEP)) kv.remove(`chat:${old.id}`);
      kv.set(INDEX, JSON.stringify(list.slice(0, KEEP)));
    },
    remove(id: string) {
      kv.remove(`chat:${id}`);
      kv.set(INDEX, JSON.stringify(readIndex().filter(t => t.id !== id)));
    },
  };
}
export type ThreadStore = ReturnType<typeof createThreadStore>;
