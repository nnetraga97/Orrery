#!/usr/bin/env node
// Serves the server functions in api/ on a local port for development (Vite proxies /api to it). Keys come from this
// process's environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, NEBIUS_API_KEY); nothing is read from files.
// Usage: node --experimental-strip-types tools/dev-api.mjs [--port=8787]
import http from 'node:http';
import { toNodeHandler } from './api-bridge.mjs';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? process.env.API_PORT ?? 8787);
const routes = {
  '/api/agent': () => import('../api/agent.ts'),
  '/api/providers': () => import('../api/providers.ts'),
};
const handlers = new Map();

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;
  const load = routes[path];
  if (!load) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!handlers.has(path)) handlers.set(path, toNodeHandler(await load(), path));
  await handlers.get(path)(req, res);
});
server.listen(port, '127.0.0.1', () => {
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NEBIUS_API_KEY'].filter(k => process.env[k]?.trim());
  console.log(`[dev-api] http://127.0.0.1:${port}/api — keys present: ${keys.length ? keys.join(', ') : 'none (the recorded agent answers)'}`);
});
