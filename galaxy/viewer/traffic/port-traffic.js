// Low-volume illustrative port service. Only source-backed value dependencies
// schedule visits. A service visit is not evidence of a reverse import or execution.
import { createSpaceportTransport } from './transport.js';

export function createPortTraffic(T, towns, routes) {
  let disposed = false,
    last = null,
    clock = 0,
    cursor = 0;
  const eligible = routes.flatMap((list, k) => list.filter(r => r.canFly).map(route => ({ k, route })));
  // Departing ships leave toward a constellation lane when one is supplied (planet-space point).
  let exitPoint = () => null;
  // Constellation ships hand off to these slots at the planet's edge, even without local routes.
  const bays = towns.portState().reduce((n, p) => n + towns.docksOf(p.k).length, 0);
  const slots = Array.from({ length: Math.max(Math.min(3, eligible.length), Math.min(6, bays)) }, (_, i) => ({
    ctl: createSpaceportTransport(T, towns),
    phase: 'waiting',
    due: i * 4 + 1,
    visit: null,
  }));
  async function begin(slot, arrival, entry = arrival ? null : exitPoint()) {
    slot.phase = 'loading';
    const ok = await slot.ctl.play(slot.visit.k, slot.visit.route, {
      arrival,
      entry,
      focus: false,
      showPath: false,
      onComplete: () => {
        if (disposed) return;
        slot.phase = arrival ? 'dwell' : 'waiting';
        slot.due = clock + (arrival ? 6 : 9);
      },
    });
    if (disposed) return;
    if (ok) slot.phase = arrival ? 'arriving' : 'departing';
    else {
      slot.phase = 'waiting';
      slot.due = clock + 8;
    }
  }
  const frame = t => {
    if (disposed) return;
    clock += last == null ? 0 : Math.max(0, Math.min(0.1, t - last));
    last = t;
    for (const slot of slots) {
      if (clock < slot.due) continue;
      if (slot.phase === 'booked') slot.phase = 'waiting';
      if (slot.phase === 'dwell') {
        void begin(slot, false);
        continue;
      }
      if (slot.phase !== 'waiting' || slots.indexOf(slot) >= Math.min(3, eligible.length)) continue;
      const visible = towns
        .portState()
        .filter(p => p.near)
        .map(p => p.k);
      for (let j = 0; j < eligible.length; j++) {
        const visit = eligible[(cursor + j) % eligible.length];
        if (!visible.includes(visit.k) || towns.docksOf(visit.k).every(d => d.occupied)) continue;
        slot.visit = visit;
        cursor = (cursor + j + 1) % eligible.length;
        void begin(slot, true);
        break;
      }
    }
  };
  T.onFrame.push(frame);
  // Constellation ships book a slot while still far out, so only ships that can dock fly in.
  function book() {
    if (disposed || !towns.portState().some(p => towns.docksOf(p.k).some(d => !d.occupied))) return null;
    const slot = slots.find(s => s.phase === 'waiting');
    if (!slot) return null;
    slot.phase = 'booked';
    slot.due = clock + 20; // released if the ship never arrives
    return slot;
  }
  // A ship arriving from the constellation: dock at the free bay that faces it.
  function arrive(entry, route, slot) {
    if (disposed || slot?.phase !== 'booked') return false;
    const toward = entry.clone().normalize();
    let best = null;
    for (const p of towns.portState()) {
      if (towns.docksOf(p.k).every(d => d.occupied)) continue;
      const facing = towns.portOf(p.k).clone().normalize().dot(toward);
      if (!best || facing > best.facing) best = { k: p.k, facing };
    }
    if (!best) {
      slot.phase = 'waiting';
      return false;
    }
    slot.visit = eligible.find(v => v.k === best.k) || { k: best.k, route };
    void begin(slot, true, entry);
    return true;
  }
  return {
    book,
    arrive,
    setExit: provider => {
      exitPoint = provider || (() => null);
    },
    snapshot: () => ({
      eligibleRoutes: eligible.length,
      visits: slots.map(s => {
        const craft = s.ctl.active || s.ctl.docked;
        return {
          phase: s.phase,
          k: s.visit?.k,
          path: s.visit?.route.path,
          bay: craft?.dock?.index,
          position: craft?.ship.position.toArray(),
          dock: craft?.dock?.point.toArray(),
        };
      }),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      const index = T.onFrame.indexOf(frame);
      if (index >= 0) T.onFrame.splice(index, 1);
      for (const slot of slots) slot.ctl.dispose();
    },
  };
}
