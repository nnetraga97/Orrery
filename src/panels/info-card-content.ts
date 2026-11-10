// A pinned context item (what the copied scene code asks to show) -> the plain content of an info card.
import type { ContextItem } from '../ports/host.ts';
import type { InfoCard } from './draw-info-card.ts';

const plain = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
};

export function cardFromItem(item: ContextItem): InfoCard {
  let text = '';
  if (typeof item.body === 'function') {
    const div = document.createElement('div');
    item.body(div);
    text = div.textContent ?? '';
  } else if (typeof item.body === 'string') text = plain(item.body);
  const preview = Array.isArray(item.preview) ? (item.preview as unknown[]).filter(p => typeof p === 'string') : [];
  const lines = [...(preview as string[]), item.text ?? '', text]
    .join('\n')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    key: item.key ?? item.title ?? '',
    kind: item.kind ?? '',
    title: item.title ?? item.key ?? '',
    sub: item.sub,
    color: item.color,
    text: lines.join('\n'),
    actions: (item.actions ?? []).map(a => ({ label: a.label, primary: !!(a as { primary?: boolean }).primary })),
  };
}
