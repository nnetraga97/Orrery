// The providers the relay knows, and which of them the server holds a key for. No key material ever leaves here.
import { CLAUDE_DEFAULT_MODEL, CLAUDE_MODELS } from './claude.ts';
import { NEMOTRON_DEFAULT_MODEL, NEMOTRON_MODELS } from './nemotron.ts';
import { OPENAI_DEFAULT_MODEL, OPENAI_MODELS } from './openai.ts';

export type ProviderId = 'claude' | 'openai' | 'nemotron';
export const PROVIDERS: { id: ProviderId; label: string; env: string; models: string[]; model: string }[] = [
  { id: 'claude', label: 'Claude', env: 'ANTHROPIC_API_KEY', models: CLAUDE_MODELS, model: CLAUDE_DEFAULT_MODEL },
  { id: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY', models: OPENAI_MODELS, model: OPENAI_DEFAULT_MODEL },
  { id: 'nemotron', label: 'Nemotron', env: 'NEBIUS_API_KEY', models: NEMOTRON_MODELS, model: NEMOTRON_DEFAULT_MODEL },
];

export const keyFor = (env: Record<string, string | undefined>, id: string) => {
  const p = PROVIDERS.find(x => x.id === id);
  return p ? env[p.env]?.trim() || null : null;
};

export const providerList = (env: Record<string, string | undefined>) =>
  PROVIDERS.map(p => ({ id: p.id, label: p.label, models: p.models, model: p.model, available: !!env[p.env]?.trim() }));
