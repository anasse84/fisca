/**
 * IndexNow (https://www.indexnow.org/documentation) : POST JSON `{ host, key, keyLocation, urlList }`, 10 000 URL au plus par envoi.
 * La clé n'est jamais dans le dépôt : elle vient d'un secret, et `/<clé>.txt` est servi depuis cette même liaison.
 */
import { SITE_ORIGIN } from '../i18n/hreflang.ts';
import type { OutboundPort } from './ports.ts';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_MAX_URLS = 10000;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export function isValidIndexNowKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function indexNowKeyLocation(key: string): string {
  return `${SITE_ORIGIN}/${key}.txt`;
}

export interface IndexNowPayload {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: readonly string[];
}

export function buildIndexNowPayloads(key: string, urls: readonly string[]): readonly IndexNowPayload[] {
  if (!isValidIndexNowKey(key)) throw new RangeError('INDEXNOW_INVALID_KEY');
  const host = new URL(SITE_ORIGIN).host;
  const unique = [...new Set(urls)].filter((u) => u.startsWith(`${SITE_ORIGIN}/`));
  const payloads: IndexNowPayload[] = [];
  for (let i = 0; i < unique.length; i += INDEXNOW_MAX_URLS) {
    payloads.push({ host, key, keyLocation: indexNowKeyLocation(key), urlList: unique.slice(i, i + INDEXNOW_MAX_URLS) });
  }
  return payloads;
}

export type NotifyStatus = 'SUBMITTED' | 'SKIPPED_NO_KEY' | 'SKIPPED_NO_URL' | 'SKIPPED_NO_TARGET' | 'FAILED';

/** `200` et `202` sont des succès (https://www.indexnow.org/documentation, « Response format »). */
export async function notifyIndexNow(outbound: OutboundPort, key: string | undefined, urls: readonly string[]): Promise<NotifyStatus> {
  if (key === undefined || !isValidIndexNowKey(key)) return 'SKIPPED_NO_KEY';
  if (urls.length === 0) return 'SKIPPED_NO_URL';
  try {
    for (const payload of buildIndexNowPayloads(key, urls)) {
      const { status } = await outbound.send({
        method: 'POST',
        url: INDEXNOW_ENDPOINT,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      });
      if (status !== 200 && status !== 202) return 'FAILED';
    }
    return 'SUBMITTED';
  } catch {
    return 'FAILED';
  }
}

export const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;

/**
 * Ping de sitemap sur des cibles configurées (`{sitemap}` remplacé par l'URL encodée). Aucune cible par défaut : le point
 * d'accès de ping de Google est supprimé (https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping, réponse 404) ;
 * le sitemap reste déclaré dans robots.txt et IndexNow notifie les moteurs compatibles.
 */
export async function pingSitemap(outbound: OutboundPort, targets: readonly string[]): Promise<NotifyStatus> {
  if (targets.length === 0) return 'SKIPPED_NO_TARGET';
  const encoded = encodeURIComponent(SITEMAP_URL);
  let failed = false;
  for (const template of targets) {
    if (!template.startsWith('https://') || !template.includes('{sitemap}')) {
      failed = true;
      continue;
    }
    try {
      const { status } = await outbound.send({ method: 'GET', url: template.replace('{sitemap}', encoded) });
      if (status < 200 || status >= 300) failed = true;
    } catch {
      failed = true;
    }
  }
  return failed ? 'FAILED' : 'SUBMITTED';
}

export function parsePingTargets(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Pilote réel du réseau sortant : jamais utilisé par les tests. */
export const fetchOutbound: OutboundPort = {
  async send(request) {
    const init: RequestInit = { method: request.method, redirect: 'manual' };
    if (request.headers !== undefined) init.headers = { ...request.headers };
    if (request.body !== undefined) init.body = request.body;
    const response = await fetch(request.url, init);
    return { status: response.status };
  },
};
