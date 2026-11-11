// Turns the web-standard handlers in api/ (one export per method: GET, POST) into a Node (req, res) handler. Used by
// the local relay (tools/dev-api.mjs), and by any host that runs Node handlers.
// A closed connection aborts the request's signal, which stops the provider call and its spend.
import { Readable } from 'node:stream';

export function toNodeHandler(handlers, name) {
  return async (req, res) => {
    const handler = handlers[req.method ?? 'GET'];
    if (!handler) {
      res.writeHead(405).end('Method not allowed');
      return;
    }
    try {
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
      const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half', signal: abort.signal });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (e) {
      // Never print request contents: only that something failed.
      console.error(`[api] ${name} failed: ${e instanceof Error ? e.name : 'error'}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}
