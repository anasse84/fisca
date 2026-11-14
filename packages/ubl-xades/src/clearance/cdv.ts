/**
 * Parseur strict du CDV (Compte-rendu De Validation) = message UBL 2.1 ApplicationResponse (Doc_02 § 02 ; Doc_17 § 07).
 *
 * Réutilise `parseXml` de la signature (DOCTYPE, entités et dépassement de limites refusés). Échec fermé : tout document hors
 * structure attendue ou toute valeur `cbc:ResponseCode` hors table de correspondance est refusé, jamais deviné.
 *
 * Les codes de réponse xHub sont ABSENTS (ERRATA B-13). `PROVISIONAL_CDV_RESPONSE_CODE_PROFILE` est une HYPOTHÈSE de profil
 * provisoire, remplaçable (paramètre `profile`) : elle emprunte les codes UNCL4343 courants des réponses de facture
 * (AB, IP, UQ, CA, RE, AP, PD) comme convention de travail, sans prétendre qu'ils soient ceux de xHub ou de la DGI.
 * Les messages d'erreur sont constants : jamais de contenu du document (donnée personnelle possible).
 */
import { UblSignatureError } from '../signature/errors.ts';
import { childElements, parseXml, textContent, type XmlElement } from '../signature/xml-parser.ts';
import type { CdvStatus } from './fsm.ts';

export const NS_UBL_APPLICATION_RESPONSE = 'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2';
export const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
export const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

export const CDV_MAX_XML_CHARS = 262_144;

export type CdvParseErrorCode =
  | 'CDV_XML_TOO_LARGE'
  | 'CDV_XML_MALFORMED'
  | 'CDV_XML_DOCTYPE_FORBIDDEN'
  | 'CDV_NOT_APPLICATION_RESPONSE'
  | 'CDV_STRUCTURE_INVALID'
  | 'CDV_RESPONSE_CODE_UNKNOWN';

const MESSAGES: Readonly<Record<CdvParseErrorCode, string>> = {
  CDV_XML_TOO_LARGE: 'Message CDV trop volumineux.',
  CDV_XML_MALFORMED: 'Message CDV mal formé.',
  CDV_XML_DOCTYPE_FORBIDDEN: 'Message CDV refusé : DOCTYPE ou entité interdits.',
  CDV_NOT_APPLICATION_RESPONSE: "Le document n'est pas un UBL 2.1 ApplicationResponse.",
  CDV_STRUCTURE_INVALID: 'Structure CDV invalide (champ obligatoire absent, dupliqué ou vide).',
  CDV_RESPONSE_CODE_UNKNOWN: 'Code de réponse CDV inconnu du profil : échec fermé.',
};

export class CdvParseError extends Error {
  readonly code: CdvParseErrorCode;

  constructor(code: CdvParseErrorCode) {
    super(`${code}: ${MESSAGES[code]}`);
    this.name = 'CdvParseError';
    this.code = code;
  }
}

/** Table de correspondance ResponseCode → statut CDV (profil provisoire, hypothèse remplaçable). DEPOSEE n'a pas de code : il vient de la clearance. */
export type CdvResponseCodeProfile = Readonly<Record<string, Exclude<CdvStatus, 'DEPOSEE_CERTIFIEE_DGI'>>>;

export const PROVISIONAL_CDV_RESPONSE_CODE_PROFILE: CdvResponseCodeProfile = {
  AB: 'MISE_A_DISPOSITION',
  IP: 'PRISE_EN_CHARGE',
  AP: 'APPROUVEE',
  CA: 'APPROUVEE_PARTIELLEMENT',
  UQ: 'EN_LITIGE_SUSPENDUE',
  RE: 'REFUSEE',
  PD: 'ENCAISSEE',
};

export interface CdvApplicationResponse {
  /** `cbc:ID` du message : sert de clé d'idempotence (rejeu). */
  readonly responseId: string;
  readonly issueDate: string;
  /** `cbc:ResponseCode` brut. */
  readonly responseCode: string;
  readonly status: Exclude<CdvStatus, 'DEPOSEE_CERTIFIEE_DGI'>;
  /** `cac:DocumentReference/cbc:ID` : numéro de la facture visée. */
  readonly invoiceReference: string;
}

function children(parent: XmlElement, ns: string, local: string): XmlElement[] {
  return childElements(parent).filter((child) => child.ns === ns && child.local === local);
}

function single(parent: XmlElement, ns: string, local: string): XmlElement {
  const found = children(parent, ns, local);
  const first = found[0];
  if (found.length !== 1 || first === undefined) throw new CdvParseError('CDV_STRUCTURE_INVALID');
  return first;
}

function singleText(parent: XmlElement, ns: string, local: string, pattern: RegExp): string {
  const value = textContent(single(parent, ns, local)).trim();
  if (value.length === 0 || !pattern.test(value)) throw new CdvParseError('CDV_STRUCTURE_INVALID');
  return value;
}

const ID_PATTERN = /^[\x21-\x7E]{1,128}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^[A-Z0-9_]{1,16}$/;

/** Analyse un message ApplicationResponse et en déduit le statut CDV. */
export function parseCdvApplicationResponse(xml: string, profile: CdvResponseCodeProfile = PROVISIONAL_CDV_RESPONSE_CODE_PROFILE): CdvApplicationResponse {
  if (xml.length > CDV_MAX_XML_CHARS) throw new CdvParseError('CDV_XML_TOO_LARGE');
  let root: XmlElement;
  try {
    root = parseXml(xml).root;
  } catch (error) {
    if (error instanceof UblSignatureError && (error.code === 'XML_DOCTYPE_FORBIDDEN' || error.code === 'XML_ENTITY_FORBIDDEN')) {
      throw new CdvParseError('CDV_XML_DOCTYPE_FORBIDDEN');
    }
    throw new CdvParseError('CDV_XML_MALFORMED');
  }
  if (root.ns !== NS_UBL_APPLICATION_RESPONSE || root.local !== 'ApplicationResponse') {
    throw new CdvParseError('CDV_NOT_APPLICATION_RESPONSE');
  }
  const responseId = singleText(root, NS_CBC, 'ID', ID_PATTERN);
  const issueDate = singleText(root, NS_CBC, 'IssueDate', DATE_PATTERN);
  const documentResponse = single(root, NS_CAC, 'DocumentResponse');
  const response = single(documentResponse, NS_CAC, 'Response');
  const responseCode = singleText(response, NS_CBC, 'ResponseCode', CODE_PATTERN);
  const reference = single(documentResponse, NS_CAC, 'DocumentReference');
  const invoiceReference = singleText(reference, NS_CBC, 'ID', ID_PATTERN);
  const status = Object.hasOwn(profile, responseCode) ? profile[responseCode] : undefined;
  if (status === undefined) throw new CdvParseError('CDV_RESPONSE_CODE_UNKNOWN');
  return { responseId, issueDate, responseCode, status, invoiceReference };
}

/** Chemin absolu du XSD OASIS UBL 2.1 ApplicationResponse vendorisé (xsd/SOURCE.md) ; sert à la validation des fixtures par xmllint. */
export function applicationResponseSchemaPath(): string {
  return decodeURIComponent(new URL('../../xsd/maindoc/UBL-ApplicationResponse-2.1.xsd', import.meta.url).pathname);
}
