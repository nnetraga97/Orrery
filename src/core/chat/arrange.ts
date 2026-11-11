// The transcript in display order (the desktop chat's arrange, reference/desktop-app/viewer/app/panels/
// CodexTranscript.tsx): messages, plans and turn diffs stand alone; the actions between two of them form one group,
// and a group of one action is drawn as a plain row. Keys are the item's id, or its index when it has none.
import { isAction } from './describe.ts';
import type { ChatItem } from './types.ts';

export type Entry =
  | { kind: 'message'; key: string; item: ChatItem }
  | { kind: 'row'; key: string; item: ChatItem }
  | { kind: 'group'; key: string; items: ChatItem[] };

const keyOf = (item: ChatItem, index: number) => item.id ?? `i${index}`;

export function arrange(items: ChatItem[]): Entry[] {
  const out: Entry[] = [];
  let run: ChatItem[] | null = null;
  items.forEach((item, i) => {
    if (!isAction(item)) {
      run = null;
      out.push({ kind: 'message', key: keyOf(item, i), item });
    } else if (run) run.push(item);
    else out.push({ kind: 'group', key: keyOf(item, i), items: (run = [item]) });
  });
  return out.map(entry =>
    entry.kind === 'group' && entry.items.length === 1 ? { kind: 'row', key: entry.key, item: entry.items[0] } : entry,
  );
}
