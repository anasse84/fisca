/**
 * Registre public des mentions Loi n° 09-08 (Doc_11 S01, S02, S03, S06 et S10).
 * Décisions du propriétaire du 2026-11-14 : les numéros de récépissé restent `null` (aucun numéro inventé) et la
 * mention « dossiers en cours d'enregistrement » les remplace à l'affichage ; les durées de conservation sont celles fixées
 * par le propriétaire (voir `CONTROLLER_PROCESSINGS`).
 */
import { PUBLISHER } from './identity.ts';

export type CndpFormId = 'F115' | 'F211' | 'F112' | 'F118';

export interface CndpReference {
  readonly form: CndpFormId;
  /** Numéro de récépissé ou d'autorisation attribué par la CNDP ; `null` tant que le propriétaire ne l'a pas saisi. */
  readonly number: string | null;
}

/** Aucun numéro attribué à ce jour : les dossiers sont en cours d'enregistrement (décision du propriétaire, 2026-11-14). */
export const CNDP_REFERENCES: readonly CndpReference[] = [
  { form: 'F115', number: null },
  { form: 'F211', number: null },
  { form: 'F112', number: null },
  { form: 'F118', number: null },
];

export function hasCndpNumber(reference: CndpReference): boolean {
  return reference.number !== null && reference.number.trim().length > 0;
}

export const DATA_CONTROLLER = {
  legalName: PUBLISHER.legalName,
  locality: PUBLISHER.locality,
  countryIso2: PUBLISHER.countryIso2,
  contactEmail: PUBLISHER.dpoEmail,
} as const;

/** Délai cible de réponse à une demande d'accès (Doc_11 S06, Art. 7 : moins de 15 jours). */
export const ACCESS_REQUEST_TARGET_DAYS = 15;

/** Conservation probante décennale (Doc_11 S06 : 10 ans après clôture de l'exercice, Art. 211 CGI). */
export const FISCAL_RECORD_RETENTION_YEARS = 10;

/**
 * Règles de conservation fixées par le propriétaire le 2026-11-14 (Doc_11 S02 ne chiffrait aucune durée).
 * T-01 : contrat actif + 12 mois après clôture ; journaux de sécurité 12 mois glissants ; défis OTP/MFA 10 minutes.
 * T-02 : contrat + 10 ans après la clôture du dernier exercice concerné (Art. 211 CGI, Loi 9-88).
 * T-03 : factures 10 ans après clôture ; jeton monétique Payzone purgé dès la résiliation soldée.
 * T-04 : cache actif 30 jours + archive restreinte d'audit et de contestation 12 mois.
 */
export type RetentionRule =
  | {
      readonly kind: 'CONTRACT_PLUS_MONTHS';
      readonly monthsAfterClosure: number;
      readonly securityLogsRollingMonths: number;
      readonly otpChallengeMinutes: number;
    }
  | { readonly kind: 'CONTRACT_PLUS_YEARS_AFTER_LAST_FISCAL_YEAR'; readonly years: number }
  | { readonly kind: 'INVOICES_YEARS_PLUS_TOKEN_PURGE'; readonly invoiceYears: number }
  | { readonly kind: 'CACHE_DAYS_PLUS_AUDIT_ARCHIVE'; readonly cacheDays: number; readonly auditArchiveMonths: number };

export type ProcessingId = 'T-01' | 'T-02' | 'T-03' | 'T-04';

export interface ProcessingEntry {
  readonly id: ProcessingId;
  readonly role: 'CONTROLLER';
  readonly dataCategories: readonly DataCategoryId[];
  /** Durée fixée par le propriétaire (2026-11-14). */
  readonly retention: RetentionRule;
}

export type DataCategoryId =
  | 'IDENTITY_CONTACT'
  | 'CONNECTION_LOGS'
  | 'MANAGER_ID_DOCUMENTS'
  | 'BILLING_CONTACT'
  | 'PAYMENT_TOKEN'
  | 'PUBLIC_REGISTER_DATA';

/** Traitements dont SYNAPTIC SYSTEMS SARL AU est responsable (Doc_11 S02, T-01 à T-04). */
export const CONTROLLER_PROCESSINGS: readonly ProcessingEntry[] = [
  {
    id: 'T-01',
    role: 'CONTROLLER',
    dataCategories: ['IDENTITY_CONTACT', 'CONNECTION_LOGS'],
    retention: { kind: 'CONTRACT_PLUS_MONTHS', monthsAfterClosure: 12, securityLogsRollingMonths: 12, otpChallengeMinutes: 10 },
  },
  {
    id: 'T-02',
    role: 'CONTROLLER',
    dataCategories: ['MANAGER_ID_DOCUMENTS'],
    retention: { kind: 'CONTRACT_PLUS_YEARS_AFTER_LAST_FISCAL_YEAR', years: FISCAL_RECORD_RETENTION_YEARS },
  },
  {
    id: 'T-03',
    role: 'CONTROLLER',
    dataCategories: ['BILLING_CONTACT', 'PAYMENT_TOKEN'],
    retention: { kind: 'INVOICES_YEARS_PLUS_TOKEN_PURGE', invoiceYears: FISCAL_RECORD_RETENTION_YEARS },
  },
  {
    id: 'T-04',
    role: 'CONTROLLER',
    dataCategories: ['PUBLIC_REGISTER_DATA'],
    retention: { kind: 'CACHE_DAYS_PLUS_AUDIT_ARCHIVE', cacheDays: 30, auditArchiveMonths: 12 },
  },
];

export type SubProcessorId = 'CLOUDFLARE' | 'AWS_SES' | 'INFOBIP' | 'PAYZONE' | 'BARID_ESIGN' | 'MIRROR_HOST';
export type HostingRegion = 'EU' | 'EU_MA' | 'MA';

export interface SubProcessor {
  readonly id: SubProcessorId;
  readonly name: string;
  readonly region: HostingRegion;
}

/** Doc_11 S03 : sous-traitants ultérieurs et localisation. */
export const SUB_PROCESSORS: readonly SubProcessor[] = [
  { id: 'CLOUDFLARE', name: 'Cloudflare (D1 et R2)', region: 'EU' },
  { id: 'AWS_SES', name: 'Amazon Web Services (SES)', region: 'EU' },
  { id: 'INFOBIP', name: 'Infobip', region: 'EU_MA' },
  { id: 'PAYZONE', name: 'Payzone', region: 'MA' },
  { id: 'BARID_ESIGN', name: 'Barid eSign (Al Barid)', region: 'MA' },
  { id: 'MIRROR_HOST', name: 'Hébergeur miroir', region: 'MA' },
];

/** Formes de dossier CNDP en cours d'enregistrement (décision du propriétaire, 2026-11-14). */
export const CNDP_FORMS_IN_REGISTRATION: readonly CndpFormId[] = ['F115', 'F211', 'F112', 'F118'];

/** Le site public ne dépose aucun cookie et ne charge aucune ressource tierce (Doc_11 S10, Doc_18 S09). */
export const SITE_TRACKING_POLICY = {
  cookies: 0,
  thirdPartyScripts: 0,
  thirdPartyPixels: 0,
} as const;
