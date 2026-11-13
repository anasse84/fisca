/**
 * Registre public des mentions Loi n° 09-08 (Doc_11 S01, S02, S03, S06 et S10).
 * Aucune valeur inventée : tout numéro ou toute durée que Doc_11 ne fournit pas vaut `null`
 * et s'affiche « à renseigner par le propriétaire » tant que le propriétaire ne l'a pas saisi ici.
 */
import { PUBLISHER } from './identity.ts';

export type CndpFormId = 'F115' | 'F211' | 'F112' | 'F118';

export interface CndpReference {
  readonly form: CndpFormId;
  /** Numéro de récépissé ou d'autorisation attribué par la CNDP ; `null` tant que le propriétaire ne l'a pas saisi. */
  readonly number: string | null;
}

/** Doc_11 S04 ne donne aucun numéro : toutes les références restent à renseigner par le propriétaire. */
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

export type RetentionRule =
  | { readonly kind: 'FISCAL_DECENNIAL'; readonly years: number }
  | { readonly kind: 'TO_BE_SET_BY_OWNER' };

export type ProcessingId = 'T-01' | 'T-02' | 'T-03' | 'T-04';

export interface ProcessingEntry {
  readonly id: ProcessingId;
  readonly role: 'CONTROLLER';
  readonly dataCategories: readonly DataCategoryId[];
  /** Doc_11 S02 ne chiffre aucune durée par traitement : `TO_BE_SET_BY_OWNER` tant que le propriétaire ne l'a pas fixée. */
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
  { id: 'T-01', role: 'CONTROLLER', dataCategories: ['IDENTITY_CONTACT', 'CONNECTION_LOGS'], retention: { kind: 'TO_BE_SET_BY_OWNER' } },
  { id: 'T-02', role: 'CONTROLLER', dataCategories: ['MANAGER_ID_DOCUMENTS'], retention: { kind: 'TO_BE_SET_BY_OWNER' } },
  { id: 'T-03', role: 'CONTROLLER', dataCategories: ['BILLING_CONTACT', 'PAYMENT_TOKEN'], retention: { kind: 'TO_BE_SET_BY_OWNER' } },
  { id: 'T-04', role: 'CONTROLLER', dataCategories: ['PUBLIC_REGISTER_DATA'], retention: { kind: 'TO_BE_SET_BY_OWNER' } },
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

/** Le site public ne dépose aucun cookie et ne charge aucune ressource tierce (Doc_11 S10, Doc_18 S09). */
export const SITE_TRACKING_POLICY = {
  cookies: 0,
  thirdPartyScripts: 0,
  thirdPartyPixels: 0,
} as const;
