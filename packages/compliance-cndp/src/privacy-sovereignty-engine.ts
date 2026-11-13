/**
 * CTR-COD-09 « privacy-sovereignty-engine » (Doc_11 § 06 et § 11, ERRATA section C et D-19).
 *
 * 1. assertSovereignEgressAllowed : coupe-circuit réseau pur et déterministe. Mode STRICT_DGSSI_LAW_05_20_MOROCCO
 *    (Loi 05-20, zéro egress) : seul le Maroc est autorisé, pour tout flux. Mode STANDARD_CNDP_EU_ADEQUACY : un flux
 *    qui porte des données personnelles ou fiscales exige un pays adéquat (Délibération CNDP n° 236-2015, Art. 43)
 *    ou l'autorisation F118 (Art. 44, Loi 09-08). Tout le reste est refusé (deny-by-default).
 * 2. evaluateCndpErasureAgainstCgiArt211 : arbitre du droit de suppression (Art. 9, Loi 09-08) face à la
 *    conservation décennale de l'Art. 211 CGI (clôture + 10 ans + 1 jour). L'horloge est un paramètre ; la seule
 *    constante fiscale est la durée décennale fixée par la spec.
 *
 * Le drapeau `piiRestrictedFlag` reprend `pii_restricted_flag` de Doc_11 § 06 : il n'a pas de DDL dans Doc_06
 * (ERRATA D-19), S1B le définit. Ce module n'accède à aucune base.
 */

export const SOVEREIGNTY_POLICIES = ['STANDARD_CNDP_EU_ADEQUACY', 'STRICT_DGSSI_LAW_05_20_MOROCCO'] as const;
export type SovereigntyPolicy = (typeof SOVEREIGNTY_POLICIES)[number];

export interface OutboundServiceTarget {
  readonly serviceName: string;
  /** Code ISO 3166-1 alpha-2 en majuscules, ex. 'MA', 'FR', 'US'. */
  readonly destinationCountryIso2: string;
  readonly hasCndpF118Authorization: boolean;
  readonly carriesPersonalOrFiscalData: boolean;
}

/**
 * États adéquats en mode standard : les 27 États membres de l'Union européenne + le Maroc (Doc_11 § 03 :
 * « incluant tous les États membres de l'Union Européenne »). Codes ISO 3166-1 alpha-2 en majuscules (la Grèce
 * est « GR », pas « EL »). Tout autre code, inconnu ou mal formé, n'est pas adéquat (échec fermé : F118 requise).
 * NON RECOUPÉ avec le texte de la Délibération CNDP n° 236-2015.
 */
export const CNDP_ADEQUATE_ISO2: ReadonlySet<string> = new Set([
  'MA',
  // 27 États membres de l'UE
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

const SOVEREIGN_COUNTRY_ISO2 = 'MA';

export type SovereignEgressErrorCode = 'DGSSI_LAW_05_20_EGRESS_BLOCKED' | 'CNDP_ART_43_44_TRANSFER_BLOCKED' | 'SOVEREIGNTY_POLICY_UNKNOWN';

export class SovereignEgressError extends Error {
  readonly code: SovereignEgressErrorCode;

  constructor(code: SovereignEgressErrorCode, message: string) {
    super(message);
    this.name = 'SovereignEgressError';
    this.code = code;
  }
}

function isSovereigntyPolicy(value: string): value is SovereigntyPolicy {
  return SOVEREIGNTY_POLICIES.some((policy) => policy === value);
}

/** Coupe-circuit : lève SovereignEgressError si le flux n'est pas autorisé, retourne sinon. */
export function assertSovereignEgressAllowed(policy: SovereigntyPolicy, target: OutboundServiceTarget): void {
  const policyName: string = policy;
  if (!isSovereigntyPolicy(policyName)) {
    throw new SovereignEgressError('SOVEREIGNTY_POLICY_UNKNOWN', `SOVEREIGNTY_POLICY_UNKNOWN: Politique [${policyName}] inconnue, flux refusé.`);
  }
  if (policyName === 'STRICT_DGSSI_LAW_05_20_MOROCCO') {
    if (target.destinationCountryIso2 !== SOVEREIGN_COUNTRY_ISO2) {
      throw new SovereignEgressError(
        'DGSSI_LAW_05_20_EGRESS_BLOCKED',
        `DGSSI_LAW_05_20_EGRESS_BLOCKED: Flux vers [${target.serviceName}] (${target.destinationCountryIso2}) interdit en mode Souverain Maroc.`,
      );
    }
    return;
  }
  if (!target.carriesPersonalOrFiscalData) {
    return;
  }
  if (!CNDP_ADEQUATE_ISO2.has(target.destinationCountryIso2) && !target.hasCndpF118Authorization) {
    throw new SovereignEgressError(
      'CNDP_ART_43_44_TRANSFER_BLOCKED',
      `CNDP_ART_43_44_TRANSFER_BLOCKED: Transfert vers [${target.serviceName}] (${target.destinationCountryIso2}) interdit sans adéquation CNDP ou autorisation F118.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Arbitre DSAR : Art. 9 Loi 09-08 contre Art. 211 CGI
// ---------------------------------------------------------------------------

/** Durée de conservation fixée par Doc_11 § 06 (Art. 211 CGI) : 10 ans après la clôture de l'exercice. */
export const CGI_ART_211_RETENTION_YEARS = 10 as const;

export const SUBJECT_RECORD_CATEGORIES = [
  'MARKETING_OR_PREFERENCE',
  'UNNUMBERED_DRAFT',
  'POSTED_ACCOUNTING_OR_INVOICE',
  'SIMPL_PAYROLL_9421_OR_DRVT',
] as const;
export type SubjectRecordCategory = (typeof SUBJECT_RECORD_CATEGORIES)[number];

export interface SubjectRecordDescriptor {
  readonly recordId: string;
  readonly tableName: string;
  readonly category: SubjectRecordCategory;
  /** Clôture de l'exercice, YYYY-MM-DD. */
  readonly fiscalYearClosedDateIso?: string;
}

export type DsarErasureAction = 'IMMEDIATE_HARD_DELETE' | 'RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY';

export interface DsarErasureDecision {
  readonly recordId: string;
  readonly action: DsarErasureAction;
  readonly legalBasis: string;
  /** 1 = verrouillage de restriction fiscal (pii_restricted_flag), 0 sinon. */
  readonly piiRestrictedFlag: 0 | 1;
  /**
   * Dernier jour de conservation obligatoire (inclus) : le dixième anniversaire de la clôture. Absent si
   * l'enregistrement est effaçable, ou restreint sans date de clôture exploitable (échec fermé).
   */
  readonly retentionEndDateIso?: string;
  /** Premier jour où le crypto-shredding est autorisé (clôture + 10 ans + 1 jour) ; absent comme ci-dessus. */
  readonly scheduledCryptoShredDateIso?: string;
}

export class DsarInputError extends Error {
  constructor(message: string) {
    super(`DSAR_INPUT_INVALID: ${message}`);
    this.name = 'DsarInputError';
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date du calendrier grégorien en entiers, sans objet Date. */
interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Date YYYY-MM-DD réelle du calendrier (année 0001 à 9999) ; null sinon. */
function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function formatIsoDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * Dixième anniversaire (années entières) : même mois, même jour, année + 10. Si le jour n'existe pas dans l'année
 * cible (clôture le 29 février, année cible non bissextile), le jour est ramené au dernier jour du mois, soit le
 * 28 février. Règle déterministe, documentée : 10 ans ≡ 2 (mod 4), donc l'année cible d'une clôture au 29 février
 * n'est jamais bissextile et l'échéance est toujours le 28 février, puis le 1er mars pour la destruction.
 */
function addRetentionYears(date: CalendarDate, years: number): CalendarDate {
  const year = date.year + years;
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

function nextDay(date: CalendarDate): CalendarDate {
  if (date.day < daysInMonth(date.year, date.month)) {
    return { year: date.year, month: date.month, day: date.day + 1 };
  }
  if (date.month < 12) {
    return { year: date.year, month: date.month + 1, day: 1 };
  }
  return { year: date.year + 1, month: 1, day: 1 };
}

const MAX_SUPPORTED_YEAR = 9999;

function isSubjectRecordCategory(value: string): value is SubjectRecordCategory {
  return SUBJECT_RECORD_CATEGORIES.some((category) => category === value);
}

const LEGAL_BASIS_NO_RETENTION = 'Loi 09-08 Art. 9 — Aucune obligation fiscale de conservation applicable.';
const LEGAL_BASIS_EXPIRED = 'Expiration du délai décennal Art. 211 CGI — Destruction cryptographique autorisée.';
const LEGAL_BASIS_RETENTION =
  "Primauté légale Art. 211 & 145-I CGI (conservation probante 10 ans) — Restriction d'accès appliquée.";
const LEGAL_BASIS_FAIL_CLOSED =
  "Date de clôture d'exercice absente ou invalide — échéance Art. 211 CGI indéterminable : restriction maintenue, destruction refusée (échec fermé).";

/**
 * Décide du sort d'un enregistrement visé par une demande d'effacement (Doc_11 § 06 : « Clôture d'exercice + 10 ans
 * + 1 jour »). Dernier jour de conservation (inclus) = date de clôture + 10 ans ; destruction autorisée à partir
 * du lendemain (clôture + 10 ans + 1 jour). Calcul en entiers année/mois/jour. Clôture le 29 février : voir
 * `addRetentionYears` (28 février de l'année cible). Date de clôture absente ou invalide : restriction sans
 * échéance, jamais suppression. Horloge invalide ou catégorie inconnue : DsarInputError.
 */
export function evaluateCndpErasureAgainstCgiArt211(record: SubjectRecordDescriptor, nowDateIso: string): DsarErasureDecision {
  if (parseIsoDate(nowDateIso) === null) {
    throw new DsarInputError('nowDateIso doit être une date YYYY-MM-DD du calendrier.');
  }
  const category: string = record.category;
  if (!isSubjectRecordCategory(category)) {
    throw new DsarInputError(`catégorie [${category}] inconnue pour l'enregistrement ${record.recordId}.`);
  }
  if (category === 'MARKETING_OR_PREFERENCE' || category === 'UNNUMBERED_DRAFT') {
    return { recordId: record.recordId, action: 'IMMEDIATE_HARD_DELETE', legalBasis: LEGAL_BASIS_NO_RETENTION, piiRestrictedFlag: 0 };
  }
  const closed = record.fiscalYearClosedDateIso === undefined ? null : parseIsoDate(record.fiscalYearClosedDateIso);
  if (closed === null || closed.year + CGI_ART_211_RETENTION_YEARS > MAX_SUPPORTED_YEAR - 1) {
    return {
      recordId: record.recordId,
      action: 'RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY',
      legalBasis: LEGAL_BASIS_FAIL_CLOSED,
      piiRestrictedFlag: 1,
    };
  }
  const retentionEnd = addRetentionYears(closed, CGI_ART_211_RETENTION_YEARS);
  const retentionEndDateIso = formatIsoDate(retentionEnd);
  const scheduledCryptoShredDateIso = formatIsoDate(nextDay(retentionEnd));
  // Les chaînes YYYY-MM-DD à années de 4 chiffres se comparent dans l'ordre chronologique.
  if (nowDateIso >= scheduledCryptoShredDateIso) {
    return { recordId: record.recordId, action: 'IMMEDIATE_HARD_DELETE', legalBasis: LEGAL_BASIS_EXPIRED, piiRestrictedFlag: 0 };
  }
  return {
    recordId: record.recordId,
    action: 'RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY',
    legalBasis: LEGAL_BASIS_RETENTION,
    piiRestrictedFlag: 1,
    retentionEndDateIso,
    scheduledCryptoShredDateIso,
  };
}

export type DsarRequestOutcome = 'FULL_ERASURE' | 'PARTIAL_ERASURE' | 'FULL_RESTRICTION' | 'NOTHING_TO_PROCESS';

export interface DsarErasureRequestResult {
  readonly outcome: DsarRequestOutcome;
  readonly decisions: readonly DsarErasureDecision[];
  readonly erasableRecordIds: readonly string[];
  readonly restrictedRecordIds: readonly string[];
  /** Plus proche date de crypto-shredding parmi les enregistrements restreints, null s'il n'y en a aucun. */
  readonly nextCryptoShredDateIso: string | null;
}

/** Applique l'arbitre à tous les enregistrements d'une demande d'effacement, dans l'ordre reçu. */
export function evaluateCndpErasureRequest(records: readonly SubjectRecordDescriptor[], nowDateIso: string): DsarErasureRequestResult {
  const decisions = records.map((record) => evaluateCndpErasureAgainstCgiArt211(record, nowDateIso));
  const erasableRecordIds = decisions.filter((d) => d.action === 'IMMEDIATE_HARD_DELETE').map((d) => d.recordId);
  const restricted = decisions.filter((d) => d.action === 'RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY');
  const shredDates = restricted.flatMap((d) => (d.scheduledCryptoShredDateIso === undefined ? [] : [d.scheduledCryptoShredDateIso]));
  let outcome: DsarRequestOutcome = 'NOTHING_TO_PROCESS';
  if (decisions.length > 0) {
    outcome = restricted.length === 0 ? 'FULL_ERASURE' : erasableRecordIds.length === 0 ? 'FULL_RESTRICTION' : 'PARTIAL_ERASURE';
  }
  return {
    outcome,
    decisions,
    erasableRecordIds,
    restrictedRecordIds: restricted.map((d) => d.recordId),
    nextCryptoShredDateIso: shredDates.length === 0 ? null : (shredDates.slice().sort()[0] ?? null),
  };
}
