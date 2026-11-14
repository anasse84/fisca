/** Logique de recherche floue de la palette Cmd+K : pure, sans React, entièrement locale (Doc_08 Section 05). */

export interface PaletteCommand {
  /** Identifiant stable. */
  readonly id: string;
  readonly label: string;
  /** Titre de section ; absent : la commande est rendue hors section. */
  readonly group?: string;
  /** Termes de recherche supplémentaires (ICE, synonymes). */
  readonly keywords?: readonly string[];
  /** Raccourci affiché tel quel, par exemple « G L ». */
  readonly shortcut?: string;
}

export interface PreparedCommand {
  readonly command: PaletteCommand;
  readonly order: number;
  readonly label: string;
  readonly keywords: string;
}

export interface SearchHit {
  readonly command: PaletteCommand;
  /** Score entier ; plus grand = meilleur. */
  readonly score: number;
  readonly order: number;
}

export interface HitGroup {
  /** Titre de section, chaîne vide pour les commandes sans groupe. */
  readonly group: string;
  readonly hits: readonly SearchHit[];
}

export const DEFAULT_RESULT_LIMIT = 50;

const SCORE_PREFIX = 1000;
const SCORE_WORD_PREFIX = 800;
const SCORE_SUBSTRING = 600;
const SCORE_SUBSEQUENCE = 300;
const KEYWORD_DIVISOR = 2;
const NO_MATCH = -1;

/** Diacritiques latins (NFD) et signes arabes : tashkil, tatwil, petit alef. */
const MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g;

export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function prepareCommands(commands: readonly PaletteCommand[]): readonly PreparedCommand[] {
  return commands.map((command, order) => ({
    command,
    order,
    label: normalizeSearchText(command.label),
    keywords: normalizeSearchText((command.keywords ?? []).join(' ')),
  }));
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === ' ' || text[index - 1] === '-' || text[index - 1] === '/';
}

/** Score d'un mot dans un texte normalisé, ou NO_MATCH. */
function scoreToken(token: string, text: string): number {
  if (text === '') {
    return NO_MATCH;
  }
  const at = text.indexOf(token);
  if (at === 0) {
    return SCORE_PREFIX;
  }
  if (at > 0) {
    let from = at;
    while (from !== -1) {
      if (isWordStart(text, from)) {
        return SCORE_WORD_PREFIX - Math.min(from, 100);
      }
      from = text.indexOf(token, from + 1);
    }
    return SCORE_SUBSTRING - Math.min(at, 100);
  }
  // Sous-séquence : les caractères du mot apparaissent dans l'ordre ; on pénalise l'étalement.
  let cursor = 0;
  let first = -1;
  for (const char of token) {
    const found = text.indexOf(char, cursor);
    if (found === -1) {
      return NO_MATCH;
    }
    if (first === -1) {
      first = found;
    }
    cursor = found + 1;
  }
  const spread = cursor - first - token.length;
  return SCORE_SUBSEQUENCE - Math.min(spread, 200) - Math.min(first, 50);
}

function scoreCommand(tokens: readonly string[], item: PreparedCommand): number {
  let total = 0;
  for (const token of tokens) {
    const inLabel = scoreToken(token, item.label);
    const inKeywords = scoreToken(token, item.keywords);
    const best = Math.max(inLabel, inKeywords === NO_MATCH ? NO_MATCH : Math.trunc(inKeywords / KEYWORD_DIVISOR));
    if (best === NO_MATCH) {
      return NO_MATCH;
    }
    total += best;
  }
  return total;
}

/**
 * Recherche floue : chaque mot de la requête doit correspondre (libellé ou mots-clés), insensible aux accents
 * et à la casse. Requête vide : les premières commandes dans l'ordre fourni. Tri : score décroissant, puis
 * libellé le plus court, puis ordre d'origine (stable).
 */
export function searchCommands(index: readonly PreparedCommand[], query: string, limit = DEFAULT_RESULT_LIMIT): readonly SearchHit[] {
  const normalized = normalizeSearchText(query);
  if (normalized === '') {
    return index.slice(0, limit).map((item) => ({ command: item.command, score: 0, order: item.order }));
  }
  const tokens = normalized.split(' ');
  const hits: { hit: SearchHit; length: number }[] = [];
  for (const item of index) {
    const score = scoreCommand(tokens, item);
    if (score !== NO_MATCH) {
      hits.push({ hit: { command: item.command, score, order: item.order }, length: item.label.length });
    }
  }
  hits.sort((a, b) => b.hit.score - a.hit.score || a.length - b.length || a.hit.order - b.hit.order);
  return hits.slice(0, limit).map((entry) => entry.hit);
}

/** Regroupe les résultats par section ; la section du meilleur résultat vient en premier, l'ordre interne est conservé. */
export function groupHits(hits: readonly SearchHit[]): readonly HitGroup[] {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const key = hit.command.group ?? '';
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [hit]);
    } else {
      bucket.push(hit);
    }
  }
  return [...groups.entries()].map(([group, groupHits]) => ({ group, hits: groupHits }));
}
