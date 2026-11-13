import { E2eeError } from './e2ee-errors.ts';

/**
 * Anonymiseur PII réversible en RAM (Doc_10 § 07, § 11 ; CTR-COD-08 ; ERRATA D-12).
 *
 * La table de correspondance vit uniquement dans cette instance, le temps d'une requête : aucune écriture
 * disque, aucun journal, aucun stockage. `destroy()` met à zéro les octets conservés puis vide la table.
 * Limite assumée : une chaîne JavaScript est immuable et ne peut pas être mise à zéro ; les valeurs
 * conservées dans la table le sont en `Uint8Array` (zéroïsées), mais les copies transitoires du moteur JS
 * (texte d'entrée, sortie réhydratée) restent à la charge du ramasse-miettes.
 */

/** Contexte du dossier : valeurs personnelles déclarées (ERRATA D-12 : CIN, IF et CNSS viennent du contexte). */
export interface PiiScrubContext {
  readonly names?: readonly string[];
  readonly addresses?: readonly string[];
  /** Identifiants fiscaux (IF) du dossier. */
  readonly taxIdentifiers?: readonly string[];
  readonly cnssNumbers?: readonly string[];
  /** CIN déclarés (le motif générique `[A-Z]{1,2}\d{5,7}` s'applique en plus). */
  readonly nationalIds?: readonly string[];
}

type PiiKind =
  | 'ENTITY'
  | 'ADDRESS'
  | 'IF'
  | 'CNSS'
  | 'CIN'
  | 'IBAN_MA'
  | 'EMAIL'
  | 'RIB24'
  | 'ICE15'
  | 'NUM_LONG'
  | 'PHONE_MA';

interface Detection {
  readonly start: number;
  readonly end: number;
  readonly kind: PiiKind;
  readonly priority: number;
}

interface TableEntry {
  readonly token: string;
  readonly kind: PiiKind;
  readonly canonical: Uint8Array;
  readonly original: Uint8Array;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const NONCE_BYTES = 4;
const MIN_NAME_LENGTH = 3;
const MIN_ID_LENGTH = 4;

/** Code points invisibles ou de contrôle retirés avant toute détection (tags, bidi, zéro-largeur, C0/C1). */
function isInvisible(cp: number): boolean {
  return (
    (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xad ||
    cp === 0x34f ||
    cp === 0x180e ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    (cp >= 0xfe00 && cp <= 0xfe0e) ||
    cp === 0xfeff ||
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  );
}

function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !isInvisible(cp)) out += ch;
  }
  return out;
}

function normalizeInput(text: string): string {
  return stripInvisible(stripInvisible(text).normalize('NFKC'));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function isDigitString(value: string): boolean {
  return /^\d+$/.test(value);
}

function canonicalPhone(value: string): string {
  const noOptionalZero = value.replace(/\(0\)/g, '');
  const digits = digitsOnly(noOptionalZero);
  if (digits.startsWith('00212')) return `0${digits.slice(5)}`;
  if (noOptionalZero.trim().startsWith('+') && digits.startsWith('212')) return `0${digits.slice(3)}`;
  return digits;
}

function canonicalOf(kind: PiiKind, value: string): string {
  switch (kind) {
    case 'ENTITY':
    case 'ADDRESS':
    case 'EMAIL':
      return value.replace(/\s+/g, ' ').trim().toLowerCase();
    case 'IBAN_MA':
      return value.replace(/[\s.-]/g, '').toUpperCase();
    case 'PHONE_MA':
      return canonicalPhone(value);
    case 'CIN':
      return value.replace(/\s+/g, '').toUpperCase();
    default:
      return digitsOnly(value);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Motifs génériques, par priorité décroissante en cas d'égalité (indice le plus petit gagne). */
const GENERIC_PATTERNS: readonly { readonly kind: PiiKind; readonly pattern: RegExp }[] = [
  { kind: 'IBAN_MA', pattern: /(?<![\p{L}\p{N}])MA\d{2}(?:[ .-]?\d){24}(?!\d)/giu },
  { kind: 'EMAIL', pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  { kind: 'PHONE_MA', pattern: /(?<![\d+])(?:(?:\+|00)212[ .-]?(?:\(0\)[ .-]?)?[5-7]|0[5-7])(?:[ .-]?\d){8}(?!\d)/gu },
  { kind: 'RIB24', pattern: /(?<!\d)\d(?:[ .-]?\d){23}(?!\d)/gu },
  { kind: 'ICE15', pattern: /(?<!\d)\d{15}(?!\d)/gu },
  { kind: 'NUM_LONG', pattern: /(?<!\d)\d{16,}(?!\d)/gu },
  { kind: 'CIN', pattern: /(?<![\p{L}\p{N}])[A-Z]{1,2}\d{5,7}(?![\p{L}\p{N}])/gu },
];

function declaredPattern(kind: PiiKind, rawValue: string): RegExp | null {
  const value = rawValue.normalize('NFKC').trim();
  const stripped = stripInvisible(value);
  if (stripped.length === 0) return null;
  if (kind === 'ENTITY' || kind === 'ADDRESS') {
    if (stripped.length < MIN_NAME_LENGTH) return null;
    const body = stripped.split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(body, 'giu');
  }
  if (stripped.length < MIN_ID_LENGTH) return null;
  if (isDigitString(digitsOnly(stripped)) && digitsOnly(stripped).length === stripped.replace(/[\s.-]/g, '').length) {
    const digits = digitsOnly(stripped).split('');
    return new RegExp(`(?<!\\d)${digits.join('[ .-]?')}(?!\\d)`, 'gu');
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${stripped.split(/\s+/).map(escapeRegExp).join('\\s*')}(?![\\p{L}\\p{N}])`, 'giu');
}

function collect(text: string, kind: PiiKind, pattern: RegExp, priority: number, into: Detection[]): void {
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start !== undefined && match[0].length > 0) {
      into.push({ start, end: start + match[0].length, kind, priority });
    }
  }
}

/**
 * Anonymiseur à cycle de vie explicite : `scrubText` -> appel IA -> `rehydrateText` -> `destroy`.
 * Les jetons ont la forme `[KIND_NN_xxxxxxxx]` : `xxxxxxxx` est un aléa tiré par instance (donc par requête),
 * ce qui empêche un document tiers de forger un jeton pour obtenir une valeur réelle à la réhydratation.
 */
export class EphemeralRamPiiScrubber {
  private readonly entries: TableEntry[] = [];
  private readonly tokenToEntry = new Map<string, TableEntry>();
  private readonly counters = new Map<PiiKind, number>();
  private readonly nonce = randomNonceHex();
  private destroyed = false;

  /** Exécute `work` avec un anonymiseur neuf et le détruit toujours, même en cas d'erreur. */
  public static async withRequest<T>(work: (scrubber: EphemeralRamPiiScrubber) => Promise<T>): Promise<T> {
    const scrubber = new EphemeralRamPiiScrubber();
    try {
      return await work(scrubber);
    } finally {
      scrubber.destroy();
    }
  }

  public get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Nombre de valeurs distinctes actuellement tenues en RAM (0 après destruction). */
  public get tokenCount(): number {
    return this.entries.length;
  }

  public scrubText(rawInput: string, knownNames: readonly string[] = [], context: PiiScrubContext = {}): string {
    this.assertAlive();
    const text = normalizeInput(rawInput);
    const found: Detection[] = [];
    let priority = 0;
    const declared: readonly (readonly [PiiKind, readonly string[]])[] = [
      ['ENTITY', [...knownNames, ...(context.names ?? [])]],
      ['ADDRESS', context.addresses ?? []],
      ['IF', context.taxIdentifiers ?? []],
      ['CNSS', context.cnssNumbers ?? []],
      ['CIN', context.nationalIds ?? []],
    ];
    for (const [kind, values] of declared) {
      for (const value of values) {
        const pattern = declaredPattern(kind, value);
        if (pattern !== null) collect(text, kind, pattern, priority, found);
      }
      priority += 1;
    }
    for (const { kind, pattern } of GENERIC_PATTERNS) {
      collect(text, kind, pattern, priority, found);
      priority += 1;
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end || a.priority - b.priority);

    let out = '';
    let cursor = 0;
    for (const hit of found) {
      if (hit.start < cursor) continue;
      out += text.slice(cursor, hit.start);
      out += this.getOrCreateToken(hit.kind, text.slice(hit.start, hit.end));
      cursor = hit.end;
    }
    return out + text.slice(cursor);
  }

  public rehydrateText(aiOutput: string): string {
    this.assertAlive();
    const tokenPattern = new RegExp(`\\[[A-Z0-9_]+_\\d{2,}_${this.nonce}\\]`, 'g');
    return aiOutput.replace(tokenPattern, (token) => {
      const entry = this.tokenToEntry.get(token);
      return entry === undefined ? token : DECODER.decode(entry.original);
    });
  }

  /** Zéroïse les octets conservés, vide la table et interdit tout usage ultérieur. Idempotent. */
  public destroy(): void {
    for (const entry of this.entries) {
      entry.canonical.fill(0);
      entry.original.fill(0);
    }
    this.entries.length = 0;
    this.tokenToEntry.clear();
    this.counters.clear();
    this.destroyed = true;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new E2eeError('SCRUBBER_DESTROYED');
  }

  private getOrCreateToken(kind: PiiKind, realValue: string): string {
    const canonical = ENCODER.encode(canonicalOf(kind, realValue));
    for (const entry of this.entries) {
      if (entry.kind === kind && bytesEqual(entry.canonical, canonical)) {
        canonical.fill(0);
        return entry.token;
      }
    }
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    const token = `[${kind}_${String(next).padStart(2, '0')}_${this.nonce}]`;
    const entry: TableEntry = { token, kind, canonical, original: ENCODER.encode(realValue) };
    this.entries.push(entry);
    this.tokenToEntry.set(token, entry);
    return token;
  }
}
