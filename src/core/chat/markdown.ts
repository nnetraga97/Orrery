// The chat's small Markdown subset, as data (the desktop chat's reference/desktop-app/viewer/app/panels/Markdown.tsx):
// paragraphs with their line breaks, headings at levels 1 to 4, flat lists, fenced code with a language. Inline: bold
// and code only. Links, tables, italics and HTML stay literal text, so provider text can never add markup.

export type Run = { text: string; bold?: boolean; code?: boolean };
export type Block =
  | { kind: 'paragraph'; lines: Run[][] }
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'list'; ordered: boolean; items: Run[][] }
  | { kind: 'code'; language: string; lines: string[] };

const codeRuns = (text: string, bold: boolean): Run[] =>
  text
    .split(/(`[^`\n]+`)/g)
    .filter(Boolean)
    .map(part => {
      const code = part.length > 2 && part.startsWith('`') && part.endsWith('`');
      return { text: code ? part.slice(1, -1) : part, ...(code ? { code: true } : {}), ...(bold ? { bold: true } : {}) };
    });

export function inline(text: string): Run[] {
  return String(text)
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .flatMap(part =>
      part.length > 1 && part.startsWith('`') && part.endsWith('`')
        ? [{ text: part.slice(1, -1), code: true }]
        : part.length > 4 && part.startsWith('**') && part.endsWith('**')
          ? // Code inside bold ("**`file.ts:84`**", as models write list leads) is still code.
            codeRuns(part.slice(2, -2), true)
          : [{ text: part }],
    );
}

export function parseMarkdown(text: string): Block[] {
  const out: Block[] = [];
  // The code block, list or paragraph that the next line may extend.
  let open: Block | null = null;
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
    const heading = line.match(/^(#{1,4})\s+(.+)/),
      bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
    if (heading) {
      out.push({ kind: 'heading', level: heading[1].length, runs: inline(heading[2]) });
      open = null;
    } else if (bullet) {
      if (open?.kind !== 'list') out.push((open = { kind: 'list', ordered: /^\s*\d/.test(line), items: [] }));
      open.items.push(inline(bullet[1]));
    } else {
      if (open?.kind !== 'paragraph') out.push((open = { kind: 'paragraph', lines: [] }));
      open.lines.push(inline(line));
    }
  }
  return out;
}
