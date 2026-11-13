import type { UblInvoiceInput } from '../../src/index.ts';

/** ICE de test : 15 chiffres, divisibles par 97 (aucune donnée réelle). */
export const SUPPLIER_ICE = '000970000000097';
export const CUSTOMER_ICE = '001197530853397';
export const XHUB_UUID = '3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23';

export const TYPE_CODES = ['380', '381', '383', '386', '389'] as const;

const NUMBER_BY_TYPE: Record<(typeof TYPE_CODES)[number], string> = {
  '380': 'FAC-2026-000001',
  '381': 'AVO-2026-000001',
  '383': 'NDB-2026-000001',
  '386': 'ACO-2026-000001',
  '389': 'AUT-2026-000001',
};

/** Facture de test : 10 × 100,00 à 20 % + 2,5 × 40,00 à 10 % ; totaux déclarés cohérents. */
export function buildInput(typeCode: (typeof TYPE_CODES)[number] = '380'): UblInvoiceInput {
  return {
    typeCode,
    number: NUMBER_BY_TYPE[typeCode],
    issueDate: '2026-11-13',
    dueDate: '2026-12-13',
    currencyCode: 'MAD',
    ...(typeCode === '383' ? {} : { buyerReference: 'REF-ACHETEUR-TEST' }),
    ...(typeCode === '381'
      ? { billingReference: { originInvoiceNumber: 'FAC-2026-000001', xhubUuid: XHUB_UUID, issueDate: '2026-11-01' } }
      : {}),
    supplier: {
      name: 'Vendeur Test SARL AU',
      ice: SUPPLIER_ICE,
      identifiantFiscal: '12345678',
      legalForm: 'SARL AU',
      shareCapitalCents: 10000000,
      rc: '123456',
      taxeProfessionnelle: '98765432',
      cnss: '1234567',
      address: { street: '1 rue de Test', city: 'Rabat', postalZone: '10000', countryCode: 'MA' },
    },
    customer: {
      name: 'Acheteur Test SA',
      ice: CUSTOMER_ICE,
      address: { street: '2 avenue de Test', city: 'Casablanca', postalZone: '20000', countryCode: 'MA' },
    },
    lines: [
      { descriptionFr: 'Article de test', quantityMilli: 10000, unitPriceCents: 10000, vatRateBps: 2000 },
      { descriptionFr: 'Service de test', quantityMilli: 2500, unitPriceCents: 4000, vatRateBps: 1000 },
    ],
  };
}
// Calcul attendu : 1000,00 (20 %) → TVA 200,00 ; 100,00 (10 %) → TVA 10,00 ; HT 1100,00 ; TVA 210,00 ; TTC 1310,00.
export const EXPECTED_TOTALS = {
  lineExtensionCents: 110000,
  taxExclusiveCents: 110000,
  taxTotalCents: 21000,
  taxInclusiveCents: 131000,
  payableCents: 131000,
} as const;
