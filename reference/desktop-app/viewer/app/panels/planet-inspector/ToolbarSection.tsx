// Town finder, primary toolbar, and Display menu.
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Rec, Overlay, OverlayStore } from './shared.tsx';

export function createToolbarSection({
  ctx,
  file,
  regions,
  towns,
  analysis,
  districts,
  districtOf,
  goMethod,
  onFit,
  onInspect,
  onDependencies,
  openMethod,
  openTransport,
  getRegion,
  overlayStore,
  setOverlay,
}: {
  ctx: Rec;
  file: Rec;
  regions: Rec[];
  towns: Rec | null;
  analysis: Rec;
  districts: Map<string, Rec>;
  districtOf: (r: Rec) => Rec;
  goMethod: (i: number) => void;
  onFit: () => void;
  onInspect: () => void;
  onDependencies: (enabled: boolean) => void;
  openMethod: (k: number, opts?: { showSource?: boolean; sourceLine?: number | null }) => void;
  openTransport: (k: number) => void;
  getRegion: () => number;
  overlayStore: OverlayStore;
  setOverlay: (patch: Partial<Overlay>) => void;
}) {
  // ---------- overlays: toolbar, file map, hint and key ----------
  function TownFinder({ k }: { k: number }) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const finder = useRef<HTMLDetailsElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const results = useRef<HTMLDivElement>(null);
    const q = query.trim().toLocaleLowerCase();
    // The closed finder should not rebuild hundreds of hidden rows on every edit.
    const sections = (open ? [...districts.values()] : []).flatMap(district => {
      const hits: number[] = district.regions.filter((i: number) =>
        [
          regions[i].name,
          district.name,
          regions[i].neighborhood?.name || '',
          ...(regions[i].roles || []).map((role: Rec) => role.label || role.id),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(q),
      );
      if (!hits.length) return [];
      const groups = new Map<string, { neighborhood: Rec | undefined; members: number[] }>();
      hits.forEach(i => {
        const hood = regions[i].neighborhood,
          id = hood?.id || district.id;
        if (!groups.has(id)) groups.set(id, { neighborhood: hood, members: [] });
        groups.get(id)!.members.push(i);
      });
      return [
        <section key={district.id}>
          <h4>
            {district.name}
            <span>{hits.length}</span>
          </h4>
          {[...groups.entries()].map(([id, group]) => (
            <Fragment key={id}>
              {group.neighborhood && groups.size > 1 && (
                <h5 title={group.neighborhood.reason}>{group.neighborhood.name}</h5>
              )}
              {group.members.map(i => (
                <button
                  key={i}
                  data-town={i}
                  aria-current={i === k ? 'true' : undefined}
                  onClick={() => {
                    goMethod(i);
                    document.querySelector<HTMLElement>('.planet-navigator summary')?.focus();
                  }}
                >
                  <span>{regions[i].name}</span>
                  <small>L{regions[i].start}</small>
                </button>
              ))}
            </Fragment>
          ))}
        </section>,
      ];
    });
    return (
      <details
        className="planet-navigator"
        ref={finder}
        onToggle={() => {
          setOpen(!!finder.current?.open);
          if (finder.current?.open) search.current?.focus();
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finder.current!.open = false;
            finder.current!.querySelector('summary')!.focus();
          } else if (e.key === 'ArrowDown' && e.target === search.current) {
            e.preventDefault();
            results.current?.querySelector('button')?.focus();
          }
        }}
      >
        <summary>
          Find town <span>{regions.length}</span>
        </summary>
        <div className="planet-town-menu">
          <label htmlFor="planetTownSearch">Find a method, district, or pattern</label>
          <input
            id="planetTownSearch"
            ref={search}
            type="search"
            placeholder="Search towns…"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="planet-town-results" ref={results}>
            {sections.length ? sections : <p className="note">No matching towns.</p>}
          </div>
        </div>
      </details>
    );
  }
  function Toolbar() {
    const {
      region: k,
      dependencies,
      labels,
      plan,
      callShips,
      debugLayers,
      auxiliary,
    } = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
    const display = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
      const dismiss = (e: PointerEvent) => {
        if (e.target instanceof Node && display.current && !display.current.contains(e.target))
          display.current.open = false;
      };
      document.addEventListener('pointerdown', dismiss);
      return () => document.removeEventListener('pointerdown', dismiss);
    }, []);
    if (k == null) return <div className="planet-tools" />;
    const r = regions[k],
      d = districtOf(r);
    // Keyed by region: choosing another town starts the toolbar fresh, with the town finder closed.
    return (
      <div className="planet-tools" key={k}>
        <div className="planet-breadcrumb" title={`${file.name} / ${d.name} / ${r.name}`}>
          <span className="planet-file-name">{file.name}</span>
          <span>/</span>
          <strong>{r.name}</strong>
          <span className="static-view">Static source{analysis.status === 'partial' ? ' · incomplete' : ''}</span>
        </div>
        <div className="planet-tool-actions">
          <div className="planet-tool-group" role="group" aria-label="Town navigation">
            <TownFinder k={k} />
            <button id="fitMethod" onClick={onFit}>
              Center method
            </button>
          </div>
          <button id="methodInfo" onClick={() => openMethod(getRegion())}>
            Method details
          </button>
          <button id="openTransport" onClick={() => openTransport(getRegion())}>
            {towns?.docksOf?.(getRegion()).length ? 'Town port' : r.vis === 'public' ? 'Spaceport' : 'Landing pad'}
          </button>
          <details
            className="planet-display"
            ref={display}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                display.current!.open = false;
                display.current!.querySelector('summary')!.focus();
              }
            }}
          >
            <summary>Display</summary>
            <div className="planet-display-menu">
              <button
                id="fitPlanet"
                disabled={!towns}
                onClick={() => {
                  ctx.onPlanetFit?.();
                  if (display.current) display.current.open = false;
                }}
              >
                Whole planet
              </button>
              <label>
                <input
                  id="townPlanToggle"
                  type="checkbox"
                  checked={plan}
                  disabled={!towns}
                  onChange={e => {
                    setOverlay({ plan: e.target.checked });
                    ctx.onPlan?.(e.target.checked);
                  }}
                />{' '}
                Plan view
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={e => {
                    setOverlay({ labels: e.target.checked });
                    towns?.setDetailLabels(e.target.checked);
                  }}
                />{' '}
                Code labels
              </label>
              <label>
                <input
                  id="dependencyToggle"
                  type="checkbox"
                  checked={dependencies}
                  onChange={e => {
                    setOverlay({ dependencies: e.target.checked });
                    onDependencies(e.target.checked);
                  }}
                />{' '}
                Dependencies
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={callShips}
                  onChange={e => {
                    setOverlay({ callShips: e.target.checked });
                    ctx.onCallShips?.(e.target.checked);
                  }}
                />{' '}
                Animate call ships
              </label>
              <label>
                <input
                  id="debugLayersToggle"
                  type="checkbox"
                  checked={debugLayers}
                  onChange={e => {
                    setOverlay({ debugLayers: e.target.checked });
                    ctx.onDebugLayers?.(e.target.checked);
                  }}
                />{' '}
                Debug layers
              </label>
              {debugLayers && (
                <p className="note">
                  Outlines mark statement lots; neutral lighting makes buildings easier to inspect.
                </p>
              )}
              <div className="planet-display-divider" />
              {(['map', 'key', 'stack', 'help'] as const).map(item => (
                <button
                  key={item}
                  aria-pressed={auxiliary === item}
                  onClick={() => {
                    setOverlay({ auxiliary: auxiliary === item ? null : item });
                    display.current!.open = false;
                  }}
                >
                  {{ map: 'File map', key: 'Building key', stack: 'Debug evidence', help: 'Navigation help' }[item]}
                  <span aria-hidden="true">{auxiliary === item ? '✓' : ''}</span>
                </button>
              ))}
              <div className="planet-display-divider" />
              <button
                id="inspectSelection"
                onClick={() => {
                  display.current!.open = false;
                  onInspect();
                }}
              >
                Inspect selection
              </button>
            </div>
          </details>
        </div>
      </div>
    );
  }
  return { Toolbar };
}
