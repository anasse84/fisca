export type UblTypeCode = '380' | '381' | '383' | '386' | '389';
export type InvoiceNumberPrefix = 'FAC' | 'AVO' | 'NDB' | 'ACO' | 'AUT';

export const INVOICE_NUMBER_PREFIX_BY_TYPE: Readonly<Record<UblTypeCode, InvoiceNumberPrefix>> = {
  '380': 'FAC',
  '381': 'AVO',
  '383': 'NDB',
  '386': 'ACO',
  '389': 'AUT',
};

const TYPE_BY_PREFIX: Readonly<Record<InvoiceNumberPrefix, UblTypeCode>> = {
  FAC: '380',
  AVO: '381',
  NDB: '383',
  ACO: '386',
  AUT: '389',
};

const INVOICE_NUMBER_PATTERN = /^(FAC|AVO|NDB|ACO|AUT)-(\d{4})-(\d{6})$/;
const MAX_SEQUENCE = 999999;

export interface ParsedInvoiceNumber {
  readonly prefix: InvoiceNumberPrefix;
  readonly typeCode: UblTypeCode;
  readonly year: number;
  readonly sequence: number;
}

/** Décompose `{FAC|AVO|NDB|ACO|AUT}-{YYYY}-{SEQ6}` ; undefined si le format est invalide (séquence 000000 comprise). */
export function parseInvoiceNumber(value: string): ParsedInvoiceNumber | undefined {
  const match = INVOICE_NUMBER_PATTERN.exec(value);
  if (match === null) return undefined;
  const prefix = match[1] as InvoiceNumberPrefix;
  const sequence = Number(match[3]);
  if (sequence < 1) return undefined;
  return { prefix, typeCode: TYPE_BY_PREFIX[prefix], year: Number(match[2]), sequence };
}

export function isValidInvoiceNumber(value: string): boolean {
  return parseInvoiceNumber(value) !== undefined;
}

/** Construit un numéro ; l'attribution du compteur reste hors de ce paquet. */
export function formatInvoiceNumber(typeCode: UblTypeCode, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError('Année sur 4 chiffres attendue.');
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new RangeError('Compteur attendu entre 1 et 999999.');
  }
  return `${INVOICE_NUMBER_PREFIX_BY_TYPE[typeCode]}-${year}-${String(sequence).padStart(6, '0')}`;
}
