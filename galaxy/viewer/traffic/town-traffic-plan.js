// Pure structural trips share the exact lane coordinates produced by town-layout.js.
import { terminalKind, ifChain } from '../shared/town-flow.js';

const JDK_EXCEPTIONS = (() => {
  const parents = {
    Throwable: [],
    Exception: ['Throwable'],
    Error: ['Throwable'],
    RuntimeException: ['Exception'],
    AssertionError: ['Error'],
    OutOfMemoryError: ['Error'],
    StackOverflowError: ['Error'],
    IllegalStateException: ['RuntimeException'],
    IllegalArgumentException: ['RuntimeException'],
    NumberFormatException: ['IllegalArgumentException'],
    UnsupportedOperationException: ['RuntimeException'],
    NullPointerException: ['RuntimeException'],
    ClassCastException: ['RuntimeException'],
    ArithmeticException: ['RuntimeException'],
    IndexOutOfBoundsException: ['RuntimeException'],
    ArrayIndexOutOfBoundsException: ['IndexOutOfBoundsException'],
    StringIndexOutOfBoundsException: ['IndexOutOfBoundsException'],
    NoSuchElementException: ['RuntimeException'],
    ConcurrentModificationException: ['RuntimeException'],
    SecurityException: ['RuntimeException'],
    UncheckedIOException: ['RuntimeException'],
    IOException: ['Exception'],
    FileNotFoundException: ['IOException'],
    InterruptedException: ['Exception'],
    CloneNotSupportedException: ['Exception'],
    TimeoutException: ['Exception'],
    ExecutionException: ['Exception'],
    ReflectiveOperationException: ['Exception'],
    ClassNotFoundException: ['ReflectiveOperationException'],
    NoSuchMethodException: ['ReflectiveOperationException'],
    NoSuchFieldException: ['ReflectiveOperationException'],
    InstantiationException: ['ReflectiveOperationException'],
    IllegalAccessException: ['ReflectiveOperationException'],
    InvocationTargetException: ['ReflectiveOperationException'],
  };
  const chain = n => new Set([n, ...(parents[n] || []).flatMap(p => [...chain(p)])]);
  return Object.fromEntries(Object.keys(parents).map(n => [n, chain(n)]));
})();

// ---------- planning: one trip through the flow tree, as waypoints in the town plane ----------
export function planTrip(tw, run, scope = tw.cols[0].c.scope) {
  const path = [],
    pending = [];
  const columns = tw.cols.filter(co => co.c.scope === scope && co.c.items.length);
  const emit = (co, x, y, how = 'road') => {
    const p = co.map([x, y]),
      last = path[path.length - 1];
    if (last && Math.hypot(last.p[0] - p[0], last.p[1] - p[1]) < 1e-6) {
      last.visits.push(...pending.splice(0));
      if (how !== 'road') last.how = how;
      return;
    }
    path.push({ p, how, visits: pending.splice(0) });
  };
  const pick = (key, n) => {
    // the arm taken least so far; ties go to the earlier arm
    let i = 0;
    for (let j = 1; j < n; j++)
      if ((run.planned.get(key + ':' + j) || 0) < (run.planned.get(key + ':' + i) || 0)) i = j;
    run.planned.set(key + ':' + i, (run.planned.get(key + ':' + i) || 0) + 1);
    return i;
  };
  const seqEnd = (items, startY) =>
    items.length ? items[items.length - 1]._at.y - items[items.length - 1]._m.h : startY;
  const owns = (sig, it) => !sig.label || sig.label === it.label;
  // Which catch clause takes a throw, or null when it escapes. Untyped catches (JavaScript) and Exception/Throwable take
  // everything, and an exact class match always does. JDK exceptions are decided from their known ancestors. Other classes
  // might still be a subclass of a differently named catch type without the class hierarchy, so those are left to chance.
  const catchClause = (it, sig) => {
    if (it.catchAll) return 0;
    const groups = it.catchTypes || [],
      jdk = JDK_EXCEPTIONS[sig.thrown];
    if (jdk) {
      const i = groups.findIndex(g => g.some(n => jdk.has(n)));
      return i >= 0 ? i : null;
    }
    const sure = groups.findIndex(g =>
      g.some(n => n === 'Exception' || n === 'Throwable' || (sig.thrown && n === sig.thrown)),
    );
    if (sure >= 0) return sure;
    const i = pick(it.id + 'c', groups.length + 1);
    return i < groups.length ? i : null;
  };
  const execSeq = (items, st) => {
    for (const it of items) {
      const sig = walk(it, st);
      if (sig) return sig;
    }
    return null;
  };

  function walk(it, st) {
    const co = it._co,
      { x, y } = it._at,
      m = it._m;
    pending.push(it);
    switch (it.t) {
      case 'stmt': {
        emit(co, x, y);
        emit(co, x, y - m.h / 2);
        if (terminalKind(it)) return { kind: terminalKind(it), thrown: it.thrown };
        if (it.kind === 'jump') {
          const j = /^\s*(break|continue|yield)\b\s*([\w$]+)?/.exec(it.summary || '');
          if (j) return { kind: j[1] === 'continue' ? 'continue' : 'break', label: j[1] === 'yield' ? null : j[2], it };
        }
        emit(co, x, y - m.h);
        return null;
      }
      case 'if': {
        const L = it._lanes;
        if (L.ladder) {
          const { branches, tail } = ifChain(it),
            choice = pick(it.id, branches.length + 1);
          emit(co, x, y);
          for (let i = 0; i < branches.length; i++) {
            const branch = branches[i],
              rung = branch._lanes;
            if (i) pending.push(branch);
            emit(co, ...rung.fork);
            if (i === choice) {
              emit(co, ...rung.then);
              const sig = execSeq(branch.then, st);
              if (sig) return sig;
              emit(co, rung.then[0], rung.end);
              emit(co, ...rung.merge);
              // A matched arm skips later tests and the final else, using
              // the same spine and short tail bypass as the renderer.
              for (let j = i + 1; j < branches.length; j++) emit(co, ...branches[j]._lanes.merge);
              for (const p of L.bypass) emit(co, ...p);
              emit(co, ...L.bottom);
              return null;
            }
            emit(co, ...rung.merge);
          }
          emit(co, ...L.tail);
          const sig = execSeq(tail, st);
          if (sig) return sig;
          emit(co, ...L.bottom);
          return null;
        }
        const thenArm = pick(it.id, 2) === 0,
          items = thenArm ? it.then : it.else || [],
          lane = thenArm ? L.then : L.else;
        emit(co, x, y);
        emit(co, ...L.fork);
        emit(co, lane[0], lane[1]);
        const sig = execSeq(items, st);
        if (sig) return sig;
        emit(co, lane[0], seqEnd(items, lane[1]));
        emit(co, lane[0], L.laneBottom);
        emit(co, ...L.bottom);
        return null;
      }
      case 'loop': {
        const L = it._lanes,
          x1 = L.ring[1][0],
          y0 = L.ring[0][1],
          y1 = L.ring[2][1],
          x0 = 2 * x - x1;
        const forever = it.summary === 'true' || /^for\s*\(\s*;\s*;\s*\)/.test(it.summary || '');
        const n = it.doWhile || forever ? 1 : pick(it.id + 'n', 2); // skipped, or one pass through the body
        emit(co, x, y);
        emit(co, x, y0);
        let left = false;
        for (let i = 0; i < n; i++) {
          emit(co, ...L.body);
          const sig = execSeq(it.body, st);
          if (sig) {
            if (sig.kind === 'break' && owns(sig, it)) {
              emit(co, x, y1, 'jump');
              left = true;
              break;
            }
            if (sig.kind === 'continue' && owns(sig, it)) emit(co, x, y1, 'jump');
            else return sig;
          } else {
            emit(co, x, seqEnd(it.body, L.body[1]));
            emit(co, x, y1);
          }
          emit(co, x0, y1);
          emit(co, x0, y0);
          emit(co, x, y0); // back edge: left half of the ring
        }
        if (!left) {
          if (forever) return { kind: 'stuck' }; // `while (true)` only ends through its body
          emit(co, x1, y0);
          emit(co, x1, y1);
          emit(co, x, y1); // condition false: right half of the ring
        }
        emit(co, x, y - m.h);
        return null;
      }
      case 'switch': {
        const L = it._lanes,
          n = it.cases.length,
          forced = it.catchSwitch ? st.forceCase : null;
        const choice = forced != null ? forced : pick(it.id, n + (it.hasDefault ? 0 : 1));
        if (it.catchSwitch) st.forceCase = null;
        emit(co, x, y);
        const downSpine = (from, to) => {
          for (let i = from; i < to; i++) emit(co, ...L.rungs[i].merge);
        };
        downSpine(0, Math.min(choice, n));
        if (choice >= n) return null; // no case matched and there is no default
        for (let i = choice; i < n; i++) {
          const rung = L.rungs[i];
          emit(co, ...rung.fork);
          emit(co, ...rung.then);
          const sig = execSeq(it.cases[i], st);
          if (sig) {
            if (sig.kind === 'break' && !sig.label) {
              const exit = rung.breaks.find(exit => exit.it === sig.it);
              if (exit) for (const p of exit.pts) emit(co, ...p);
              else emit(co, ...rung.merge, 'jump');
              downSpine(i + 1, n);
              return null;
            }
            return sig;
          }
          emit(co, rung.then[0], rung.end);
          emit(co, ...rung.merge);
          if (it.arrow || i === n - 1) {
            downSpine(i + 1, n);
            return null;
          } // ordinary cases fall through via the spine to the next rung
        }
        return null;
      }
      case 'try': {
        const L = it._lanes;
        emit(co, x, y);
        emit(co, ...L.enter);
        let sig = execSeq(it.body, st),
          caught = null;
        if (!sig) {
          emit(co, L.enter[0], seqEnd(it.body, L.enter[1]));
          emit(co, ...L.merge);
        } else if (sig.kind === 'throw' && it.handler && (caught = catchClause(it, sig)) !== null) {
          emit(co, ...L.handlerAt, 'exception');
          st.forceCase = caught;
          sig = execSeq(it.handler, st);
          if (!sig) {
            emit(co, L.handlerAt[0], seqEnd(it.handler, L.handlerAt[1]));
            emit(co, ...L.merge);
          }
        }
        if (it.finalizer && it.finalizer.length) {
          if (sig) emit(co, ...L.merge, 'jump'); // abrupt exits still run `finally`
          const fin = execSeq(it.finalizer, st);
          if (fin) return fin;
        }
        return sig;
      }
      case 'block':
        return execSeq(it.body, { ...st });
    }
    return null;
  }

  const st = {};
  const entrance = scope === tw.cols[0].c.scope ? tw.portAccess : columns[0].start;
  path.push({ p: entrance || [tw.entry[0], tw.port.y0 + 0.35 * tw.s], how: 'road', visits: [] });
  let prev = null,
    outcome = null;
  for (const co of columns) {
    if (prev && co.route) co.route.slice(1).forEach(p => path.push({ p, how: 'road', visits: [] }));
    const sig = execSeq(co.c.items, st);
    if (sig) {
      outcome = sig.kind;
      break;
    }
    prev = co;
  }
  path.kind = path.some(w => w.how === 'exception') ? 'ambulance' : outcome === 'throw' ? 'police' : 'civil';
  return path;
}
