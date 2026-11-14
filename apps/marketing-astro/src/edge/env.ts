import type { KvLike } from './ports.ts';

/**
 * Noms des liaisons (bindings) du Worker `fisca-marketing`. Aucun n'existe au registre des contrats (`fisca_contracts_registry`) :
 * ils sont choisis ici, marqués PROVISIONAL, et sont À CRÉER EN P4 (provisionnement Cloudflare). Aucune valeur de secret
 * ni identifiant de ressource n'est dans le dépôt : `wrangler.jsonc` ne déclare volontairement aucun `kv_namespaces`
 * (il exigerait un identifiant de ressource qui n'existe pas encore).
 */
export const BINDING_NAMES = {
  /** Espace KV du marketing : compteurs de télémétrie (`tel:`), fraîcheur des pages (`fresh:`), événements Wiki déjà traités (`evt:`). */
  kv: 'MARKETING_EDGE_KV',
  /** Secret HMAC de l'événement « règle AST activée / page Wiki publiée ». */
  wikiWebhookSecret: 'MARKETING_WIKI_WEBHOOK_SECRET',
  /** Clé IndexNow (8 à 128 caractères a-z A-Z 0-9 -) ; le fichier `/<clé>.txt` en est servi. */
  indexNowKey: 'MARKETING_INDEXNOW_KEY',
  /** Secret HMAC du lien signé vers app.fisca.ma. */
  handoffSecret: 'MARKETING_HANDOFF_SECRET',
  /** Variable (non secrète, optionnelle) : durée de vie du lien signé, en secondes. */
  handoffTtlSeconds: 'MARKETING_HANDOFF_TTL_SECONDS',
  /** Variable (non secrète, optionnelle) : modèles d'URL de ping de sitemap, séparés par des virgules, `{sitemap}` remplacé. */
  sitemapPingTargets: 'MARKETING_SITEMAP_PING_URLS',
} as const;

export type EdgeEnv = Readonly<Record<string, unknown>>;

export function readString(env: EdgeEnv | undefined, name: string): string | undefined {
  const value = env?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readKv(env: EdgeEnv | undefined, name: string = BINDING_NAMES.kv): KvLike | undefined {
  const value = env?.[name];
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as { get?: unknown; put?: unknown };
  return typeof candidate.get === 'function' && typeof candidate.put === 'function' ? (value as KvLike) : undefined;
}

/** Entier strictement positif lu dans une variable ; `undefined` si absente ou invalide. */
export function readPositiveInt(env: EdgeEnv | undefined, name: string): number | undefined {
  const raw = readString(env, name);
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n > 0 ? n : undefined;
}
