// Optional structured evidence. Tool-specific adapters may supply this; shell text is not evidence.
const { resource } = require('./resources.cjs');
const KINDS = new Set(['artifact', 'build', 'test', 'repository', 'ui', 'transfer', 'debug']);
function semantics(input, root, base = root) {
  if (!input || !KINDS.has(input.action)) return {};
  const out = { action: input.action, evidence: 'structured' };
  for (const k of ['label', 'artifactType', 'revision', 'branch', 'remote', 'url', 'requestId'])
    if (typeof input[k] === 'string') out[k] = input[k].slice(0, 1024);
  for (const k of ['inputs', 'outputs'])
    if (Array.isArray(input[k]))
      out[k] = input[k]
        .slice(0, 32)
        .map(x => resource(typeof x === 'string' ? x : x?.path || x?.uri, root, base))
        .filter(Boolean);
  if (Array.isArray(input.changes))
    out.changes = input.changes
      .slice(0, 128)
      .map(c => ({ path: resource(c?.path, root, base)?.path, change: c?.change }))
      .filter(c => c.path && ['create', 'edit', 'delete'].includes(c.change));
  if (input.from && input.to) {
    out.from = resource(input.from.path || input.from.uri || input.from, root, base);
    out.to = resource(input.to.path || input.to.uri || input.to, root, base);
  }
  if (input.tests)
    out.tests = Object.fromEntries(
      ['passed', 'failed', 'skipped', 'total']
        .filter(k => Number.isSafeInteger(input.tests[k]) && input.tests[k] >= 0)
        .map(k => [k, input.tests[k]]),
    );
  if (typeof input.pushConfirmed === 'boolean') out.pushConfirmed = input.pushConfirmed;
  if (
    input.progress &&
    Number.isFinite(input.progress.completed) &&
    Number.isFinite(input.progress.total) &&
    input.progress.total > 0 &&
    input.progress.completed >= 0 &&
    input.progress.completed <= input.progress.total
  )
    out.progress = { completed: input.progress.completed, total: input.progress.total };
  return out;
}
module.exports = { semantics, KINDS };
