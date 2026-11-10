// Agent providers whose local sessions Galaxy can list and observe.
// `transport` is the name hosts use for a provider's local session files; `id` is the provider in events.
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'claude-code', transport: 'claude', displayName: 'Claude Code' }),
  Object.freeze({ id: 'codex', transport: 'codex', displayName: 'Codex' }),
]);

function providerForTransport(transport) {
  const provider = PROVIDERS.find(p => p.transport === transport);
  if (!provider) throw new Error('Unsupported agent transport.');
  return provider;
}

module.exports = { PROVIDERS, providerForTransport };
