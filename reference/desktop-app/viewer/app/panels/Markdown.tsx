// Provider text rendered through a deliberately small Markdown subset: no provider-supplied HTML or links.
import { Fragment } from 'react';

function inline(text: string) {
  return String(text)
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

type Block =
  | { kind: 'code'; language: string; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; lines: string[] };

function blocks(text: string) {
  const out: Block[] = [];
  let open: Block | null = null; // the code block, list or paragraph that the next line may extend
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (open?.kind === 'code') open = null;
      else out.push((open = { kind: 'code', language: line.trim().slice(3).trim(), lines: [] }));
      continue;
    }
    if (open?.kind === 'code') {
      open.lines.push(line);
      continue;
    }
    if (!line.trim()) {
      open = null;
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)/),
      bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
    if (heading) {
      out.push({ kind: 'heading', text: heading[1] });
      open = null;
    } else if (bullet) {
      if (open?.kind !== 'list') out.push((open = { kind: 'list', ordered: /^\s*\d/.test(line), items: [] }));
      open.items.push(bullet[1]);
    } else {
      if (open?.kind !== 'paragraph') out.push((open = { kind: 'paragraph', lines: [] }));
      open.lines.push(line);
    }
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="codex-prose">
      {blocks(text).map((b, i) => {
        if (b.kind === 'code')
          return (
            <div key={i} className="codex-code">
              {b.language && <div className="codex-code-language">{b.language}</div>}
              <pre>
                <code>{b.lines.join('\n')}</code>
              </pre>
            </div>
          );
        if (b.kind === 'heading') return <h4 key={i}>{inline(b.text)}</h4>;
        if (b.kind === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
