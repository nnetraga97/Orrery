// POST /api/agent: relays one model call for the browser's agent loop to Claude, OpenAI or Nemotron, with the keys
// the server holds (ANTHROPIC_API_KEY, OPENAI_API_KEY, NEBIUS_API_KEY), and streams wire events back.
import { createClaudeClient, streamClaude } from './_lib/claude.ts';
import { DEFAULT_BUDGET_CENTS, createLimits } from './_lib/limits.ts';
import { streamNemotron } from './_lib/nemotron.ts';
import { createOpenAIClient, streamOpenAI } from './_lib/openai.ts';
import { createRelay } from './_lib/relay.ts';

const limits = createLimits({ budgetCents: Number(process.env.DAILY_BUDGET_CENTS) || DEFAULT_BUDGET_CENTS });

export default createRelay({
  env: process.env,
  limits,
  adapter(provider, key) {
    if (provider === 'claude') {
      const client = createClaudeClient(key);
      return (req, emit, signal) => streamClaude(client, req, emit, signal);
    }
    if (provider === 'openai') {
      const client = createOpenAIClient(key);
      return (req, emit, signal) => streamOpenAI(client, req, emit, signal);
    }
    if (provider === 'nemotron') return (req, emit, signal) => streamNemotron(fetch, key, req, emit, signal);
    return null;
  },
});
