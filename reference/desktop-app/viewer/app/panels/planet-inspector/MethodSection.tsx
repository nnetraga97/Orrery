// Method details and their anchored context window.
import { useRef, useLayoutEffect } from 'react';
import { ctxWin, type CtxAction, type CtxSpec } from '../../context-windows.tsx';
import { atlasSummary, useAtlas } from '../../atlas.ts';
import { lineRange } from './shared.tsx';
import type { Vector3 } from 'three';
import type { Rec, Lot, createSharedPieces } from './shared.tsx';

export function createMethodSection({
  ctx,
  file,
  regions,
  towns,
  sourceLines,
  districtOf,
  callsOf,
  callers,
  schemaCalls,
  targetIndex,
  byId,
  goMethod,
  elementsOf,
  membersOf,
  anchorLocal,
  onMethod,
  onFit,
  openTransport,
  openMethod,
  OpenSource,
  Roles,
  Evidence,
  Coverage,
  SourceBlock,
  ImportButton,
}: {
  ctx: Rec;
  file: Rec;
  regions: Rec[];
  towns: Rec | null;
  sourceLines: string[];
  districtOf: (r: Rec) => Rec;
  callsOf: (k: number) => { out: Rec[]; in: Rec[] };
  callers: (k: number) => string[];
  schemaCalls: (r: Rec) => Rec[] | null;
  targetIndex: (c: Rec) => number | undefined;
  byId: Map<string, number>;
  goMethod: (i: number) => void;
  elementsOf: (k: number) => Lot[];
  membersOf: (r: Rec) => Rec[];
  anchorLocal: (get: () => Vector3 | null) => CtxSpec['anchor'];
  onMethod: (k: number) => void;
  onFit: () => void;
  openTransport: (k: number) => void;
  openMethod: (k: number, opts?: { showSource?: boolean; sourceLine?: number | null }) => void;
  OpenSource: ReturnType<typeof createSharedPieces>['OpenSource'];
  Roles: ReturnType<typeof createSharedPieces>['Roles'];
  Evidence: ReturnType<typeof createSharedPieces>['Evidence'];
  Coverage: ReturnType<typeof createSharedPieces>['Coverage'];
  SourceBlock: ReturnType<typeof createSharedPieces>['SourceBlock'];
  ImportButton: ReturnType<typeof createSharedPieces>['ImportButton'];
}) {
  // ---------- method region ----------
  function MethodBody({ k, showSource, sourceLine }: { k: number; showSource: boolean; sourceLine: number | null }) {
    useAtlas();
    const summary = atlasSummary(regions[k].id, file.path);
    const r = regions[k],
      d = districtOf(r),
      neighborhood = r.neighborhood,
      calls = callsOf(k),
      external: string[] = callers(k);
    const unresolved = (schemaCalls(r) || []).filter(
      c => targetIndex(c) == null && c.resolution !== 'external' && c.resolution !== 'import',
    );
    const outsideSource = sourceLine && (sourceLine < r.start || sourceLine > r.end);
    const evidenceLine = (line: number) => openMethod(k, { showSource: true, sourceLine: line });
    const body = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      if (!sourceLine) return;
      const frame = requestAnimationFrame(() =>
        body.current
          ?.closest('.ctx-body')
          ?.querySelector(`.cl[data-line="${sourceLine}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
      return () => cancelAnimationFrame(frame);
    }, [sourceLine]);
    return (
      <>
        <code className="method-signature" ref={body}>
          {(sourceLines[r.start - 1] || '').trim().replace(/\s*\{\s*$/, '')}
        </code>
        {summary && (
          <p className="note">
            {summary.summary}
            <br />
            <small>
              {summary.role} · {summary.risk} risk
            </small>
          </p>
        )}
        <OpenSource line={sourceLine || r.start} />
        <Roles r={r} onLine={evidenceLine} />
        <details className="semantic-details" open={!!neighborhood || undefined}>
          <summary>{neighborhood ? `Neighborhood · ${neighborhood.name}` : `Why this district · ${d.name}`}</summary>
          {neighborhood && (
            <>
              <p className="note">{neighborhood.reason}.</p>
              {(neighborhood.members || []).length > 1 && (
                <div className="chips" aria-label="Methods in this neighborhood">
                  {neighborhood.members
                    .map((id: string) => byId.get(id))
                    .filter((i: number | undefined) => i != null && i !== k)
                    .map((i: number) => (
                      <button key={i} data-method={i} onClick={() => goMethod(i)}>
                        {regions[i].name}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
          <p className="note">
            {d.name} district: {d.reason || 'Members share an ownership or source relationship.'}
          </p>
          <Evidence items={d.evidence} onLine={evidenceLine} />
        </details>
        <Coverage onLine={evidenceLine} />
        <h4>Calls in this file {calls.out.length}</h4>
        {calls.out.length ? (
          calls.out.map(({ x, i }: Rec) => (
            <button key={i} className="row-link" data-method={i} onClick={() => goMethod(i)}>
              <span>↗ {x.name}</span>
              <small>{x.loc} lines</small>
            </button>
          ))
        ) : (
          <div className="note">No resolved local calls.</div>
        )}
        {!!unresolved.length && (
          <details className="semantic-details">
            <summary>
              {unresolved.length} call site{unresolved.length === 1 ? '' : 's'} without a resolved local target
            </summary>
            <p className="note">These calls do not create local transport links.</p>
            <Evidence
              items={unresolved.map(c => ({
                line: c.line,
                text: `${c.expression || (c.receiver ? c.receiver + '.' : '') + c.name} · ${c.resolution || 'unresolved receiver'}`,
              }))}
              onLine={evidenceLine}
            />
          </details>
        )}
        <h4>Called by local methods {calls.in.length}</h4>
        {calls.in.length ? (
          calls.in.map(({ x, i }: Rec) => (
            <button key={i} className="row-link" data-method={i} onClick={() => goMethod(i)}>
              <span>↘ {x.name}</span>
              <small>L{x.start}</small>
            </button>
          ))
        ) : (
          <div className="note">No resolved local callers.</div>
        )}
        {!!r.uses?.length && (
          <>
            <h4>Imported modules used</h4>
            {r.uses.map((p: string) => (
              <ImportButton key={p} path={p} label={p} />
            ))}
          </>
        )}
        {!!external.length && (
          <>
            <h4>Possible external callers</h4>
            <div className="note">Method-name matches; receiver identity is not verified.</div>
            {external.map(p => (
              <ImportButton key={p} path={p} label={p} />
            ))}
          </>
        )}
        {outsideSource && (
          <>
            <h4>Evidence at L{sourceLine}</h4>
            <SourceBlock
              k={k}
              from={Math.max(1, sourceLine - 2)}
              to={Math.min(sourceLines.length, sourceLine + 3)}
              mark={[sourceLine, sourceLine]}
            />
          </>
        )}
        <details open={showSource || undefined}>
          <summary className="note">Source · {lineRange(r.start, r.end)} · click a line to locate it</summary>
          <SourceBlock k={k} from={r.start} to={r.end} mark={sourceLine ? [sourceLine, sourceLine] : null} />
        </details>
        <div className="note">Static source analysis · values unavailable</div>
      </>
    );
  }
  function methodWindow(k: number, { showSource = false, sourceLine = null as number | null } = {}): CtxSpec {
    const r = regions[k],
      d = districtOf(r),
      elements = elementsOf(k),
      calls = callsOf(k),
      single = towns && membersOf(r).length === 1 && r.kind !== 'group';
    const trafficAction: CtxAction = {
      label: ctx.traffic?.running(k) ? 'Pause road traffic' : 'Resume road traffic',
      onClick: () => {
        ctx.traffic?.toggle(k);
        // refresh reuses this window's spec, so update its action as well as
        // the running state; otherwise a running method still says Drive.
        trafficAction.label = ctx.traffic?.running(k) ? 'Pause road traffic' : 'Resume road traffic';
        ctxWin.refresh();
      },
    };
    return {
      key: `planet:method:${k}`,
      kind: `${r.vis || ''} ${r.static ? 'static ' : ''}${r.kind === 'group' ? 'group' : r.kind || 'method'}`,
      title: r.name,
      sub: `${d.name} · ${file.name} · ${lineRange(r.start, r.end)}`,
      color: '#7cc4ff',
      preview: [
        ...(atlasSummary(r.id, file.path) ? [atlasSummary(r.id, file.path)!.summary] : []),
        `${r.loc} lines · ${r.branches || 0} decisions · ${elements.length} statements`,
        `calls ${calls.out.length} · called by ${calls.in.length} local methods`,
      ],
      anchor: anchorLocal(() => ctx.regionCenter(k)),
      content: () => <MethodBody k={k} showSource={showSource} sourceLine={sourceLine} />,
      actions: [
        {
          label: 'Center method',
          primary: true,
          onClick: () => {
            onMethod(k);
            onFit();
          },
        },
        {
          label: towns?.docksOf?.(k).length ? 'Town port' : r.vis === 'public' ? 'Spaceport' : 'Landing pad',
          onClick: () => openTransport(k),
        },
        ...(single ? [trafficAction] : []),
      ],
    };
  }
  return { methodWindow };
}
