// Only values actually supplied by provider events are measurements. Category
// definitions, messages seen and tool calls are never estimates of token allocation.
export const CONTEXT_CATEGORIES = Object.freeze([
  { id: 'archive', name: 'Conversation archive', meaning: 'Messages and retained tool results', clip: 'Archive cycle' },
  {
    id: 'instructions',
    name: 'Instruction complex',
    meaning: 'System, project, and agent instructions',
    clip: 'Instruction doors',
  },
  { id: 'knowledge', name: 'Knowledge library', meaning: 'Loaded skills and memory', clip: 'Library retrieval' },
  { id: 'registry', name: 'Tool registry', meaning: 'Tool definitions included in context', clip: 'Registry arms' },
  {
    id: 'standby',
    name: 'Standby depot',
    meaning: 'Deferred capabilities outside occupied context',
    clip: 'Depot transfer',
  },
  {
    id: 'compaction',
    name: 'Compaction facility',
    meaning: 'Summaries and observed compaction events',
    clip: 'Compaction cycle',
  },
]);
const count = value => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null);
export function createContextState(carry = null) {
  let data;
  const seen = new Set();
  function reset(saved = null) {
    data = {
      tokens: null,
      limit: null,
      provider: null,
      reportedAt: null,
      awaitingPostCompaction: false,
      compactions: 0,
      lastCompactionAt: null,
      ...saved,
    };
    seen.clear();
    for (const id of saved?.seen || []) seen.add(id);
    delete data.seen;
  }
  reset(carry);
  function accept(event) {
    if (!['usage', 'compact', 'prompt', 'text', 'thinking', 'fire', 'resolve'].includes(event.kind)) return null;
    if (event.id && seen.has(event.id)) return null;
    if (event.id) {
      seen.add(event.id);
      if (seen.size > 256) seen.delete(seen.values().next().value);
    }
    if (event.kind === 'usage') {
      const tokens = count(event.context);
      if (tokens == null) return null;
      data.tokens = tokens;
      data.limit = count(event.contextLimit) > 0 ? count(event.contextLimit) : null;
      data.provider = event.provider || event.source || 'Provider usage event';
      data.reportedAt = event.timestamp ?? Date.now();
      data.awaitingPostCompaction = false;
      return 'usage';
    }
    if (event.kind === 'compact') {
      data.compactions++;
      data.lastCompactionAt = event.timestamp ?? Date.now();
      data.awaitingPostCompaction = true;
      if (count(event.post) != null) {
        data.tokens = count(event.post);
        data.reportedAt = data.lastCompactionAt;
        data.provider = event.provider || event.source || data.provider || 'Compaction event';
        data.awaitingPostCompaction = false;
      }
      return 'compaction';
    }
    if (event.kind === 'fire') return 'registry';
    return 'archive';
  }
  const snapshot = () => ({
    ...data,
    fraction: data.tokens != null && data.limit != null ? data.tokens / data.limit : null,
    breakdownAvailable: false,
    categories: CONTEXT_CATEGORIES.map(c => ({ id: c.id, tokens: null, included: c.id !== 'standby' })),
  });
  return { accept, reset, snapshot, capture: () => ({ ...data, seen: [...seen] }) };
}
