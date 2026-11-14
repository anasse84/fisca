/**
 * Synchronisation LLM Wiki -> SEO, GEO, AEO (Doc_18 S08) : événement « règle AST activée / page Wiki publiée » signé HMAC-SHA256.
 *
 * Contrat PROVISIONAL (absent du registre `fisca_contracts_registry`) : `POST /api/internal/wiki-events`, en-têtes
 * `X-Fisca-Timestamp` (secondes) et `X-Fisca-Signature` (hexadécimal), message signé `${timestamp}.${corps brut}` (format de Doc_07 S11).
 *
 * Effets, dans l'ordre : fraîcheur (`dateModified`) des pages touchées, purge du cache edge des URL concernées, notification IndexNow,
 * ping de sitemap. /llms.txt et les miroirs .md n'ont rien à « régénérer » : ils sont calculés à chaque requête depuis le registre
 * (voir tests/wiki-sync.test.ts) ; seule leur copie en cache edge est purgée.
 */
import { ALL_EDITORIAL_PAGES, canonicalUrlOf, findEditorialPage, mirrorPathOf } from '../content/pages.ts';
import type { EditorialPage } from '../content/pages.ts';
import { SITE_ORIGIN } from '../i18n/hreflang.ts';
import { localeFromPrefix } from '../i18n/locales.ts';
import { publishedSitemapSlugs, sitemapLocalesOf } from '../seo/sitemap.ts';
import { verifyHmacHex } from './hmac.ts';
import { isIsoUtcDate, pageKeyOf } from './freshness.ts';
import type { FreshnessStore } from './freshness.ts';
import { notifyIndexNow, pingSitemap } from './indexnow.ts';
import type { NotifyStatus } from './indexnow.ts';
import type { EdgeCachePort, KvLike, NowSeconds, OutboundPort } from './ports.ts';

export const WIKI_EVENT_PATH = '/api/internal/wiki-events';
export const TIMESTAMP_HEADER = 'X-Fisca-Timestamp';
export const SIGNATURE_HEADER = 'X-Fisca-Signature';
export const DEFAULT_MAX_SKEW_SECONDS = 300;
export const DEFAULT_MAX_PURGE_URLS = 500;
export const MAX_BODY_CHARS = 65536;
export const MAX_EVENT_PAGES = 2000;
const EVENT_TTL_SECONDS = 86400;

export type WikiEventKind = 'AST_RULE_ACTIVATED' | 'WIKI_PAGE_PUBLISHED';
const KINDS: readonly string[] = ['AST_RULE_ACTIVATED', 'WIKI_PAGE_PUBLISHED'];

export interface WikiEvent {
  readonly eventId: string;
  readonly kind: WikiEventKind;
  /** Date de l'événement (ISO 8601 UTC) : devient `dateModified`. Fournie par l'émetteur, jamais lue sur l'horloge. */
  readonly occurredAt: string;
  /** Pages touchées ; vide ou absent : toutes les pages du registre. */
  readonly pages: readonly EditorialPage[];
  readonly scope: 'PAGES' | 'ALL';
}

export type WikiEventParse =
  | { readonly ok: true; readonly event: WikiEvent }
  | { readonly ok: false; readonly status: 400 | 422; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseWikiEvent(raw: string): WikiEventParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: 'INVALID_JSON' };
  }
  if (!isRecord(data)) return { ok: false, status: 400, error: 'INVALID_EVENT' };
  const { eventId, kind, occurredAt, pages } = data;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(eventId)) return { ok: false, status: 400, error: 'INVALID_EVENT_ID' };
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return { ok: false, status: 400, error: 'INVALID_KIND' };
  if (typeof occurredAt !== 'string' || !isIsoUtcDate(occurredAt)) return { ok: false, status: 400, error: 'INVALID_OCCURRED_AT' };
  if (pages !== undefined && !Array.isArray(pages)) return { ok: false, status: 400, error: 'INVALID_PAGES' };
  const list: unknown[] = pages ?? [];
  if (list.length > MAX_EVENT_PAGES) return { ok: false, status: 400, error: 'TOO_MANY_PAGES' };
  const resolved: EditorialPage[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry['locale'] !== 'string' || typeof entry['slug'] !== 'string') {
      return { ok: false, status: 400, error: 'INVALID_PAGE' };
    }
    const locale = localeFromPrefix(entry['locale']);
    const page = locale === null ? undefined : findEditorialPage(locale, entry['slug']);
    if (page === undefined) return { ok: false, status: 422, error: 'UNKNOWN_PAGE' };
    if (!resolved.includes(page)) resolved.push(page);
  }
  const scope = resolved.length === 0 ? 'ALL' : 'PAGES';
  return {
    ok: true,
    event: { eventId, kind: kind as WikiEventKind, occurredAt, pages: scope === 'ALL' ? ALL_EDITORIAL_PAGES : resolved, scope },
  };
}

/** URL du cache edge à purger : points de terminaison dynamiques d'abord, puis, par page, HTML (avec et sans `/` final) et jumeau .md. */
export function purgeUrlsFor(pages: readonly EditorialPage[]): readonly string[] {
  const urls = new Set<string>([`${SITE_ORIGIN}/llms.txt`, `${SITE_ORIGIN}/llms-full.txt`, `${SITE_ORIGIN}/sitemap.xml`]);
  for (const page of pages) {
    const canonical = canonicalUrlOf(page);
    urls.add(canonical);
    urls.add(canonical.endsWith('/') ? canonical.slice(0, -1) : `${canonical}/`);
    urls.add(`${SITE_ORIGIN}${mirrorPathOf(page)}`);
  }
  return [...urls];
}

let indexableKeys: ReadonlySet<string> | undefined;

function indexableSet(): ReadonlySet<string> {
  if (indexableKeys !== undefined) return indexableKeys;
  const keys = new Set<string>();
  for (const slug of publishedSitemapSlugs(ALL_EDITORIAL_PAGES)) {
    const first = ALL_EDITORIAL_PAGES.find((p) => p.slug === slug && p.locale === 'fr');
    if (first === undefined) continue;
    for (const locale of sitemapLocalesOf(first)) keys.add(pageKeyOf(locale, slug));
  }
  indexableKeys = keys;
  return keys;
}

/** URL notifiées à IndexNow : uniquement des pages du sitemap (jamais une page noindex). */
export function indexNowUrlsFor(pages: readonly EditorialPage[]): readonly string[] {
  const set = indexableSet();
  return pages.filter((p) => set.has(pageKeyOf(p.locale, p.slug))).map(canonicalUrlOf);
}

export interface WikiSyncDeps {
  /** Secret HMAC (liaison `MARKETING_WIKI_WEBHOOK_SECRET`) ; absent : 503. */
  readonly secret: string | undefined;
  readonly nowSeconds: NowSeconds;
  readonly cache: EdgeCachePort | undefined;
  readonly freshness: FreshnessStore | undefined;
  readonly outbound: OutboundPort;
  readonly indexNowKey: string | undefined;
  readonly sitemapPingTargets: readonly string[];
  /** Événements déjà traités (idempotence) ; absent : pas de déduplication. */
  readonly processedEvents: KvLike | undefined;
  readonly maxSkewSeconds?: number;
  readonly maxPurgeUrls?: number;
}

function json(status: number, body: Readonly<Record<string, unknown>>, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export type StepStatus = 'DONE' | 'SKIPPED' | 'FAILED';

async function safely<T>(step: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await step();
  } catch {
    return fallback;
  }
}

export async function handleWikiEvent(request: Request, deps: WikiSyncDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
  if (deps.secret === undefined) return json(503, { error: 'NOT_CONFIGURED' });

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json(413, { error: 'BODY_TOO_LARGE' });

  const timestamp = request.headers.get(TIMESTAMP_HEADER) ?? '';
  const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
  const ts = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  const maxSkew = deps.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  const fresh = Number.isSafeInteger(ts) && Math.abs(deps.nowSeconds() - ts) <= maxSkew;
  const authentic = await verifyHmacHex(deps.secret, `${timestamp}.${raw}`, signature);
  if (!fresh || !authentic) return json(401, { error: 'UNAUTHORIZED' });

  const parsed = parseWikiEvent(raw);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error });
  const { event } = parsed;

  if (deps.processedEvents !== undefined) {
    const seen = await safely(() => deps.processedEvents?.get(`evt:${event.eventId}`) ?? Promise.resolve(null), null);
    if (seen !== null) return json(200, { ok: true, duplicate: true, eventId: event.eventId });
  }

  let freshnessUpdated = 0;
  let freshnessStatus: StepStatus = 'SKIPPED';
  const store = deps.freshness;
  if (store !== undefined) {
    freshnessStatus = await safely<StepStatus>(async () => {
      for (const page of event.pages) {
        await store.set(pageKeyOf(page.locale, page.slug), event.occurredAt);
        freshnessUpdated += 1;
      }
      return 'DONE';
    }, 'FAILED');
  }

  const allUrls = purgeUrlsFor(event.pages);
  const cap = deps.maxPurgeUrls ?? DEFAULT_MAX_PURGE_URLS;
  const urls = allUrls.slice(0, cap);
  let deleted = 0;
  let purgeStatus: StepStatus = 'SKIPPED';
  const cache = deps.cache;
  if (cache !== undefined) {
    purgeStatus = await safely<StepStatus>(async () => {
      for (const url of urls) if (await cache.delete(url)) deleted += 1;
      return 'DONE';
    }, 'FAILED');
  }

  const indexNow: NotifyStatus = await notifyIndexNow(deps.outbound, deps.indexNowKey, indexNowUrlsFor(event.pages));
  const sitemapPing: NotifyStatus = await pingSitemap(deps.outbound, deps.sitemapPingTargets);

  if (deps.processedEvents !== undefined) {
    await safely(() => deps.processedEvents?.put(`evt:${event.eventId}`, '1', { expirationTtl: EVENT_TTL_SECONDS }) ?? Promise.resolve(), undefined);
  }

  return json(200, {
    ok: true,
    eventId: event.eventId,
    kind: event.kind,
    scope: event.scope,
    pages: event.pages.length,
    freshness: { status: freshnessStatus, updated: freshnessUpdated },
    purge: { status: purgeStatus, requested: urls.length, deleted, truncated: allUrls.length > urls.length },
    indexNow,
    sitemapPing,
  });
}
