import { defineMiddleware } from 'astro:middleware';
import { findEditorialPageByMirrorPath, findEditorialPageByPath } from './content/pages.ts';
import { serveWithEdgeCache } from './edge/edge-cache.ts';
import { pageKeyOf } from './edge/freshness.ts';
import { edgeCacheOf, freshnessStoreOf, systemNowSeconds, telemetryStoreOf, waitUntilOf } from './edge/runtime.ts';
import { recordPageView } from './edge/telemetry.ts';
import { isEditorialHtmlPath, negotiateMarkdown } from './seo/handlers.ts';
import { withSecurityHeaders } from './seo/security-headers.ts';

/**
 * Négociation Accept: text/markdown (Doc_18 S03), fraîcheur des pages (`dateModified`, S08), cache edge des réponses texte
 * purgeable par l'événement Wiki (S08) et télémétrie agrégée sans cookie (S09). Aucun cookie n'est posé ici.
 */
export const onRequest = defineMiddleware(async (context, next) => withSecurityHeaders(await handle(context, next)));

async function handle(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0], next: Parameters<Parameters<typeof defineMiddleware>[0]>[1]): Promise<Response> {
  const { request, url } = context;
  const runtime = context.locals.runtime;
  const waitUntil = waitUntilOf(runtime);

  const page = findEditorialPageByPath(url.pathname) ?? findEditorialPageByMirrorPath(url.pathname);
  const freshness = freshnessStoreOf(runtime);
  if (page !== undefined && freshness !== undefined) {
    try {
      const date = await freshness.get(pageKeyOf(page.locale, page.slug));
      if (date !== undefined) context.locals.dateModifiedIso = date;
    } catch {
      // Sans date de fraîcheur, la page reste servie et le JSON-LD omet dateModified.
    }
  }

  const markdown = negotiateMarkdown(request, context.locals.dateModifiedIso);
  if (markdown !== undefined) return markdown;

  const cache = edgeCacheOf(runtime);
  const response = cache === undefined ? await next() : await serveWithEdgeCache(request, cache, () => next(), waitUntil);

  const store = telemetryStoreOf(runtime);
  if (store !== undefined && waitUntil !== undefined) waitUntil(recordPageView(request, response, store, systemNowSeconds));

  if (!isEditorialHtmlPath(url.pathname)) return response;
  const varied = new Response(response.body, response);
  varied.headers.append('Vary', 'Accept');
  return varied;
}
