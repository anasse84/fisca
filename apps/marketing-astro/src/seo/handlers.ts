import { EDITORIAL_PAGES, findEditorialPageByMirrorPath, findEditorialPageByPath } from '../content/pages.ts';
import { PRICING_CATALOG_OFFERS, PRICING_PLANS } from '../content/pricing.ts';
import { buildLlmsFullTxt, buildLlmsTxt } from './llms.ts';
import { buildMcpManifest } from './mcp-manifest.ts';
import { markdownResponse } from './mirror.ts';
import { prefersMarkdown } from './negotiation.ts';
import { buildRobotsTxt } from './robots.ts';

const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const CACHE = 'public, max-age=300';

/** Handlers purs : Request/Response uniquement, ni cookie ni télémétrie. */
function textResponse(body: string, contentType: string, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': CACHE, ...extra } });
}

export function handleLlmsTxt(): Response {
  return textResponse(buildLlmsTxt(PRICING_PLANS, EDITORIAL_PAGES, PRICING_CATALOG_OFFERS), TEXT);
}

export function handleLlmsFullTxt(): Response {
  return textResponse(buildLlmsFullTxt(PRICING_PLANS, EDITORIAL_PAGES, PRICING_CATALOG_OFFERS), TEXT);
}

export function handleRobotsTxt(): Response {
  return textResponse(buildRobotsTxt(), TEXT);
}

export function handleMcpManifest(): Response {
  return textResponse(JSON.stringify(buildMcpManifest(), null, 2), JSON_TYPE, {
    'Access-Control-Allow-Origin': '*',
  });
}

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/** Jumeau `/<locale>/<slug>.md` : Response, ou undefined si l'URL n'est pas un miroir du registre. */
export function handleMirrorRequest(request: Request): Response | undefined {
  const page = findEditorialPageByMirrorPath(new URL(request.url).pathname);
  if (page === undefined) return undefined;
  if (!isReadMethod(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return markdownResponse(page, request.method);
}

/** `Accept: text/markdown` sur l'URL HTML : Response Markdown, ou undefined pour laisser passer vers le HTML. */
export function negotiateMarkdown(request: Request): Response | undefined {
  if (!isReadMethod(request.method)) return undefined;
  if (!prefersMarkdown(request.headers.get('accept'))) return undefined;
  const page = findEditorialPageByPath(new URL(request.url).pathname);
  if (page === undefined) return undefined;
  return markdownResponse(page, request.method);
}

/** Vrai si l'URL est une page éditoriale HTML (pour y poser `Vary: Accept`). */
export function isEditorialHtmlPath(pathname: string): boolean {
  return findEditorialPageByPath(pathname) !== undefined;
}
