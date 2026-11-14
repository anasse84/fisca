import { ARABIC_FORMS, CP858_UPPER, CP864_UPPER, LAM_ALEF } from './codepage-tables.ts';

/**
 * Encodage du texte vers les octets d'une imprimante thermique.
 * - CP858 : français, anglais, tamazight latin (accents et euro).
 * - CP864 : arabe ; l'imprimante ne fait aucune mise en forme : formes de présentation (isolée, finale, initiale, médiane)
 *   et ordre visuel (gauche → droite) sont produits ici ; les accents latins absents de la page sont ramenés à la lettre de base.
 * - UTF8 : imprimantes qui l'acceptent.
 * Le tifinagh n'existe dans aucune page de code d'imprimante thermique : caractère non encodable.
 */

export type TextEncoding = 'CP858' | 'CP864' | 'UTF8';

export interface EncodeOptions {
  /** `throw` : erreur typée ; `replace` : « ? » (0x3F). Défaut : `replace` (un ticket ne doit pas échouer sur un nom d'article). */
  readonly unencodable?: 'throw' | 'replace';
}

export class UnencodableTextError extends Error {
  readonly char: string;
  readonly encoding: TextEncoding;
  constructor(char: string, encoding: TextEncoding) {
    super(`Caractère « ${char} » (U+${char.codePointAt(0)?.toString(16).toUpperCase() ?? '?'}) non encodable en ${encoding}.`);
    this.name = 'UnencodableTextError';
    this.char = char;
    this.encoding = encoding;
  }
}

const reverseTable = (upper: string): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  [...upper].forEach((ch, i) => {
    if (ch !== '\uFFFD' && !map.has(ch)) map.set(ch, 0x80 + i);
  });
  return map;
};
const CP858_REVERSE = reverseTable(CP858_UPPER);
const CP864_REVERSE = reverseTable(CP864_UPPER);

const ARABIC_LETTER = /[\u0621-\u064A]/u;
const isArabicLetter = (ch: string | undefined): boolean => ch !== undefined && ARABIC_LETTER.test(ch);
const isArabicChar = (ch: string): boolean => /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(ch);
/** Lettres qui ne se lient pas à la lettre suivante (aucune forme initiale ni médiane). */
const joinsNext = (ch: string | undefined): boolean => {
  if (ch === undefined) return false;
  const forms = ARABIC_FORMS[ch];
  return forms !== undefined && forms[2] !== '';
};
const isMark = (ch: string | undefined): boolean => ch !== undefined && /[\u064B-\u065F\u0640]/u.test(ch);

function shapeRun(run: string): string {
  const chars = [...run].filter((c) => !/[\u064B-\u065F]/u.test(c));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const forms = ARABIC_FORMS[ch];
    if (forms === undefined) {
      out.push(ch);
      continue;
    }
    const joinsPrev = isArabicLetter(prev) && joinsNext(prev);
    if (ch === '\u0644' && next !== undefined) {
      const lig = LAM_ALEF[next];
      if (lig !== undefined) {
        out.push(joinsPrev ? lig[1] : lig[0]);
        i += 1;
        continue;
      }
    }
    const canJoinNext = joinsNext(ch) && isArabicLetter(next) && !isMark(next);
    const [isolated, final, initial, medial] = forms;
    let glyph: string;
    if (joinsPrev && canJoinNext) glyph = medial;
    else if (joinsPrev) glyph = final;
    else if (canJoinNext) glyph = initial;
    else glyph = isolated;
    out.push(glyph === '' ? isolated : glyph);
  }
  return out.join('');
}

/**
 * Prépare une ligne pour une imprimante qui imprime de gauche à droite sans mise en forme :
 * lettres arabes en formes de présentation, séries arabes inversées, ordre des séries inversé quand la ligne est arabe.
 * Le latin et les chiffres gardent leur ordre interne.
 */
export function shapeArabicForPrinter(text: string): string {
  if (![...text].some(isArabicChar)) return text;
  const runs: { readonly arabic: boolean; readonly text: string }[] = [];
  for (const ch of text) {
    const arabic = isArabicChar(ch);
    const last = runs[runs.length - 1];
    if (last !== undefined && (last.arabic === arabic || (/\s/u.test(ch) && last.arabic) )) {
      runs[runs.length - 1] = { arabic: last.arabic, text: last.text + ch };
    } else if (last !== undefined && !arabic && last.arabic === false) {
      runs[runs.length - 1] = { arabic: false, text: last.text + ch };
    } else {
      runs.push({ arabic, text: ch });
    }
  }
  const visual = runs.map((run) => (run.arabic ? [...shapeRun(run.text)].reverse().join('') : run.text));
  return visual.reverse().join('');
}

function singleByte(ch: string, reverse: ReadonlyMap<string, number>): number | undefined {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return code;
  return reverse.get(ch);
}

const stripDiacritics = (ch: string): string => ch.normalize('NFD').replace(/\p{M}/gu, '');

function encodeSingleByte(text: string, encoding: 'CP858' | 'CP864', options: EncodeOptions): Uint8Array {
  const reverse = encoding === 'CP858' ? CP858_REVERSE : CP864_REVERSE;
  const bytes: number[] = [];
  const strict = options.unencodable === 'throw';
  const input = encoding === 'CP864' ? shapeArabicForPrinter(text) : text;
  for (const ch of input) {
    let byte = singleByte(ch, reverse);
    if (byte === undefined && encoding === 'CP864' && !isArabicChar(ch)) {
      const base = stripDiacritics(ch);
      if (base !== ch && base.length === 1) byte = singleByte(base, reverse);
    }
    if (byte === undefined && isArabicChar(ch) && encoding === 'CP864') {
      const forms = ARABIC_FORMS[ch];
      byte = [forms?.[0], forms?.[1], forms?.[2], forms?.[3]].reduce<number | undefined>((found, f) => found ?? (f ? reverse.get(f) : undefined), undefined);
    }
    if (byte === undefined) {
      if (strict) throw new UnencodableTextError(ch, encoding);
      byte = 0x3f;
    }
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

export function encodeText(text: string, encoding: TextEncoding, options: EncodeOptions = {}): Uint8Array {
  if (encoding === 'UTF8') return new TextEncoder().encode(text);
  return encodeSingleByte(text, encoding, options);
}
