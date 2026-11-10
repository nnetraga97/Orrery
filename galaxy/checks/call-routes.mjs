// Exercise the real analyzer and region model without renderer or filesystem state.
import assert from 'node:assert/strict';
import ts from 'typescript';
import { analyzeSource } from '../source-model/code-model.js';
import { buildRegions } from '../source-model/semantic-layout.js';
import { callRoutes, routesOf } from '../source-model/call-routes.js';

const file = 'routes.ts';
const source = `
import { remote } from './remote';
function callee(value = 0) { return value; }
function twice() {
  callee(1); callee(2);
}
function recurse(n) { if (n) return recurse(n - 1); return 0; }
class Engine {
  callee() { return 1; }
  run(other) { other.callee(); this.callee(); }
}
async function work(items) {
  await remote();
  await callee(callee(3));
  items.map(() => {
    callee(4);
    return items.map(() => callee(5));
  });
}
`;
const analyze = text => buildRegions(analyzeSource(ts, text, { file }), { file });
const regions = analyze(source),
  routes = callRoutes(regions, { file });
const named = name => {
  const region = regions.find(region => region.name === name);
  assert.ok(region, `Missing town ${name}`);
  return region;
};
const at = text => {
  const start = source.indexOf(text);
  assert.ok(start >= 0, `Missing source ${text}`);
  const route = routes.find(route => route.from.sourceStart === start);
  assert.ok(route, `Missing route ${text}`);
  return route;
};
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`pass ${name}`);
}

check('two same-line sites to one callee remain separate routes', () => {
  const outgoing = routesOf(routes, named('twice').id).outgoing;
  assert.equal(outgoing.length, 2);
  assert.notEqual(outgoing[0].id, outgoing[1].id);
  assert.notEqual(outgoing[0].from.operation, outgoing[1].from.operation);
  for (const route of outgoing) {
    assert.equal(route.kind, 'local');
    assert.deepEqual(route.to, { town: named('callee').id, external: null, unresolved: false });
  }
});

check('recursion stays a self route and appears in both directions', () => {
  const town = named('recurse').id,
    { outgoing, incoming } = routesOf(routes, town);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].kind, 'recursive');
  assert.equal(outgoing[0].to.town, town);
  assert.deepEqual(incoming, outgoing);
});

check('unknown receivers never bind to a same-name town', () => {
  assert.equal(at('other.callee()').kind, 'unresolved');
  assert.deepEqual(at('other.callee()').to, { town: null, external: null, unresolved: true });
  assert.equal(at('this.callee()').kind, 'local');
  assert.equal(at('this.callee()').to.town, regions.find(r => r.owner === 'Engine' && r.name === 'callee').id);
});

check('imports retain their external module specifier', () => {
  assert.equal(at('remote()').kind, 'external');
  assert.deepEqual(at('remote()').to, { town: null, external: './remote', unresolved: false });
});

check('nested callback calls start at the enclosing town and exact operation', () => {
  const region = named('work');
  assert.ok(region.flow.hoods.some(hood => hood.scope !== region.id));
  for (const text of ['callee(4)', 'callee(5)']) {
    const route = at(text),
      operation = region.operations.find(op => op.kind === 'call' && op.sourceStart === source.indexOf(text));
    assert.equal(route.from.town, region.id);
    assert.equal(route.from.operation, operation.id);
    assert.equal(route.from.sourceEnd, source.indexOf(text) + text.length);
  }
});

check('await marks the direct call, without marking its argument or other calls', () => {
  assert.equal(at('remote()').async, true);
  assert.equal(at('callee(callee(3))').async, true);
  assert.equal(at('callee(3)').async, false);
  assert.equal(at('callee(4)').async, false);
});

const shiftedSource =
  '\n\n// header comment\n' +
  source.replaceAll('\n', '\n\n').replace('  callee(1);', '  // call-site comment\n  callee(1);');
check('IDs survive inserted blank lines and comments outside call expressions', () => {
  const shifted = callRoutes(analyze(shiftedSource), { file });
  assert.deepEqual(
    shifted.map(route => route.id),
    routes.map(route => route.id),
  );
  assert.notEqual(shifted[0].from.line, routes[0].from.line);
  assert.notEqual(shifted[0].from.sourceStart, routes[0].from.sourceStart);
});

check('output is deterministic across region, operation and call-target order', () => {
  const shuffled = regions
    .map(region => ({
      ...region,
      operations: [...region.operations].reverse(),
      callTargets: [...region.callTargets].reverse(),
    }))
    .reverse();
  assert.deepEqual(callRoutes(shuffled, { file }), routes);
  assert.deepEqual(
    routes.map(route => [route.from.town, route.from.sourceStart]),
    routes
      .map(route => [route.from.town, route.from.sourceStart])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
  );
  assert.equal(new Set(routes.map(route => route.id)).size, routes.length);
});

check('every operation link round-trips its exact source range', () => {
  assert.equal(
    routes.length,
    regions.reduce((count, region) => count + region.callTargets.length, 0),
  );
  for (const route of routes) {
    assert.ok(route.from.operation);
    const region = regions.find(region => region.id === route.from.town),
      operation = region.operations.find(op => op.id === route.from.operation);
    assert.equal(route.from.sourceStart, operation.sourceStart);
    assert.equal(route.from.sourceEnd, operation.sourceEnd);
    assert.equal(route.from.line, operation.line);
  }
});

check('serialized input produces identical routes and input is not mutated', () => {
  const saved = JSON.stringify(regions),
    copy = JSON.parse(saved);
  assert.deepEqual(callRoutes(copy, { file }), routes);
  assert.equal(JSON.stringify(copy), saved);
  assert.deepEqual(routesOf(routes, 'absent'), { outgoing: [], incoming: [] });
  assert.deepEqual(callRoutes([], { file }), []);
  assert.deepEqual(callRoutes(analyze('const value = 1;'), { file }), []);
});

check('missing operations use stable occurrence IDs and unknown offsets stay null', () => {
  const withoutOperations = text => analyze(text).map(region => ({ ...region, operations: [] }));
  const fallback = callRoutes(withoutOperations(source), { file });
  assert.equal(fallback.length, routes.length);
  for (const route of fallback) {
    assert.equal(route.from.operation, null);
    assert.equal(route.from.sourceStart, null);
    assert.equal(route.from.sourceEnd, null);
  }
  assert.equal(new Set(fallback.map(route => route.id)).size, fallback.length);
  assert.deepEqual(
    callRoutes(withoutOperations(shiftedSource), { file }).map(route => route.id),
    fallback.map(route => route.id),
  );
});

check('range matching needs neither shared fact identity nor call text', () => {
  const region = named('twice'),
    operations = region.operations.map(op => ({ ...op, call: undefined })),
    callTargets = region.operations
      .filter(op => op.call)
      .map(op => ({
        ...op.call,
        expression: 'deliberately different text',
        sourceStart: op.sourceStart,
        sourceEnd: op.sourceEnd,
      }));
  const ranged = callRoutes([named('callee'), { ...region, operations, callTargets }], { file });
  assert.deepEqual(ranged, routesOf(routes, region.id).outgoing);
  const noRanges = callRoutes([{ ...region, operations }], { file });
  assert.ok(
    noRanges.every(route => route.from.operation === null),
    'Same name and line cannot match operations',
  );
});

check('explicit target IDs, ambiguity, cross-file resolution and async kinds', () => {
  const town = named('callee'),
    callTargets = [
      { targetId: town.id, resolution: 'resolved' },
      { target: { id: town.id }, resolution: 'resolved' },
      { name: town.name, resolution: 'resolved' },
      { target: town.name, resolution: 'resolved' },
      { id: town.id, resolution: 'ambiguous' },
      { id: town.id, resolution: 'unresolved' },
      { id: 'remote.ts#remote:function', target: 'remote.ts', resolution: 'resolved' },
      { resolution: 'external' },
    ];
  const synthetic = callRoutes([town, { id: 'caller', callTargets }], { file });
  assert.deepEqual(
    synthetic.map(route => route.kind).sort(),
    ['local', 'local', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'external', 'external'].sort(),
  );
  assert.equal(synthetic.find(route => route.to.external === 'remote.ts').kind, 'external');
  for (const kind of ['async-call', 'call-async', 'await-call']) {
    const call = { targetId: town.id, resolution: 'resolved' };
    const marked = callRoutes(
      [
        town,
        { id: 'caller', operations: [{ id: 'op', kind, sourceStart: 0, sourceEnd: 1, call }], callTargets: [call] },
      ],
      { file },
    );
    assert.equal(marked[0].async, true);
  }
});

// These gaps belong to the analyzer contract; do not claim inferred data is exact.
const commented = callRoutes(analyze(source.replace('callee(1)', 'callee(/* note */ 1)')), { file });
assert.notEqual(
  commented.find(route => route.from.town === named('twice').id).id,
  routesOf(routes, named('twice').id).outgoing[0].id,
);
console.log(
  'Analyzer limits: comments inside calls change operation IDs; bare call facts lack offsets; wrapped awaits lack operand links.',
);
console.log(`${passed} call-route checks passed.`);
