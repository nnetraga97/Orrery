// Syntax tokens for a source file, ported from the desktop's highlightPlanetSource
// (reference/desktop-app/viewer/app/panels/planet-inspector/shared.tsx). Per line, segments { text, cls? } with classes
// tok-keyword, tok-string, tok-number and so on. Two sources, as on the desktop: the town builder's sourceTokens when
// present, otherwise the TypeScript scanner on window.ts. Source is never evaluated.
// One difference: the build budget yields without waiting for a window animation frame, which does not run while a
// headset session is presenting.
import type { Segment } from '../state/app-state.ts';
import { languageOf, loadTypeScript, planetBuildBudget } from './galaxy-session.js';

type Token = { start: number; end: number; cls: string };
type Rec = Record<string, unknown>;

interface TypeScriptScanner {
  scan(): number;
  getTokenPos(): number;
  getTextPos(): number;
}
interface TypeScriptGlobal {
  createScanner(target: number, skipTrivia: boolean, variant: number, text: string): TypeScriptScanner;
  ScriptTarget: { Latest: number };
  LanguageVariant: { Standard: number };
  SyntaxKind: Record<string, number>;
}

export async function highlightSource(
  file: { path?: string; name?: string },
  source: string,
  towns: Rec | null,
  signal?: AbortSignal,
): Promise<Segment[][]> {
  const checkpoint = planetBuildBudget(signal, undefined, { frameBound: false });
  const plain = () => source.split('\n').map(text => (text ? [{ text }] : []));
  let tokens: Token[] | null = null;
  const typescript = languageOf(file.path || file.name || '')?.frontEnd === 'typescript';
  const hasTokens = Array.isArray(towns?.sourceTokens);
  // The desktop page always had the compiler loaded; here it is fetched on first use (the copied loader).
  if (!hasTokens && typescript && source) await loadTypeScript().catch(() => null);
  const ts = (window as unknown as { ts?: TypeScriptGlobal }).ts;
  if (hasTokens && source) tokens = [...(towns!.sourceTokens as Token[])];
  else if (ts && source && typescript) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source),
      kind = ts.SyntaxKind,
      strings = [
        kind.StringLiteral,
        kind.NoSubstitutionTemplateLiteral,
        kind.TemplateHead,
        kind.TemplateMiddle,
        kind.TemplateTail,
      ],
      found: Token[] = [];
    let count = 0;
    for (let token = scanner.scan(); token !== kind.EndOfFileToken; token = scanner.scan()) {
      if (++count % 128 === 0) await checkpoint();
      const cls =
        token >= kind.FirstKeyword && token <= kind.LastKeyword
          ? 'tok-keyword'
          : strings.includes(token)
            ? 'tok-string'
            : token === kind.NumericLiteral
              ? 'tok-number'
              : '';
      if (cls) found.push({ start: scanner.getTokenPos(), end: scanner.getTextPos(), cls });
    }
    tokens = found;
  }
  if (!tokens) return plain();
  tokens.sort((a, b) => a.start - b.start);
  const lines: Segment[][] = [[]];
  const add = (text: string, cls?: string) =>
    text.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push(cls ? { text: part, cls } : { text: part });
    });
  let at = 0;
  let count = 0;
  for (const t of tokens) {
    if (++count % 256 === 0) await checkpoint();
    if (t.start < at) continue;
    add(source.slice(at, t.start));
    add(source.slice(t.start, t.end), t.cls);
    at = t.end;
  }
  add(source.slice(at));
  return lines;
}
