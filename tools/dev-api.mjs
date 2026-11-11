#!/usr/bin/env node
// Serves the server functions in api/ on a local port for development (Vite proxies /api to it). Keys come from this
// process's environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, NEBIUS_API_KEY); nothing is read from files.
// Usage: node --experimental-strip-types tools/dev-api.mjs [--port=8787]
import http from 'node:http';
import { Readable } from 'node:stream';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? process.env.API_PORT ?? 8787);
const routes = {
  '/api/agent': () => import('../api/agent.ts'),
  '/api/providers': () => import('../api/providers.ts'),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const load = routes[url.pathname];
  if (!load) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const { default: handler } = await load();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
    const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half', signal: abort.signal });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (e) {
    // Never print request contents: only that something failed.
    console.error(`[dev-api] ${url.pathname} failed: ${e instanceof Error ? e.name : 'error'}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.listen(port, '127.0.0.1', () => {
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NEBIUS_API_KEY'].filter(k => process.env[k]?.trim());
  console.log(`[dev-api] http://127.0.0.1:${port}/api — keys present: ${keys.length ? keys.join(', ') : 'none (the recorded agent answers)'}`);
});
