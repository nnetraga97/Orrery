// GET /api/providers: which providers the server can relay to (whether it holds each one's key) and their models.
import { providerList } from './_lib/providers.ts';

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  return Response.json({ providers: providerList(process.env) }, { headers: { 'Cache-Control': 'no-store' } });
}
