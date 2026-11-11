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
    save(thread: StoredThread): boolean {
      let list = upsert(readIndex(), summaryOf(thread));
      for (const old of list.slice(KEEP)) kv.remove(`chat:${old.id}`);
      list = list.slice(0, KEEP);
      const json = toJSON(thread);
      // When the device's storage is full, the oldest other chats make room, one at a time.
      while (kv.set(`chat:${thread.id}`, json) === false) {
        const oldest = [...list].reverse().find(t => t.id !== thread.id);
        if (!oldest) {
          kv.set(INDEX, JSON.stringify(list.filter(t => t.id !== thread.id)));
          return false;
        }
        kv.remove(`chat:${oldest.id}`);
        list = list.filter(t => t.id !== oldest.id);
      }
      kv.set(INDEX, JSON.stringify(list));
      return true;
    },
    remove(id: string) {
      kv.remove(`chat:${id}`);
      kv.set(INDEX, JSON.stringify(readIndex().filter(t => t.id !== id)));
    },
  };
}
export type ThreadStore = ReturnType<typeof createThreadStore>;
