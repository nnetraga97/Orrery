// GET /api/providers: which providers the server can relay to (whether it holds each one's key) and their models.
import { providerList } from './_lib/providers.ts';

/** GET /api/providers (web-standard handler). */
export async function GET(request: Request): Promise<Response> {
  void request;
  return Response.json({ providers: providerList(process.env) }, { headers: { 'Cache-Control': 'no-store' } });
}
