// File map, building key, navigation help, and auxiliary panel.
import { useSyncExternalStore, type ReactNode } from 'react';
import { BUILDING_TYPES } from '../../../../source-model/building-profile.js';
import { STATEMENT_TYPES } from '../../../shared/town-flow.js';
import { FAMILIES } from '../../../shared/evidence-records.js';
import { districtColor, plural } from './shared.tsx';
import type { Rec, Overlay, OverlayStore } from './shared.tsx';
const BUILDING_SHAPES: Record<string, string> = {
  tower: 'Ringed tower',
  office: 'Assembly factory',
  library: 'Vendor crates (placeholder)',
  plant: 'Refinery',
  house: 'Storage stacks',
  dataStore: 'Layered reservoir',
  network: 'Dish antenna',
  relay: 'Relay gantry',
  interface: 'Display pavilion',
  constructor: 'Assembly crane',
  block: 'Depot',
  gate: 'Gate',
  crater: 'Crater',
  barrels: 'Barrels',
};
// How to read the streets and the debugger's marks on them.
const ROAD_KEY: [string, string][] = [
  ['Main street', 'statements in order, read top to bottom'],
  ['Side street', 'a branch arm (then / else) with its statements'],
  ['Light bypass', 'the path that skips a branch body'],
  ['Ring road', 'a loop around its body'],
  ['Chevrons', 'the method continues in the next column'],
  ['Route', '→ a call out, ← a call in; gates lead to other files'],
];
const DEBUG_KEY: [string, string][] = [
  ['Light column', 'the statement execution is paused on'],
  ['Amber cards and trail', 'frames of the paused call stack'],
  ['Stirring building', 'execution passed it recently'],
  ['Still traffic', 'the program is paused'],
];
const HINT =
  'Hover anything for details · click to pin · double-click a building to focus · drag to orbit · scroll to zoom';

export function createMapSection({
  ctx,
  regions,
  districts,
  neighborhoods,
  mapPaths,
  districtOf,
  goMethod,
  overlayStore,
  setOverlay,
  CapturedStack,
}: {
  ctx: Rec;
  regions: Rec[];
  districts: Map<string, Rec>;
  neighborhoods: Set<unknown>;
  mapPaths: string[];
  districtOf: (r: Rec) => Rec;
  goMethod: (i: number) => void;
  overlayStore: OverlayStore;
  setOverlay: (patch: Partial<Overlay>) => void;
  CapturedStack: () => ReactNode;
}) {
  function FileMap() {
    const { region: k } = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
    const r = k == null ? null : regions[k];
    return (
      <div className="planet-map">
        <div className="map-heading">
          File map <span>{regions.length} towns</span>
        </div>
        <div className="map-structure">
          {plural(districts.size, 'district')}
          {neighborhoods.size ? ` · ${plural(neighborhoods.size, 'neighborhood')}` : ''}
        </div>
        <svg viewBox="0 0 244 112" aria-label="Method towns grouped by district on both hemispheres">
          {mapPaths.map((path: string, i: number) => {
            const d = districtOf(regions[i]);
            return (
              <path
                key={i}
                data-region={i}
                d={path}
                style={
                  {
                    '--district': ctx.regionColors?.[i]?.getStyle?.() || ctx.regionColors?.[i] || districtColor(d),
                  } as Rec
                }
                tabIndex={0}
                role="button"
                aria-label={`${d.name}: ${regions[i].name}`}
                className={i === k ? 'on' : undefined}
                aria-pressed={k == null ? undefined : i === k}
                onClick={() => goMethod(i)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    goMethod(i);
                  }
                }}
              >
                <title>
                  {`${d.name} / ${regions[i].neighborhood ? regions[i].neighborhood.name + ' / ' : ''}${regions[i].name} · ${regions[i].loc} lines`}
                </title>
              </path>
            );
          })}
        </svg>
        <div className="map-district">{r ? `${r.neighborhood?.name || districtOf(r).name} / ${r.name}` : ''}</div>
        <div
          className="map-caption"
          title="Districts follow ownership and resolved relationships; area estimates room for statements and branches."
        >
          Color = district · area = room for code
        </div>
      </div>
    );
  }
  const Key = () => (
    <div className="planet-key">
      <details className="building-key" open>
        <summary>Building key</summary>
        <dl>
          {Object.entries(BUILDING_SHAPES).map(([role, shape]) => (
            <div key={role}>
              <dt>{shape}</dt>
              <dd>{(BUILDING_TYPES as Rec)[role].label}</dd>
            </div>
          ))}
        </dl>
        <p>Roof fixtures: arrow = return · stacked plates = write · hourglass = await · warning mast = throw.</p>
        <p>One building per statement; fixtures preserve its additional operations.</p>
      </details>
      <details className="building-key" open>
        <summary>Streets and debugging</summary>
        <dl>
          {[...ROAD_KEY, ...DEBUG_KEY].map(([name, meaning]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
      <details className="building-key evidence-key">
        <summary>Evidence markers</summary>
        <p className="note">Observed evidence only. Faint copies show markers hidden behind buildings or terrain.</p>
        <div className="flow-key">
          {Object.entries(FAMILIES).map(([type, family]) => (
            <span key={type} style={{ '--kind': family.color } as Rec}>
              <i></i>
              {family.label}
            </span>
          ))}
        </div>
        <p className="note">
          Outlined breakpoint: not yet confirmed by Node. Blue: tracepoint. Grey outline: not covered; no marker:
          coverage unknown.
        </p>
      </details>
      <div className="flow-key">
        {Object.entries(STATEMENT_TYPES as Rec)
          .filter(([k]) => k !== 'statement')
          .map(([k, t]) => (
            <span key={k} style={{ '--kind': t.color } as Rec}>
              <i></i>
              {t.label}
            </span>
          ))}
      </div>
    </div>
  );
  function Auxiliary() {
    const { auxiliary } = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
    if (!auxiliary) return null;
    return (
      <section
        className="planet-auxiliary"
        aria-label={
          auxiliary === 'map'
            ? 'File map'
            : auxiliary === 'key'
              ? 'Building key'
              : auxiliary === 'stack'
                ? 'Debug evidence'
                : 'Navigation help'
        }
      >
        <button
          className="planet-aux-close"
          aria-label="Close display panel"
          onClick={() => setOverlay({ auxiliary: null })}
        >
          ✕
        </button>
        {auxiliary === 'map' ? (
          <FileMap />
        ) : auxiliary === 'stack' ? (
          <CapturedStack />
        ) : auxiliary === 'key' ? (
          <Key />
        ) : (
          <div className="planet-help">
            <strong>Explore this method</strong>
            <p>{HINT}</p>
            <p>Use Display to reveal code labels, dependencies, the file map, or the building key.</p>
            <p>Roads and traffic illustrate source structure, not a recording of code execution.</p>
          </div>
        )}
      </section>
    );
  }
  return { Auxiliary };
}
