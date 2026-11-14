/**
 * Contrôle de structure local d'une facture UBL 2.1 (profil provisoire `cius-ma-provisional`, ERRATA B-13).
 *
 * Ce n'est PAS une validation de schéma : aucun XSD OASIS ni Schematron EN 16931 n'est exécuté ici, et les schémas officiels
 * marocains ne sont pas publiés (ERRATA B-13, au 2026-11-13). Seuls sont contrôlés :
 *  - la forme XML (lecteur strict, DOCTYPE rejeté) ;
 *  - la racine Invoice ou CreditNote de l'espace de noms UBL 2.1 ;
 *  - les éléments NOMMÉS par les spécifications (Doc_07 S07) : type de facture dans {380, 381, 383, 386, 389},
 *    BillingReference pour 381, ICE sous PartyLegalEntity/CompanyID (schemeID MA:ICE), IF sous PartyTaxScheme/CompanyID
 *    (schemeID MA:IF) ;
 *  - les éléments de base UBL 2.1 (norme OASIS UBL 2.1, hors profil marocain) : ID, IssueDate, AccountingSupplierParty,
 *    AccountingCustomerParty, LegalMonetaryTotal et au moins une ligne (InvoiceLine ou CreditNoteLine).
 * Rien d'autre n'est déclaré obligatoire.
 */
import { childrenNamed, descendantsNamed, parseXml } from './xml-lite.ts';
import type { XmlElement } from './xml-lite.ts';

export const UBL_PROFILE_ID = 'cius-ma-provisional';
export const UBL_PROFILE_STATE = 'PROVISOIRE';
export const UBL_PROFILE_AS_OF = '2026-11-13';

export const UBL_NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

/** Codes de type de document supportés (Doc_07 S07). */
export const UBL_TYPE_CODES: readonly string[] = ['380', '381', '383', '386', '389'];
export const UBL_CREDIT_NOTE_TYPE_CODE = '381';
export const UBL_ICE_SCHEME = 'MA:ICE';
export const UBL_IF_SCHEME = 'MA:IF';

/** Origine d'un contrôle : spécifications du dépôt (profil marocain provisoire), norme OASIS UBL 2.1, ou forme XML. */
export type UblBasis = 'XML' | 'OASIS_UBL21' | 'DOC07_S07';

export type UblCheckId =
  | 'WELL_FORMED'
  | 'NO_DOCTYPE'
  | 'ROOT'
  | 'BASE_ID'
  | 'BASE_ISSUE_DATE'
  | 'BASE_SUPPLIER'
  | 'BASE_CUSTOMER'
  | 'BASE_MONETARY_TOTAL'
  | 'BASE_LINE'
  | 'TYPE_CODE'
  | 'BILLING_REFERENCE'
  | 'ICE_SUPPLIER'
  | 'IF_SUPPLIER'
  | 'ICE_CUSTOMER'
  | 'IF_CUSTOMER';

/** Détail d'un échec ; `PASS` = contrôle réussi, `NOT_APPLICABLE` = contrôle sans objet (ex. BillingReference hors 381). */
export type UblDetail =
  | 'PASS'
  | 'NOT_APPLICABLE'
  | 'EMPTY_DOCUMENT'
  | 'DOCTYPE_REJECTED'
  | 'NOT_WELL_FORMED'
  | 'ROOT_UNEXPECTED'
  | 'ELEMENT_MISSING'
  | 'TYPE_CODE_MISSING'
  | 'TYPE_CODE_NOT_SUPPORTED'
  | 'SCHEME_ID_MISSING'
  | 'SCHEME_ID_WRONG'
  | 'ICE_FORMAT';

export type UblSeverity = 'error' | 'warning';

export interface UblCheckItem {
  readonly id: UblCheckId;
  readonly basis: UblBasis;
  readonly ok: boolean;
  readonly detail: UblDetail;
  /** Gravité d'un échec : une erreur rend le résultat négatif, un avertissement non. */
  readonly severity: UblSeverity;
  /** Valeur lue qui motive l'échec (code de type trouvé, schemeID trouvé, nom de la racine). */
  readonly found?: string;
}

export interface UblCheckResult {
  readonly profileId: string;
  readonly profileState: string;
  /** Vrai si aucune erreur ; les avertissements ne comptent pas. Ne signifie JAMAIS « valide » au sens d'un schéma. */
  readonly ok: boolean;
  readonly rootName: string | null;
  readonly typeCode: string | null;
  readonly checks: readonly UblCheckItem[];
}

export interface UblCheckOptions {
  /**
   * Second avis de forme fourni par l'appelant (le navigateur passe DOMParser). Vrai = bien formé.
   * Le lecteur interne reste la référence testée ; ce rappel ne peut que durcir le verdict.
   */
  readonly domWellFormed?: (xml: string) => boolean;
}

function item(id: UblCheckId, basis: UblBasis, detail: UblDetail, severity: UblSeverity = 'error', found?: string): UblCheckItem {
  return { id, basis, ok: detail === 'PASS' || detail === 'NOT_APPLICABLE', detail, severity, ...(found === undefined ? {} : { found }) };
}

function summarize(checks: readonly UblCheckItem[], rootName: string | null, typeCode: string | null): UblCheckResult {
  return {
    profileId: UBL_PROFILE_ID,
    profileState: UBL_PROFILE_STATE,
    ok: checks.every((c) => c.ok || c.severity === 'warning'),
    rootName,
    typeCode,
    checks,
  };
}

function hasDirect(root: XmlElement, ns: string, local: string): boolean {
  return childrenNamed(root, ns, local).length > 0;
}

function baseCheck(id: UblCheckId, root: XmlElement, ns: string, local: string): UblCheckItem {
  return item(id, 'OASIS_UBL21', hasDirect(root, ns, local) ? 'PASS' : 'ELEMENT_MISSING');
}

function companyIds(party: XmlElement, container: 'PartyLegalEntity' | 'PartyTaxScheme'): readonly XmlElement[] {
  return descendantsNamed(party, UBL_NS.cac, container).flatMap((c) => childrenNamed(c, UBL_NS.cbc, 'CompanyID'));
}

function schemeCheck(id: UblCheckId, party: XmlElement | undefined, container: 'PartyLegalEntity' | 'PartyTaxScheme', scheme: string, severity: UblSeverity): UblCheckItem {
  if (party === undefined) return item(id, 'DOC07_S07', 'ELEMENT_MISSING', severity);
  const ids = companyIds(party, container);
  if (ids.length === 0) return item(id, 'DOC07_S07', 'ELEMENT_MISSING', severity);
  const match = ids.find((e) => e.attributes['schemeID'] === scheme);
  if (match === undefined) {
    const withScheme = ids.find((e) => e.attributes['schemeID'] !== undefined);
    return withScheme === undefined ? item(id, 'DOC07_S07', 'SCHEME_ID_MISSING', severity) : item(id, 'DOC07_S07', 'SCHEME_ID_WRONG', severity, withScheme.attributes['schemeID']);
  }
  if (scheme === UBL_ICE_SCHEME && !/^\d{15}$/.test(match.text.trim())) return item(id, 'DOC07_S07', 'ICE_FORMAT', severity);
  return item(id, 'DOC07_S07', 'PASS', severity);
}

/** Contrôle de structure local d'un document UBL collé ou chargé (XML uniquement : Factur-X et PDF ne sont pas lus). */
export function checkUblXml(xml: string, options: UblCheckOptions = {}): UblCheckResult {
  const parsed = parseXml(xml);
  if (!parsed.ok) {
    const detail: UblDetail = parsed.error === 'EMPTY' ? 'EMPTY_DOCUMENT' : parsed.error === 'DOCTYPE' ? 'DOCTYPE_REJECTED' : 'NOT_WELL_FORMED';
    const checks =
      parsed.error === 'DOCTYPE'
        ? [item('WELL_FORMED', 'XML', 'PASS'), item('NO_DOCTYPE', 'XML', detail)]
        : [item('WELL_FORMED', 'XML', detail)];
    return summarize(checks, null, null);
  }
  if (options.domWellFormed !== undefined && !options.domWellFormed(xml)) {
    return summarize([item('WELL_FORMED', 'XML', 'NOT_WELL_FORMED')], null, null);
  }
  const root = parsed.root;
  const checks: UblCheckItem[] = [item('WELL_FORMED', 'XML', 'PASS'), item('NO_DOCTYPE', 'XML', 'PASS')];
  const isInvoice = root.local === 'Invoice' && root.namespace === UBL_NS.invoice;
  const isCreditNote = root.local === 'CreditNote' && root.namespace === UBL_NS.creditNote;
  if (!isInvoice && !isCreditNote) {
    checks.push(item('ROOT', 'OASIS_UBL21', 'ROOT_UNEXPECTED', 'error', root.local));
    return summarize(checks, root.local, null);
  }
  checks.push(item('ROOT', 'OASIS_UBL21', 'PASS'));

  checks.push(baseCheck('BASE_ID', root, UBL_NS.cbc, 'ID'));
  checks.push(baseCheck('BASE_ISSUE_DATE', root, UBL_NS.cbc, 'IssueDate'));
  checks.push(baseCheck('BASE_SUPPLIER', root, UBL_NS.cac, 'AccountingSupplierParty'));
  checks.push(baseCheck('BASE_CUSTOMER', root, UBL_NS.cac, 'AccountingCustomerParty'));
  checks.push(baseCheck('BASE_MONETARY_TOTAL', root, UBL_NS.cac, 'LegalMonetaryTotal'));
  checks.push(baseCheck('BASE_LINE', root, UBL_NS.cac, isInvoice ? 'InvoiceLine' : 'CreditNoteLine'));

  const typeElement = childrenNamed(root, UBL_NS.cbc, isInvoice ? 'InvoiceTypeCode' : 'CreditNoteTypeCode')[0];
  const typeCode = typeElement === undefined ? null : typeElement.text.trim();
  if (typeCode === null) checks.push(item('TYPE_CODE', 'DOC07_S07', 'TYPE_CODE_MISSING'));
  else if (!UBL_TYPE_CODES.includes(typeCode)) checks.push(item('TYPE_CODE', 'DOC07_S07', 'TYPE_CODE_NOT_SUPPORTED', 'error', typeCode));
  else checks.push(item('TYPE_CODE', 'DOC07_S07', 'PASS'));

  if (typeCode === UBL_CREDIT_NOTE_TYPE_CODE) checks.push(item('BILLING_REFERENCE', 'DOC07_S07', hasDirect(root, UBL_NS.cac, 'BillingReference') ? 'PASS' : 'ELEMENT_MISSING'));
  else checks.push(item('BILLING_REFERENCE', 'DOC07_S07', 'NOT_APPLICABLE'));

  const supplier = childrenNamed(root, UBL_NS.cac, 'AccountingSupplierParty')[0];
  const customer = childrenNamed(root, UBL_NS.cac, 'AccountingCustomerParty')[0];
  checks.push(schemeCheck('ICE_SUPPLIER', supplier, 'PartyLegalEntity', UBL_ICE_SCHEME, 'error'));
  checks.push(schemeCheck('IF_SUPPLIER', supplier, 'PartyTaxScheme', UBL_IF_SCHEME, 'error'));
  // Côté acheteur : les spécifications ne disent pas que l'ICE ou l'IF sont obligatoires (acheteur particulier possible) : avertissement.
  checks.push(schemeCheck('ICE_CUSTOMER', customer, 'PartyLegalEntity', UBL_ICE_SCHEME, 'warning'));
  checks.push(schemeCheck('IF_CUSTOMER', customer, 'PartyTaxScheme', UBL_IF_SCHEME, 'warning'));
  return summarize(checks, root.local, typeCode);
}
