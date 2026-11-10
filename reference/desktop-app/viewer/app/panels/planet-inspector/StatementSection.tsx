// Statement details, operation labels, and building context windows.
import { Fragment } from 'react';
import { BUILDING_TYPES, buildingProfile } from '../../../../source-model/building-profile.js';
import { STATEMENT_TYPES, arityFits, statementType } from '../../../shared/town-flow.js';
import { Line, lineRange } from './shared.tsx';
import type { Vector3 } from 'three';
import type { CtxSpec } from '../../context-windows.tsx';
import type { Rec, Lot, Segment, createSharedPieces } from './shared.tsx';
const OPERATION_NAMES: Record<string, string> = {
  call: 'Call',
  write: 'Write',
  state: 'Write',
  bind: 'Binding',
  declare: 'Binding',
  declaration: 'Binding',
  return: 'Return',
  throw: 'Throw',
  await: 'Await',
  async: 'Async',
  yield: 'Yield',
  branch: 'Branch',
  loop: 'Loop',
  read: 'Read',
  construct: 'Construct',
  network: 'Network',
  persistence: 'Persistence',
  persist: 'Persistence',
  storage: 'Storage',
  emit: 'Emit event',
  subscribe: 'Subscribe',
  event: 'Event',
  render: 'Render UI',
  dom: 'DOM',
  ui: 'UI',
};

export function createStatementSection({
  file,
  regions,
  towns,
  sourceLines,
  colored,
  changedLines,
  schemaCalls,
  targetIndex,
  membersOf,
  elementsOf,
  summary,
  goMethod,
  districtOf,
  anchorLocal,
  onStatement,
  onInspect,
  openMethod,
  getRegion,
  OpenSource,
  SourceBlock,
}: {
  file: Rec;
  regions: Rec[];
  towns: Rec;
  sourceLines: string[];
  colored: Segment[][];
  changedLines: number[];
  schemaCalls: (r: Rec) => Rec[] | null;
  targetIndex: (c: Rec) => number | undefined;
  membersOf: (r: Rec) => Rec[];
  elementsOf: (k: number) => Lot[];
  summary: (it: Rec) => string;
  goMethod: (i: number) => void;
  districtOf: (r: Rec) => Rec;
  anchorLocal: (get: () => Vector3 | null) => CtxSpec['anchor'];
  onStatement: (lot: Lot) => void;
  onInspect: () => void;
  openMethod: (k: number, opts?: { showSource?: boolean; sourceLine?: number | null }) => void;
  getRegion: () => number;
  OpenSource: ReturnType<typeof createSharedPieces>['OpenSource'];
  SourceBlock: ReturnType<typeof createSharedPieces>['SourceBlock'];
}) {
  // ---------- statement (buildings, forks, loops) ----------
  const operationsOf = (it: Rec) => {
    const operations = new Set<string>(
      (Array.isArray(it.operations) ? it.operations : [])
        .map((op: Rec | string) => (typeof op === 'string' ? op : op.kind || op.type || op.id))
        .filter(Boolean),
    );
    if (it.calls?.length) operations.add('call');
    if (it.writes?.length) operations.add(it.kind === 'decl' ? 'declare' : 'write');
    if (['return', 'throw'].includes(it.kind)) operations.add(it.kind);
    if (['if', 'switch'].includes(it.t)) operations.add('branch');
    if (it.t === 'loop') operations.add('loop');
    return [...new Set([...operations].map(op => OPERATION_NAMES[op] || op))];
  };
  const statementCalls = (it: Rec, k: number): { r: Rec; j: number }[] => {
    if (schemaCalls(regions[k])) {
      // Facts on branch/loop items describe the condition only; never include their nested bodies by line range.
      const indices = [...new Set((it.calls || []).map(targetIndex).filter((i: number | undefined) => i != null))];
      return indices.map(j => ({ r: regions[j as number], j: j as number }));
    }
    return (it.calls || [])
      .filter((c: Rec) => c.self)
      .flatMap((c: Rec) =>
        regions
          .map((r: Rec, j: number) => ({ r, j }))
          .filter(({ r }: Rec) =>
            membersOf(r).some(m => m.name === c.name && m.owner === regions[k].owner && arityFits(c.argc, m)),
          ),
      );
  };
  function StatementBody({ l, k }: { l: Lot; k: number }) {
    const it = l.it,
      elements = elementsOf(k),
      index = elements.findIndex(x => x.it === it);
    const otherWrites = elements.filter(
      x => x.it !== it && (it.writes || []).some((n: string) => x.it.writes?.includes(n)),
    );
    const localCalls = statementCalls(it, k),
      operations = operationsOf(it),
      // The placed building's own profile knows what the town resolved (library calls, local targets).
      profile = it.t === 'stmt' ? (elements[index]?.profile ?? buildingProfile(it, { file: file.path })) : null;
    const indent = sourceLines[it.line - 1]?.match(/^\s*/)?.[0].length || 0,
      dedent = new RegExp('^[ \t]{0,' + indent + '}');
    const excerpt = colored
      .slice(it.line - 1, Math.min(it.end, it.line + 5))
      .map(line =>
        line.length && !line[0].cls ? [{ text: line[0].text.replace(dedent, '') }, ...line.slice(1)] : line,
      );
    return (
      <>
        <OpenSource line={it.line} column={towns.rangeOf(it.id)?.column || 1} />
        {profile && (
          <div className="building-meaning">
            <strong>{profile.label} building</strong>
            <p className="note">{(BUILDING_TYPES as Rec)[profile.role]?.description || ''}</p>
            {!!profile.effects?.length && (
              <span>Roof markers: {profile.effects.map((effect: Rec) => effect.label).join(' · ')}</span>
            )}
          </div>
        )}
        {changedLines.some((n: number) => n >= it.line && n <= it.end) && (
          <div className="changed">Contains an uncommitted source edit</div>
        )}
        {!!it.context?.length && (
          <>
            <h4>Lexical context</h4>
            <div className="chips">
              {it.context.map((c: Rec, i: number) => (
                <button
                  key={i}
                  data-context={c.line}
                  title={c.text}
                  onClick={() => onStatement(towns.lotForLine(k, c.line))}
                >
                  L{c.line} {c.text}
                </button>
              ))}
            </div>
          </>
        )}
        {!!operations.length && (
          <div className="statement-operations" aria-label="Operations in this statement">
            {operations.map(op => (
              <span key={op}>{op}</span>
            ))}
          </div>
        )}
        <pre className="statement-source">
          {excerpt.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && '\n'}
              <Line segments={line} />
            </Fragment>
          ))}
        </pre>
        {!!it.writes?.length && (
          <div className="fact">
            <span>Writes / declares</span>
            <code>{[...new Set(it.writes)].join(', ')}</code>
          </div>
        )}
        {!!it.calls?.length && (
          <div className="fact">
            <span>Calls</span>
            <code>
              {[
                ...new Set(
                  it.calls.map(
                    (c: Rec) => c.expression || (c.receiver || c.target ? (c.receiver || c.target) + '.' : '') + c.name,
                  ),
                ),
              ].join(', ')}
            </code>
          </div>
        )}
        {!!otherWrites.length && (
          <>
            <h4>Same write target · text matches</h4>
            <div className="chips">
              {otherWrites.map(x => {
                const related = index >= 0 ? elements.indexOf(x) : -1;
                return (
                  <button
                    key={related + ':' + x.it.line}
                    data-related={related}
                    title={summary(x.it)}
                    onClick={() => onStatement(elements[related])}
                  >
                    L{x.it.line}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {!!localCalls.length && (
          <>
            <h4>Calls into this file</h4>
            <div className="chips">
              {localCalls.map(({ r, j }, i) => (
                <button key={i} data-method={j} onClick={() => goMethod(j)}>
                  {r.name} ↗
                </button>
              ))}
            </div>
          </>
        )}
        <details>
          <summary className="note">Whole method · {lineRange(regions[k].start, regions[k].end)}</summary>
          <SourceBlock k={k} from={regions[k].start} to={regions[k].end} mark={[it.line, it.end]} />
        </details>
        <div className="note">Static source · values unavailable</div>
      </>
    );
  }
  function statementWindow(l: Lot, style: string | null = null): CtxSpec {
    const it = l.it,
      k = l.k ?? getRegion(),
      t = (STATEMENT_TYPES as Rec)[statementType(it)],
      elements = elementsOf(k),
      index = elements.findIndex(x => x.it === it),
      operations = operationsOf(it),
      // The placed building's own profile knows what the town resolved (library calls, local targets).
      profile = it.t === 'stmt' ? (elements[index]?.profile ?? buildingProfile(it, { file: file.path })) : null;
    const kind =
      ({ fork: 'Fork · branch', loop: 'Loop · windmill' } as Record<string, string>)[style || ''] ||
      profile?.label ||
      t.label;
    return {
      key: `planet:stmt:${k}:${it.line}:${it.end}`,
      kind: `${kind} · ${lineRange(it.line, it.end)}`,
      title: summary(it),
      sub: `${districtOf(regions[k]).name} · ${regions[k].name}`,
      color: t.color,
      preview: [operations.length ? operations.join(' · ') : `statement ${index + 1} of ${elements.length}`],
      anchor: anchorLocal(() => towns.worldOfLot(l)),
      content: () => <StatementBody l={l} k={k} />,
      actions: [
        {
          label: '↑',
          title: 'Previous statement',
          disabled: index <= 0,
          onClick: () => onStatement(elements[index - 1]),
        },
        {
          label: '↓',
          title: 'Next statement',
          disabled: index < 0 || index >= elements.length - 1,
          onClick: () => onStatement(elements[index + 1]),
        },
        ...(l.role === 'office'
          ? [
              {
                label: 'Animate factory',
                title: 'Mechanical preview of this external call; not execution replay',
                onClick: () => towns.previewFactory(l),
              },
            ]
          : []),
        { label: 'Focus', primary: true, onClick: onInspect },
        { label: 'Method', onClick: () => openMethod(k) },
      ],
    };
  }
  return { statementWindow };
}
