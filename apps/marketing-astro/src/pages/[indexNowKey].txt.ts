import type { APIRoute } from 'astro';
import { BINDING_NAMES, readString } from '../edge/env.ts';
import { timingSafeEqualText } from '../edge/hmac.ts';
import { isValidIndexNowKey } from '../edge/indexnow.ts';

/**
 * Fichier de clé IndexNow : `/<clé>.txt` contient la clé (https://www.indexnow.org/documentation). La clé vient de la liaison
 * `MARKETING_INDEXNOW_KEY` ; aucune valeur dans le dépôt. Toute autre URL `/xxx.txt` répond 404.
 */
export const GET: APIRoute = ({ params, locals }) => {
  const key = readString(locals.runtime?.env, BINDING_NAMES.indexNowKey);
  const requested = params['indexNowKey'];
  if (key === undefined || requested === undefined || !isValidIndexNowKey(key) || !timingSafeEqualText(requested, key)) {
    return new Response(null, { status: 404 });
  }
  return new Response(key, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
