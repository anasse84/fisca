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
    buyerReference: 'REF-ACHETEUR-TEST',
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

/** Date de règle de test (résolue par l'appelant via fiscal-ast en production). */
export const RULE_DATE = '2026-11-13';

/** Retenue de garantie : taux et ensemble admis fournis par l'appelant. */
export function retentionRule(rateBps: number, basis: 'LINE_EXTENSION' | 'TAX_INCLUSIVE' = 'LINE_EXTENSION') {
  return {
    rateBps,
    allowedRatesBps: [700, 1000],
    basis,
    ruleDate: RULE_DATE,
    legalReference: 'Règle de test résolue par l’appelant',
  };
}

/** Droit de timbre : taux et ensemble admis fournis par l'appelant. */
export function stampDutyRule(cashSettledCents: number, rateBps = 25) {
  return {
    cashSettledCents,
    rateBps,
    allowedRatesBps: [25],
    ruleDate: RULE_DATE,
    legalReference: 'Règle de test résolue par l’appelant',
  };
}

/** Empreinte précédente de test (SHA-256 hexadécimal minuscule). */
export const PREVIOUS_HASH_HEX = '0ec5abda99c2661c14b933a1133263083d83965fcbea0d4d55ac147eda3aa797';

/**
 * Document complet (retenue sauf 381, refusée en échec fermé) : service à 20 %, débours, retenue de garantie 7 %, timbre 25 bps, PIH/ICV.
 * Service 1000,00 (TVA 200,00) + débours 500,00 hors champ : HT lignes 1500,00 ; TTC avant timbre 1700,00 ; espèces 1700,00 →
 * timbre 4,25 ; TTC 1704,25 ; retenue 7 % du HT (150000 c) = 105,00 ; net à payer 1599,25. Voir EXPECTED_FULL.
 */
export function buildFullInput(typeCode: (typeof TYPE_CODES)[number] = '380'): UblInvoiceInput {
  const base = buildInput(typeCode);
  return {
    ...base,
    lines: [
      { descriptionFr: 'Travaux de test', quantityMilli: 1000, unitPriceCents: 100000, vatRateBps: 2000 },
      { descriptionFr: 'Débours de test', quantityMilli: 1000, unitPriceCents: 50000, vatRateBps: 0, isDisbursementDebours: true },
    ],
    ...(typeCode === '381' ? {} : { retention: retentionRule(700) }),
    stampDuty: stampDutyRule(170000),
    pih: { icvCounter: 2, previousPiHash: PREVIOUS_HASH_HEX },
  };
}

export const EXPECTED_FULL = {
  lineExtensionCents: 150000,
  vatBaseCents: 100000,
  disbursementsCents: 50000,
  taxTotalCents: 20000,
  stampDutyCents: 425,
  taxExclusiveCents: 150425,
  taxInclusiveCents: 170425,
  retentionCents: 10500,
  payableCents: 159925,
} as const;
