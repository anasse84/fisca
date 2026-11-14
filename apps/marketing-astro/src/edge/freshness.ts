import type { MarketingLocale } from '../i18n/locales.ts';
import type { KvLike } from './ports.ts';

/**
 * Fraîcheur des pages (Doc_18 S08) : `dateModified` du JSON-LD est une DONNÉE DE CONTENU injectée, jamais lue sur une horloge.
 * La date vient de l'événement signé (`occurredAt`) ; ce magasin la conserve par page.
 */
export interface FreshnessStore {
  get(pageKey: string): Promise<string | undefined>;
  set(pageKey: string, dateModifiedIso: string): Promise<void>;
}

export function pageKeyOf(locale: MarketingLocale, slug: string): string {
  return `${locale}|${slug.replace(/^\/+|\/+$/g, '')}`;
}

/** Date ISO 8601 complète en UTC (`2026-11-14T10:00:00Z` ou avec millisecondes). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function isIsoUtcDate(value: string): boolean {
  if (!ISO_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}

export class MemoryFreshnessStore implements FreshnessStore {
  private readonly dates = new Map<string, string>();

  get(pageKey: string): Promise<string | undefined> {
    return Promise.resolve(this.dates.get(pageKey));
  }

  set(pageKey: string, dateModifiedIso: string): Promise<void> {
    this.dates.set(pageKey, dateModifiedIso);
    return Promise.resolve();
  }
}

const FRESH_PREFIX = 'fresh:';

export class KvFreshnessStore implements FreshnessStore {
  constructor(private readonly kv: KvLike) {}

  async get(pageKey: string): Promise<string | undefined> {
    const value = await this.kv.get(`${FRESH_PREFIX}${pageKey}`);
    return value !== null && isIsoUtcDate(value) ? value : undefined;
  }

  async set(pageKey: string, dateModifiedIso: string): Promise<void> {
    await this.kv.put(`${FRESH_PREFIX}${pageKey}`, dateModifiedIso);
  }
}
