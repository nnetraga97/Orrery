// Shared source highlighting, evidence, coverage, and source controls for inspector windows.
import { planetBuildBudget } from '../../../shared/build-budget.js';
import { languageOf } from '../../../../source-model/languages.js';
import type { buildingProfile } from '../../../../source-model/building-profile.js';
import { Fragment, useState, type ReactNode } from 'react';

// Source analysis records arrive untyped from the analyzer and the town builder.
export type Rec = Record<string, any>;
export type Lot = { it: Rec; k?: number; role?: string; profile?: ReturnType<typeof buildingProfile> };
export type Segment = { text: string; cls?: string };

export type Overlay = {
  region: number | null;
  dependencies: boolean;
  labels: boolean;
  plan: boolean;
  callShips: boolean;
  debugLayers: boolean;
  auxiliary: 'map' | 'key' | 'help' | 'stack' | null;
  stackRows: Rec[];
  stackSelected: number | null;
  stackVisible: boolean;
  evidenceRows: Rec[];
  evidenceSelected: string | null;
  evidenceVisible: boolean;
  gitChanges: boolean;
};
export type OverlayStore = {
  subscribe: (fn: () => void) => () => void;
  get: () => Overlay;
};

export const confidence = (value: unknown) =>
  typeof value === 'number'
    ? value >= 0.9
      ? 'Strong evidence'
      : value >= 0.65
        ? 'Likely pattern'
        : 'Tentative pattern'
    : (
        {
          high: 'Strong evidence',
          medium: 'Likely pattern',
          low: 'Tentative pattern',
          certain: 'Explicit in source',
        } as Record<string, string>
      )[value as string] || 'Source pattern';
export const lineRange = (a: number, b: number) => `L${a}${b > a ? '–' + b : ''}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function districtColor(d: Rec) {
  const palette = ['#669ebd', '#83a88c', '#b69c72', '#ac8fb7', '#71aba6', '#b98780'];
  let hash = 0;
  for (const c of String(d.id)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

// Highlighted source lines, from the town builder's tokens or a TypeScript scan. Source is never evaluated.
export async function highlightPlanetSource(
  file: Rec,
  source: string,
  towns: Rec | null,
  signal: AbortSignal,
): Promise<Segment[][]> {
  const checkpoint = planetBuildBudget(signal);
  const plain = () => source.split('\n').map(text => (text ? [{ text }] : []));
  let tokens: { start: number; end: number; cls: string }[] | null = null;
  if (towns?.sourceTokens && source) tokens = [...towns.sourceTokens];
  else if ((window as Rec).ts && source && languageOf(file.path || file.name)?.frontEnd === 'typescript') {
    const ts = (window as Rec).ts,
      scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source),
      found: { start: number; end: number; cls: string }[] = [];
    let count = 0;
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (++count % 128 === 0) await checkpoint();
      const cls =
        token >= ts.SyntaxKind.FirstKeyword && token <= ts.SyntaxKind.LastKeyword
          ? 'tok-keyword'
          : [
                ts.SyntaxKind.StringLiteral,
                ts.SyntaxKind.NoSubstitutionTemplateLiteral,
                ts.SyntaxKind.TemplateHead,
                ts.SyntaxKind.TemplateMiddle,
                ts.SyntaxKind.TemplateTail,
              ].includes(token)
            ? 'tok-string'
            : token === ts.SyntaxKind.NumericLiteral
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
      if (part) lines.at(-1)!.push(cls ? { text: part, cls } : { text: part });
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
export const Line = ({ segments }: { segments: Segment[] }) => (
  <>
    {segments.map((s, i) =>
      s.cls ? (
        <span key={i} className={s.cls}>
          {s.text}
        </span>
      ) : (
        <Fragment key={i}>{s.text}</Fragment>
      ),
    )}
  </>
);


export function createSharedPieces({
  ctx,
  sourceLines,
  colored,
  changedLines,
  towns,
  onStatement,
  imports,
  analysis,
  diagnostics,
  limitations,
}: {
  ctx: Rec;
  sourceLines: string[];
  colored: Segment[][];
  changedLines: number[];
  towns: Rec | null;
  onStatement: (lot: Lot) => void;
  imports: Map<string, unknown>;
  analysis: Rec;
  diagnostics: Rec[];
  limitations: string[];
}) {
  function OpenSource({ line, column = 1 }: { line: number; column?: number }) {
    const [message, setMessage] = useState('');
    return (
      <>
        <button onClick={() => void ctx.onOpenSource({ line, column }).then(setMessage)}>Open source</button>
        {message && (
          <p className="note" role="status">
            {message}
          </p>
        )}
      </>
    );
  }
  // ---------- shared pieces of window bodies ----------
  const Evidence = ({ items, onLine }: { items?: Rec[]; onLine: (line: number) => void }) => (
    <>
      {(items || []).map((e, i) => {
        const line = Number(e.line) || 1;
        return (
          <button key={i} className="semantic-evidence" data-evidence={line} onClick={() => onLine(line)}>
            <small>L{line}</small>
            <span>{e.text || e.reason || ''}</span>
          </button>
        );
      })}
    </>
  );
  const Roles = ({ r, onLine }: { r: Rec; onLine: (line: number) => void }) =>
    (r.roles || []).length ? (
      <details className="semantic-details">
        <summary>Recognized patterns · {r.roles.map((role: Rec) => role.label || role.id).join(', ')}</summary>
        {r.roles.map((role: Rec, i: number) => (
          <div key={i} className="semantic-role">
            <div>
              <strong>{role.label || role.id}</strong>
              <small>{confidence(role.confidence)}</small>
            </div>
            <Evidence items={role.evidence} onLine={onLine} />
          </div>
        ))}
      </details>
    ) : null;
  function Coverage({ onLine }: { onLine: (line: number) => void }) {
    const coverage = analysis.coverage;
    if (!analysis.engine && !diagnostics.length && !limitations.length && !coverage) return null;
    const excluded: (string | Rec)[] = coverage?.unsupportedFiles || [];
    const unsupported = Object.entries(coverage?.unsupportedExtensions || {});
    return (
      <details className="semantic-details">
        <summary>
          Analysis coverage
          {analysis.status === 'partial' ? ' · incomplete' : excluded.length ? ' · unsupported files' : ''}
        </summary>
        {analysis.engine && (
          <p className="note">
            {analysis.mode === 'syntax'
              ? 'Syntax fallback: this file was analyzed locally; project type and import resolution is unavailable.'
              : analysis.binding === 'project-checker'
                ? 'Project symbols resolve references.'
                : 'Lexical references within this file.'}{' '}
            {Number.isFinite(analysis.callableCount) ? `${analysis.callableCount} callable bodies analyzed.` : ''}
          </p>
        )}
        {Number.isFinite(analysis.resolvedCalls) && (
          <p className="note">
            {analysis.resolvedCalls} resolved call sites · {analysis.unresolvedCalls || 0} unresolved.
          </p>
        )}
        {coverage && typeof coverage === 'object' && (
          <>
            <p className="note">
              Workspace: {coverage.analyzedFiles ?? 0} files analyzed
              {Number.isFinite(coverage.supportedFiles)
                ? ` of ${coverage.supportedFiles} supported source files`
                : ''}. {excluded.length ? `${excluded.length} source files use unsupported languages.` : ''}
              {coverage.declarationFiles ? ` ${coverage.declarationFiles} declaration files provide types.` : ''}
            </p>
            {!!unsupported.length && (
              <p className="note">
                Unsupported: {unsupported.map(([ext, count]) => `${ext} (${Number(count)})`).join(', ')}.
              </p>
            )}
            {!!excluded.length && (
              <details>
                <summary className="note">Files without town analysis</summary>
                {excluded.slice(0, 30).map((p, i) => (
                  <div key={i} className="coverage-path">
                    {typeof p === 'string' ? p : p.path}
                  </div>
                ))}
                {excluded.length > 30 && <p className="note">And {excluded.length - 30} more.</p>}
              </details>
            )}
          </>
        )}
        {!!analysis.unresolvedReferences?.length && (
          <p className="note">
            {analysis.unresolvedReferences.length} module references remain unresolved in the workspace dependency map.
          </p>
        )}
        {diagnostics.map((d, i) => (
          <p key={i} className="note">
            {d.line ? (
              <>
                <button data-evidence={Number(d.line)} onClick={() => onLine(Number(d.line))}>
                  L{Number(d.line)}
                </button>{' '}
              </>
            ) : null}
            {typeof d === 'string' ? d : d.message || ''}
          </p>
        ))}
        {limitations.map((note, i) => (
          <p key={`l${i}`} className="note">
            {note}
          </p>
        ))}
      </details>
    );
  }
  // Source lines; clicking one selects the statement it belongs to.
  function SourceBlock({ k, from, to, mark }: { k: number; from: number; to: number; mark?: [number, number] | null }) {
    return (
      <div className="code">
        {Array.from({ length: to - from + 1 }, (_, i) => {
          const line = from + i,
            state = changedLines.includes(line) ? 'diffl' : '',
            hot = mark && line >= mark[0] && line <= mark[1] ? 'hot' : '';
          return (
            <div
              key={line}
              className={`cl ${state} ${hot}`}
              data-line={line}
              onClick={() => {
                const l = towns?.lotForLine(k, line);
                if (l) onStatement(l);
              }}
            >
              <span className="ln">{line}</span>
              <Line segments={colored[line - 1] || []} />
            </div>
          );
        })}
      </div>
    );
  }
  const ImportButton = ({ path, label }: { path: string; label: ReactNode }) => (
    <button className="row-link" data-import={path} disabled={!imports.has(path)} onClick={() => ctx.onImport(path)}>
      <span>{label}</span>
    </button>
  );

  return { OpenSource, Evidence, Roles, Coverage, SourceBlock, ImportButton };
}
