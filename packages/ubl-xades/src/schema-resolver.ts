import { UblSchemaError } from './errors.ts';

export type UblDocumentKind = 'invoice' | 'credit-note' | 'debit-note';
export type UblSchemaVersion = '2.1';

/** Nom affiché de l'ensemble de schémas utilisé. */
export const SCHEMA_DISPLAY_NAME = 'OASIS UBL 2.1 officiel' as const;

export interface ResolvedSchema {
  readonly kind: UblDocumentKind;
  readonly version: UblSchemaVersion;
  /** Chemin absolu du XSD principal (les modules `xsd/common/` sont résolus par import relatif). */
  readonly path: string;
  readonly name: typeof SCHEMA_DISPLAY_NAME;
  /** Vrai : XSD publié par OASIS, vendorisé sans modification (voir xsd/SOURCE.md). */
  readonly official: true;
  readonly source: 'https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip';
}

const MAIN_DOCUMENTS: Readonly<Record<UblDocumentKind, string>> = {
  invoice: 'UBL-Invoice-2.1.xsd',
  'credit-note': 'UBL-CreditNote-2.1.xsd',
  'debit-note': 'UBL-DebitNote-2.1.xsd',
};

function isKind(value: string): value is UblDocumentKind {
  return Object.hasOwn(MAIN_DOCUMENTS, value);
}

/**
 * Schéma à utiliser pour un code de type UBL : `invoice` pour 380, 383, 386 et 389 (le 383 est émis en racine Invoice,
 * décision du pilote), `credit-note` pour 381. Le kind `debit-note` reste résoluble mais le générateur ne l'utilise plus.
 */
export function schemaKindOfTypeCode(typeCode: '380' | '381' | '383' | '386' | '389'): UblDocumentKind {
  return typeCode === '381' ? 'credit-note' : 'invoice';
}

/**
 * Point unique de résolution du schéma : renvoie le XSD OFFICIEL OASIS UBL 2.1 vendorisé dans `xsd/`.
 * Aucun XSD marocain n'existe (ERRATA B-13) ; le profil provisoire vit dans `profiles/cius-ma-provisional/`.
 */
export function resolveSchema(kind: UblDocumentKind, version: UblSchemaVersion): ResolvedSchema {
  if (version !== '2.1') {
    throw new UblSchemaError('UBL_SCHEMA_VERSION_UNSUPPORTED', 'Seule la version OASIS UBL 2.1 est vendorisée.');
  }
  if (!isKind(kind)) {
    throw new UblSchemaError('UBL_SCHEMA_KIND_UNKNOWN', 'Type de document attendu : invoice, credit-note ou debit-note.');
  }
  const file = MAIN_DOCUMENTS[kind];
  return {
    kind,
    version,
    path: decodeURIComponent(new URL(`../xsd/maindoc/${file}`, import.meta.url).pathname),
    name: SCHEMA_DISPLAY_NAME,
    official: true,
    source: 'https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip',
  };
}
