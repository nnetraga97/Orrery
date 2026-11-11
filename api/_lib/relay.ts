// The agent relay as a function of its dependencies, so it can be tested without keys or network: validate the
// request (the wire format, exactly this app's tools, at most 2 MB), check the visitor's rate and the day's budget,
// pick the provider's adapter, and stream wire events back as server-sent events. Message contents are never logged.
import { PROJECT_NAME, systemPrompt } from '../../src/core/agent/prompt.ts';
import { TOOLS } from '../../src/core/agent/tools.ts';
import { requestErrors } from '../../src/core/agent/wire.ts';
import type { AgentRequest, StreamEvent, Usage } from '../../src/core/agent/wire.ts';
import { costCents, visitorKey } from './limits.ts';
import type { Limits } from './limits.ts';
import { keyFor } from './providers.ts';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Output tokens counted for a call the browser cut off before its usage arrived. */
export const ABORTED_OUTPUT_TOKENS = 8000;
const TOOLS_JSON = JSON.stringify(TOOLS);

export type Adapter = (request: AgentRequest, emit: (e: StreamEvent) => void, signal: AbortSignal) => Promise<{ model: string; usage: Usage } | null>;
export type RelayDeps = {
  env: Record<string, string | undefined>;
  limits: Limits;
  /** The adapter for a provider, given its key. */
  adapter(provider: string, key: string): Adapter | null;
};

const sseHeaders = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' };
const encode = (e: StreamEvent) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`);

/** One error event as the whole stream. */
const errorStream = (code: Extract<StreamEvent, { type: 'error' }>['code'], message: string) =>
  new Response(encode({ type: 'error', code, message }), { status: 200, headers: sseHeaders });

export function createRelay(deps: RelayDeps) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) return Response.json({ error: 'The request is larger than 2 MB.' }, { status: 413 });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return Response.json({ error: 'The request is larger than 2 MB.' }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: 'The request is not JSON.' }, { status: 400 });
    }
    const errors = requestErrors(body);
    if (errors.length) return Response.json({ error: errors.join(' ') }, { status: 400 });
    const req = body as AgentRequest;
    if (JSON.stringify(req.tools) !== TOOLS_JSON) return Response.json({ error: "The tools must be exactly this app's tools." }, { status: 400 });
    // The system prompt is the app's own, built here from the project name: the browser's copy is not trusted.
    const project = req.project && PROJECT_NAME.test(req.project) ? req.project : 'project';
    req.system = systemPrompt(project);
    const key = keyFor(deps.env, req.provider);
    const adapter = key ? deps.adapter(req.provider, key) : null;
    if (!adapter) return errorStream('unavailable', 'This provider is not available.');
    const verdict = deps.limits.check(visitorKey(request.headers.get('x-forwarded-for')));
    if (!verdict.ok) return errorStream(verdict.code, verdict.message);
    const abort = new AbortController();
    request.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (e: StreamEvent) => {
          try {
            controller.enqueue(encode(e));
          } catch {
            abort.abort();
          }
        };
        try {
          const done = await adapter(req, emit, abort.signal);
          if (done) deps.limits.spend(costCents(done.model, done.usage));
          // A call cut off by the browser still cost something: count the request and a long answer, on the high side.
          else if (abort.signal.aborted) deps.limits.spend(costCents('unknown', { input: raw.length / 4, output: ABORTED_OUTPUT_TOKENS }));
        } catch {
          emit({ type: 'error', code: 'internal', message: 'The relay failed.' });
        }
        try {
          controller.close();
        } catch {
          // The browser went away.
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, { status: 200, headers: sseHeaders });
  };
}
