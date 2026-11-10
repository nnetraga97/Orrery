// Spaceport, town port, landing pad, and station windows.
import { useState } from 'react';
import { plural } from './shared.tsx';
import type { Vector3 } from 'three';
import type { CtxSpec } from '../../context-windows.tsx';
import type { Rec, createSharedPieces } from './shared.tsx';
// Flight phases during which a route cannot start another.
const BUSY = ['loading', 'boarding', 'lifting off', 'departing', 'approaching', 'landing'];
const ROUTE_KINDS: Record<string, string> = {
  value: 'Value references in this file',
  type: 'Type-only file reference · no ships',
  reexport: 'Re-export · no ships',
  unknown: 'Unclassified reference · no ships',
};

export function createTransportSection({
  ctx,
  regions,
  towns,
  callers,
  imports,
  anchorLocal,
  openMethod,
  openTransport,
  goMethod,
  getFlightStatus,
  ImportButton,
}: {
  ctx: Rec;
  regions: Rec[];
  towns: Rec | null;
  callers: (k: number) => string[];
  imports: Map<string, unknown>;
  anchorLocal: (get: () => Vector3 | null) => CtxSpec['anchor'];
  openMethod: (k: number, opts?: { showSource?: boolean; sourceLine?: number | null }) => void;
  openTransport: (k: number) => void;
  goMethod: (i: number) => void;
  getFlightStatus: () => Rec;
  ImportButton: ReturnType<typeof createSharedPieces>['ImportButton'];
}) {
  // ---------- spaceport / landing pad and station ----------
  function TransportBody({ k }: { k: number }) {
    const [dockMessage, setDockMessage] = useState('');
    const routes: Rec[] = ctx.routes?.[k] || [],
      possible: string[] = callers(k),
      busy = BUSY.includes(getFlightStatus().phase),
      { phase, route } = getFlightStatus();
    const status =
      phase === 'idle'
        ? 'Pick a route to preview a departure or travel to its file.'
        : `${phase[0].toUpperCase() + phase.slice(1)}${route ? ` · ${route.arrival && !route.resolved ? 'from ' : ''}${route.path}` : ''}${route?.arrival && !route.resolved ? ' · navigation port; receiving method is unresolved.' : ''}`;
    return (
      <>
        <div className="note">
          Scheduled port visits illustrate this method's value dependencies. They do not run code. Travel previews
          navigate between files; the receiving method may be unresolved.
        </div>
        {!!towns?.docksOf?.(k).length && (
          <>
            <h4>Town port · three shared docking bays</h4>
            <div className="note">Each bay accepts arrivals and departures. Clamps release before lift-off.</div>
            <div className="chips">
              {[0, 1, 2].map(index => (
                <button
                  key={index}
                  onClick={() =>
                    setDockMessage(
                      towns.previewDock(k, index)
                        ? `Bay ${index + 1} mechanism cycle`
                        : 'Wait for the current port activity to finish.',
                    )
                  }
                >
                  Preview bay {index + 1}
                </button>
              ))}
            </div>
            {!!dockMessage && (
              <div className="note" role="status">
                {dockMessage}
              </div>
            )}
          </>
        )}
        <div className="fact" role="status">
          <span>Status</span>
          <code id="transportStatus">{status}</code>
        </div>
        <h4>Outbound dependencies {routes.length}</h4>
        {routes.length ? (
          routes.map((x, i) => (
            <div key={i} className="transport-route">
              <div>{x.path}</div>
              <small className="note">
                {x.target == null ? 'Outside this dataset · ' : ''}
                {ROUTE_KINDS[x.kind]}
              </small>
              <div className="chips">
                {x.canFly && towns && (
                  <>
                    <button data-depart={i} disabled={busy} onClick={() => ctx.onTransport(routes[i], false)}>
                      Preview departure
                    </button>
                    <button data-travel={i} disabled={busy} onClick={() => ctx.onTransport(routes[i], true)}>
                      Travel to file ↗
                    </button>
                  </>
                )}
                {x.target != null && (
                  <button data-import={x.path} disabled={!imports.has(x.path)} onClick={() => ctx.onImport(x.path)}>
                    Open file ↗
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="note">No imported modules referenced by this method.</div>
        )}
        {!!possible.length && (
          <>
            <h4>Possible inbound callers</h4>
            <div className="note">Method-name matches only; receiver identity is unverified.</div>
            {possible.map(p => (
              <ImportButton key={p} path={p} label={`${p} ↗`} />
            ))}
          </>
        )}
      </>
    );
  }
  function transportWindow(k: number): CtxSpec {
    const r = regions[k],
      routes: Rec[] = ctx.routes?.[k] || [],
      possible: string[] = callers(k),
      busy = BUSY.includes(getFlightStatus().phase);
    return {
      key: `planet:port:${k}`,
      kind: towns?.docksOf?.(k).length
        ? 'Town port · method connections'
        : r.vis === 'public'
          ? 'Spaceport · public entry'
          : 'Landing pad · entry',
      title: r.name,
      sub: `${routes.length} outbound dependenc${routes.length === 1 ? 'y' : 'ies'}`,
      color: '#ffd66b',
      preview: [`${routes.filter(x => x.canFly).length} flyable routes · ${possible.length} possible external callers`],
      anchor: anchorLocal(() => towns?.portOf(k) || ctx.regionCenter(k)),
      content: () => <TransportBody k={k} />,
      actions: [
        { label: 'Center port', primary: true, disabled: !towns, onClick: () => ctx.onPort(k) },
        ...(busy ? [{ label: 'Cancel flight', onClick: ctx.onCancelTransport }] : []),
        { label: 'Method', onClick: () => openMethod(k) },
      ],
    };
  }
  function stationWindow(k: number): CtxSpec {
    const ground: Rec[] =
      towns?.lines.flatMap((l: Rec) => l.calls).filter((c: Rec) => c.from === k || c.to === k) || [];
    return {
      key: `planet:station:${k}`,
      kind: 'Directed calls between methods',
      title: regions[k].name,
      sub: `${plural(ground.length, 'local connection')}`,
      color: '#6be3e0',
      preview: ground
        .slice(0, 3)
        .map(
          c =>
            `${c.from === k ? 'to' : 'from'} ${regions[c.from === k ? c.to : c.from].name} · ${plural(c.n, 'call site')}`,
        ),
      anchor: anchorLocal(() => towns?.portOf(k) || ctx.regionCenter(k)),
      content: () => (
        <>
          {ground.length ? (
            ground.map((c, i) => {
              const d = c.from === k ? c.to : c.from;
              return (
                <button key={i} className="row-link" data-method={d} onClick={() => goMethod(d)}>
                  <span>
                    {c.from === k ? 'To' : 'From'} {regions[d].name}
                  </span>
                  <small>{plural(c.n, 'call site')}</small>
                </button>
              );
            })
          ) : (
            <div className="note">No local call connections.</div>
          )}
          <div className="note">Directed routes link static call sites to methods in this file.</div>
        </>
      ),
      actions: [
        { label: 'Method', primary: true, onClick: () => openMethod(k) },
        { label: 'Spaceport', onClick: () => openTransport(k) },
      ],
    };
  }
  return { transportWindow, stationWindow };
}
