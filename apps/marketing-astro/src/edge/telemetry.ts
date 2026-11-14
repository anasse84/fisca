/**
 * Télémétrie interne sans cookie ni donnée personnelle (Doc_18 S09, Doc_11 S10, loi 09-08).
 *
 * Ce qui est enregistré : un compteur par jour UTC et par (page_slug, locale, tool_id, referring_class). Rien d'autre :
 * ni adresse IP, ni User-Agent, ni URL de provenance, ni paramètre de requête, ni identifiant individuel, ni cookie.
 * La provenance n'est lue que pour être rangée dans l'une des 4 classes, puis jetée.
 */
import { findEditorialPageByPath } from '../content/pages.ts';
import { TOOL_DEFINITIONS } from '../tools/registry.ts';
import { TOOLS_HUB_SLUG } from '../tools/copy/common.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import type { KvLike, NowSeconds } from './ports.ts';

export type ReferringClass = 'generative_ai' | 'organic_search' | 'direct' | 'other';

export interface TelemetryKey {
  readonly day: string;
  readonly page_slug: string;
  readonly locale: MarketingLocale;
  readonly tool_id: string;
  readonly referring_class: ReferringClass;
}

export interface TelemetryRecord extends TelemetryKey {
  readonly count: number;
}

export interface TelemetryStore {
  increment(key: TelemetryKey): Promise<void>;
}

/** Moteurs génératifs (Doc_18 S09). Comparaison sur le nom d'hôte, sous-domaines compris, jamais sur l'URL entière. */
export const GENERATIVE_ENGINE_HOSTS: readonly string[] = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'claude.ai', 'copilot.microsoft.com'];

const ORGANIC_HOST = /(^|\.)(google\.[a-z.]{2,6}|bing\.com)$/;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function classifyHost(host: string, ownHost: string): ReferringClass {
  if (GENERATIVE_ENGINE_HOSTS.some((d) => hostMatches(host, d))) return 'generative_ai';
  if (hostMatches(host, ownHost)) return 'direct';
  if (ORGANIC_HOST.test(host)) return 'organic_search';
  return 'other';
}

/**
 * Rang de provenance. Priorité à l'en-tête `Referer` (nom d'hôte seulement). À défaut, `utm_source` : ChatGPT l'ajoute aux liens
 * qu'il cite, et la valeur n'est lue que pour la classer. Une navigation interne compte comme `direct` (aucune source externe).
 */
export function classifyProvenance(referer: string | null, requestUrl: URL, ownHost: string = requestUrl.hostname): ReferringClass {
  if (referer !== null && referer.trim() !== '') {
    const host = hostnameOf(referer);
    if (host !== null) return classifyHost(host, ownHost.toLowerCase());
    return 'other';
  }
  const utm = requestUrl.searchParams.get('utm_source');
  if (utm !== null && utm.trim() !== '') {
    const host = utm.includes('.') ? utm.trim().toLowerCase() : `${utm.trim().toLowerCase()}.invalid`;
    return classifyHost(host, ownHost.toLowerCase());
  }
  return 'direct';
}

const BOT_UA =
  /bot|crawl|spider|slurp|archiver|fetch|monitor|preview|lighthouse|headless|phantom|playwright|puppeteer|curl\/|wget|python-|go-http|okhttp|axios|node-fetch|java\/|libwww|httpclient|scrapy|facebookexternalhit|embedly|chatgpt-user|oai-searchbot|perplexity|claude-|anthropic|gptbot|applebot|bytespider|ccbot|dataprovider/i;

/** Un User-Agent absent ou reconnu comme robot n'est pas compté. Il n'est ni conservé ni journalisé. */
export function isBotUserAgent(userAgent: string | null): boolean {
  if (userAgent === null || userAgent.trim() === '') return true;
  return BOT_UA.test(userAgent);
}

const TECHNICAL_PREFIXES: readonly string[] = ['/api/', '/_astro/', '/.well-known/', '/fonts/', '/_image'];
const TECHNICAL_FILE = /\.(txt|xml|json|md|css|js|mjs|map|ico|svg|png|jpe?g|webp|avif|gif|woff2?|ttf|pdf|csv|xlsx)$/i;

/** Chemins techniques : jamais comptés. */
export function isTechnicalPath(pathname: string): boolean {
  return TECHNICAL_PREFIXES.some((p) => pathname.startsWith(p)) || TECHNICAL_FILE.test(pathname);
}

function toolIdOf(slug: string): string {
  if (!slug.startsWith(`${TOOLS_HUB_SLUG}/`)) return '';
  return TOOL_DEFINITIONS.find((d) => d.slug === slug)?.id ?? '';
}

export function dayOfSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Clé du compteur pour une requête, ou `null` si elle ne doit pas être comptée : méthode autre que GET, chemin technique,
 * robot, réponse autre que 200 HTML, ou page absente du registre (la cardinalité reste bornée aux pages publiées).
 */
export function telemetryKeyFor(request: Request, response: Response, nowSeconds: number): TelemetryKey | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (isTechnicalPath(url.pathname)) return null;
  if (isBotUserAgent(request.headers.get('user-agent'))) return null;
  if (response.status !== 200) return null;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) return null;
  const page = findEditorialPageByPath(url.pathname);
  if (page === undefined) return null;
  return {
    day: dayOfSeconds(nowSeconds),
    page_slug: page.slug === '' ? 'index' : page.slug,
    locale: page.locale,
    tool_id: toolIdOf(page.slug),
    referring_class: classifyProvenance(request.headers.get('referer'), url),
  };
}

function storageKey(key: TelemetryKey): string {
  return `tel:${key.day}|${key.page_slug}|${key.locale}|${key.tool_id}|${key.referring_class}`;
}

/** Pilote mémoire (tests et développement local sans KV). */
export class MemoryTelemetryStore implements TelemetryStore {
  private readonly counters = new Map<string, TelemetryRecord>();

  increment(key: TelemetryKey): Promise<void> {
    const id = storageKey(key);
    const current = this.counters.get(id);
    this.counters.set(id, { ...key, count: (current?.count ?? 0) + 1 });
    return Promise.resolve();
  }

  records(): readonly TelemetryRecord[] {
    return [...this.counters.values()];
  }
}

/**
 * Pilote KV. Lecture puis écriture : KV n'a pas d'incrément atomique, deux requêtes simultanées sur la même clé peuvent
 * n'en compter qu'une. Ces compteurs sont donc des ordres de grandeur d'audience, pas une comptabilité ; un Durable Object
 * donnerait l'atomicité (choix à valider en P4).
 */
export class KvTelemetryStore implements TelemetryStore {
  constructor(private readonly kv: KvLike) {}

  async increment(key: TelemetryKey): Promise<void> {
    const id = storageKey(key);
    const raw = await this.kv.get(id);
    const current = raw !== null && /^\d{1,12}$/.test(raw) ? Number(raw) : 0;
    await this.kv.put(id, String(current + 1));
  }
}

/** Ne lève jamais et ne bloque jamais la réponse : appelé dans `waitUntil`. */
export async function recordPageView(request: Request, response: Response, store: TelemetryStore, now: NowSeconds): Promise<void> {
  try {
    const key = telemetryKeyFor(request, response, now());
    if (key !== null) await store.increment(key);
  } catch {
    // Une panne de la télémétrie ne doit jamais affecter le visiteur.
  }
}
