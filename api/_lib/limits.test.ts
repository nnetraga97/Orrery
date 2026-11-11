import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATE_LIMIT, costCents, createLimits, visitorKey } from './limits.ts';

test('30 requests per visitor in 5 minutes, then rate_limited; the window moves on', () => {
  let t = 0;
  const limits = createLimits({ now: () => t });
  for (let i = 0; i < RATE_LIMIT.requests; i++) assert.ok(limits.check('a').ok);
  const over = limits.check('a');
  assert.equal(!over.ok && over.code, 'rate_limited');
  assert.ok(limits.check('b').ok, 'another visitor is not limited');
  t += RATE_LIMIT.windowMs + 1;
  assert.ok(limits.check('a').ok);
});

test('the daily budget stops requests once spent, and resets the next day', () => {
  let t = Date.parse('2026-11-10T10:00:00Z');
  const limits = createLimits({ budgetCents: 100, now: () => t });
  limits.spend(60);
  assert.ok(limits.check('a').ok);
  limits.spend(50);
  const over = limits.check('a');
  assert.equal(!over.ok && over.code, 'budget_spent');
  t = Date.parse('2026-11-11T00:00:01Z');
  assert.ok(limits.check('a').ok);
  assert.equal(limits.spentToday, 0);
});

test('visitors are known only by a hash of their first forwarded address', () => {
  assert.equal(visitorKey('1.2.3.4, 10.0.0.1'), visitorKey('1.2.3.4'));
  assert.notEqual(visitorKey('1.2.3.4'), visitorKey('5.6.7.8'));
  assert.ok(!visitorKey('1.2.3.4').includes('1.2.3.4'));
});

test('cost from usage, with an expensive default for unknown models', () => {
  assert.equal(costCents('claude-opus-5-5', { input: 1e6, output: 0 }), 500);
  assert.ok(costCents('unknown', { input: 1e6, output: 0 }) > 500);
});
