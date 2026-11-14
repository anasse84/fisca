/**
 * Émetteur du lien signé : `POST /api/handoff` (contrat PROVISIONAL, absent du registre). Corps JSON `{ "ice": "<15 chiffres>" }`,
 * réponse `{ "url": "https://app.fisca.ma/?fisca_handoff=...", "expiresInSeconds": n }`. Le secret ne quitte jamais le Worker.
 */
import { normalizeIceCell } from '../tools/ice.ts';
import { DEFAULT_HANDOFF_TTL_SECONDS, isValidHandoffTtl, issueHandoffLink } from './handoff.ts';
import type { NowSeconds, RandomBytes } from './ports.ts';

const MAX_BODY_CHARS = 512;

export interface HandoffEndpointDeps {
  readonly secret: string | undefined;
  /** Durée de vie du lien, en secondes : paramètre, jamais une constante cachée. Invalide ou absente : défaut du module. */
  readonly ttlSeconds: number | undefined;
  readonly nowSeconds: NowSeconds;
  readonly randomBytes: RandomBytes;
}

function json(status: number, body: Readonly<Record<string, unknown>>, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export async function handleHandoffRequest(request: Request, deps: HandoffEndpointDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return json(403, { error: 'FORBIDDEN_ORIGIN' });
  if (deps.secret === undefined) return json(503, { error: 'NOT_CONFIGURED' });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { error: 'UNSUPPORTED_MEDIA_TYPE' });

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json(413, { error: 'BODY_TOO_LARGE' });
  let ice = '';
  try {
    const data: unknown = JSON.parse(raw);
    const candidate = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['ice'] : undefined;
    if (typeof candidate === 'string') ice = normalizeIceCell(candidate);
  } catch {
    return json(400, { error: 'INVALID_JSON' });
  }

  const ttlSeconds = deps.ttlSeconds !== undefined && isValidHandoffTtl(deps.ttlSeconds) ? deps.ttlSeconds : DEFAULT_HANDOFF_TTL_SECONDS;
  const issued = await issueHandoffLink({ ice, secret: deps.secret, ttlSeconds, nowSeconds: deps.nowSeconds, randomBytes: deps.randomBytes });
  if (!issued.ok) return json(issued.error === 'INVALID_ICE' ? 400 : 500, { error: issued.error });
  return json(200, { url: issued.url, expiresInSeconds: ttlSeconds });
}
