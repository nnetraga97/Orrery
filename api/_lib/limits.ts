// Spending guards for the relay: a per-visitor rate limit (90 model calls in 5 minutes, by a hash of the forwarded
// address, so no address is kept) and a daily budget in US cents (DAILY_BUDGET_CENTS, default 2500), counted from the
// usage each adapter reports. Kept in memory: each server instance counts on its own, which errs toward allowing a
// little more, never toward a leaked key.
import { createHash } from 'node:crypto';

/** One request from the user is many model calls (one per round of tools), so the limit is counted in calls. */
export const RATE_LIMIT = { requests: 90, windowMs: 5 * 60 * 1000 };
export const DEFAULT_BUDGET_CENTS = 2500;

export type Verdict = { ok: true } | { ok: false; code: 'rate_limited' | 'budget_spent'; message: string };

export const visitorKey = (forwardedFor: string | null) =>
  createHash('sha256').update((forwardedFor ?? 'unknown').split(',')[0].trim()).digest('hex').slice(0, 24);

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createLimits({ budgetCents = DEFAULT_BUDGET_CENTS, now = () => Date.now() } = {}) {
  const visits = new Map<string, number[]>();
  let day = dayOf(now()),
    spent = 0;
  const rollDay = () => {
    const today = dayOf(now());
    if (today !== day) {
      day = today;
      spent = 0;
    }
  };
  return {
    /** Counts the request and says whether it may go to a provider. */
    check(visitor: string): Verdict {
      rollDay();
      if (spent >= budgetCents) return { ok: false, code: 'budget_spent', message: "Today's budget for the live agent is spent. Start a new chat to watch the recorded agent." };
      const t = now(),
        recent = (visits.get(visitor) ?? []).filter(at => t - at < RATE_LIMIT.windowMs);
      if (recent.length >= RATE_LIMIT.requests) {
        visits.set(visitor, recent);
        return { ok: false, code: 'rate_limited', message: 'Too many requests for now. Wait a minute, then pinch Retry.' };
      }
      recent.push(t);
      visits.set(visitor, recent);
      // Forget idle visitors so the map stays small.
      if (visits.size > 5000) for (const [k, v] of visits) if (!v.some(at => t - at < RATE_LIMIT.windowMs)) visits.delete(k);
      return { ok: true };
    },
    spend(cents: number) {
      rollDay();
      if (Number.isFinite(cents) && cents > 0) spent += cents;
    },
    get spentToday() {
      rollDay();
      return spent;
    },
  };
}
export type Limits = ReturnType<typeof createLimits>;

/** US cents per million tokens, by model: input, output, cache read, cache write. Estimates for the budget guard,
 * on the high side; the provider's bill is the authority. */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [500, 2500, 50, 625],
  'claude-sonnet-5-5': [300, 1500, 30, 375],
  'gpt-6-astra': [500, 3000, 50, 500],
  'nvidia/nemotron-3-super-120b-a12b': [30, 90, 30, 30],
};
const FALLBACK_PRICE: [number, number, number, number] = [1500, 7500, 150, 1875];

export function costCents(model: string, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) {
  const [i, o, r, w] = PRICES[model] ?? FALLBACK_PRICE;
  return (usage.input * i + usage.output * o + (usage.cacheRead ?? 0) * r + (usage.cacheWrite ?? 0) * w) / 1e6;
}
