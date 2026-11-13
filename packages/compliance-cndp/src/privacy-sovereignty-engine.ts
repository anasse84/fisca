/**
 * CTR-COD-09 « privacy-sovereignty-engine » (Doc_11 § 06 et § 11, ERRATA section C et D-19).
 *
 * 1. assertSovereignEgressAllowed : coupe-circuit réseau pur et déterministe. Mode STRICT_DGSSI_LAW_05_20_MOROCCO
 *    (Loi 05-20, zéro egress) : seul le Maroc est autorisé, pour tout flux. Mode STANDARD_CNDP_EU_ADEQUACY : un flux
 *    qui porte des données personnelles ou fiscales exige un pays adéquat (Délibération CNDP n° 236-2015, Art. 43)
 *    ou l'autorisation F118 (Art. 44, Loi 09-08). Tout le reste est refusé (deny-by-default).
 * 2. evaluateCndpErasureAgainstCgiArt211 : arbitre du droit de suppression (Art. 9, Loi 09-08) face à la
 *    conservation décennale de l'Art. 211 CGI. L'horloge est un paramètre ; la seule constante fiscale est la durée
 *    décennale fixée par la spec.
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

/** Liste de Doc_11 § 11 (Délibération CNDP n° 236-2015) + Maroc. */
export const CNDP_ADEQUATE_ISO2: ReadonlySet<string> = new Set([
  'MA',
  'FR',
  'DE',
  'IE',
  'NL',
  'BE',
  'ES',
  'IT',
  'LU',
  'PT',
  'AT',
  'SE',
  'FI',
  'DK',
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
  /** Dernier jour de conservation obligatoire (inclus), présent seulement si l'enregistrement est restreint. */
  readonly retentionEndDateIso?: string;
  /** Premier jour où le crypto-shredding est autorisé, présent seulement si l'enregistrement est restreint. */
  readonly scheduledCryptoShredDateIso?: string;
}

export class DsarInputError extends Error {
  constructor(message: string) {
    super(`DSAR_INPUT_INVALID: ${message}`);
    this.name = 'DsarInputError';
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Année d'une date YYYY-MM-DD réelle du calendrier ; DsarInputError sinon. */
function yearOfIsoDate(label: string, value: string): number {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new DsarInputError(`${label} doit être une date YYYY-MM-DD.`);
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new DsarInputError(`${label} n'est pas une date du calendrier.`);
  }
  return year;
}

function isSubjectRecordCategory(value: string): value is SubjectRecordCategory {
  return SUBJECT_RECORD_CATEGORIES.some((category) => category === value);
}

function yearIso(year: number, monthDay: string): string {
  return `${String(year).padStart(4, '0')}-${monthDay}`;
}

const LEGAL_BASIS_NO_RETENTION = 'Loi 09-08 Art. 9 — Aucune obligation fiscale de conservation applicable.';
const LEGAL_BASIS_EXPIRED = 'Expiration du délai décennal Art. 211 CGI — Destruction cryptographique autorisée.';
const LEGAL_BASIS_RETENTION =
  "Primauté légale Art. 211 & 145-I CGI (conservation probante 10 ans) — Restriction d'accès appliquée.";

/**
 * Décide du sort d'un enregistrement visé par une demande d'effacement. Fin de conservation : 31 décembre de
 * l'année de clôture + 10 ans (inclus) ; crypto-shredding autorisé le 1er janvier suivant (Doc_11 § 11). Sans date
 * de clôture, l'année de `nowDateIso` sert de base. Une date invalide ou une catégorie inconnue lève DsarInputError :
 * jamais d'effacement par défaut.
 */
export function evaluateCndpErasureAgainstCgiArt211(record: SubjectRecordDescriptor, nowDateIso: string): DsarErasureDecision {
  const nowYear = yearOfIsoDate('nowDateIso', nowDateIso);
  const category: string = record.category;
  if (!isSubjectRecordCategory(category)) {
    throw new DsarInputError(`catégorie [${category}] inconnue pour l'enregistrement ${record.recordId}.`);
  }
  if (category === 'MARKETING_OR_PREFERENCE' || category === 'UNNUMBERED_DRAFT') {
    return { recordId: record.recordId, action: 'IMMEDIATE_HARD_DELETE', legalBasis: LEGAL_BASIS_NO_RETENTION, piiRestrictedFlag: 0 };
  }
  const baseYear =
    record.fiscalYearClosedDateIso === undefined ? nowYear : yearOfIsoDate('fiscalYearClosedDateIso', record.fiscalYearClosedDateIso);
  const retentionEndDateIso = yearIso(baseYear + CGI_ART_211_RETENTION_YEARS, '12-31');
  if (nowDateIso > retentionEndDateIso) {
    return { recordId: record.recordId, action: 'IMMEDIATE_HARD_DELETE', legalBasis: LEGAL_BASIS_EXPIRED, piiRestrictedFlag: 0 };
  }
  return {
    recordId: record.recordId,
    action: 'RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY',
    legalBasis: LEGAL_BASIS_RETENTION,
    piiRestrictedFlag: 1,
    retentionEndDateIso,
    scheduledCryptoShredDateIso: yearIso(baseYear + CGI_ART_211_RETENTION_YEARS + 1, '01-01'),
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
