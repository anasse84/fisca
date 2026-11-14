import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_IN_WORDS_MAX_CENTS,
  AmountInWordsError,
  FacturXRequestError,
  FacturXRequestSchema,
  UblGeneratorError,
  amountInWords,
  buildFacturXRequest,
  generateUblInvoiceXml,
  type UblInvoiceInput,
} from '../src/index.ts';
import { fromBase64 } from '../src/signature/bytes.ts';
import { buildFullInput, buildInput, XHUB_UUID } from './support/fixtures.ts';

const BASE_URL = 'https://verif.exemple.test';

function options(input: UblInvoiceInput = buildFullInput('380')) {
  return { input, xml: generateUblInvoiceXml(input), xhubUuid: XHUB_UUID, verificationBaseUrl: BASE_URL };
}

describe('buildFacturXRequest : mapping depuis l’entrée du générateur UBL', () => {
  it('reprend numéro, dates, parties, lignes et totaux recalculés en entiers (TTC 1704,25 ; net 1599,25)', () => {
    const request = buildFacturXRequest({ ...options(), supplierNameAr: 'شركة البائع', customerNameAr: 'شركة المشتري' });
    const p = request.presentation;
    expect(p.typeCode).toBe('380');
    expect(p.invoiceNumber).toBe('FAC-2026-000001');
    expect(p.issueDate).toBe('2026-11-13');
    expect(p.supplier.name).toBe('Vendeur Test SARL AU');
    expect(p.supplier.nameAr).toBe('شركة البائع');
    expect(p.supplier.ice).toBe('000970000000097');
    expect(p.supplier.addressLines).toEqual(['1 rue de Test', '10000 Rabat, MA']);
    expect(p.customer.nameAr).toBe('شركة المشتري');
    expect(p.lines.map((line) => line.lineTotalCents)).toEqual([100000, 50000]);
    expect(p.totals).toEqual({
      lineExtensionCents: 150000,
      taxTotalCents: 20000,
      stampDutyCents: 425,
      taxExclusiveCents: 150425,
      taxInclusiveCents: 170425,
      retentionCents: 10500,
      payableCents: 159925,
    });
    expect(p.vatBreakdown?.length).toBeGreaterThanOrEqual(1);
    expect(request.verification).toEqual({ baseUrl: BASE_URL, xhubUuid: XHUB_UUID });
  });

  it('le XML encodé en base64 est exactement celui du générateur', () => {
    const opts = options();
    const request = buildFacturXRequest(opts);
    expect(new TextDecoder().decode(fromBase64(request.xmlBase64))).toBe(opts.xml);
  });

  it('les arrêtés joints sont ceux de amountInWords(TTC) ; désactivables', () => {
    const request = buildFacturXRequest(options());
    expect(request.expectedAmountInWords).toEqual(amountInWords(170425n));
    expect(request.expectedAmountInWords?.fr).toBe('mille sept cent quatre dirhams et vingt-cinq centimes');
    expect(buildFacturXRequest({ ...options(), includeExpectedAmountInWords: false }).expectedAmountInWords).toBeUndefined();
  });

  it('le corps est un JSON de nombres entiers uniquement (aucun flottant sérialisé)', () => {
    const json = JSON.stringify(buildFacturXRequest(options()));
    expect(json).not.toMatch(/\d\.\d{1,}(?![\d]*")/);
    const numbers = [...json.matchAll(/:(-?\d+(?:\.\d+)?)[,}]/g)].map((match) => match[1] ?? '');
    for (const value of numbers) expect(Number.isInteger(Number(value))).toBe(true);
  });

  it('refuse un domaine non HTTPS, un UUID invalide, une entrée UBL invalide, un TTC hors plafond', () => {
    expect(() => buildFacturXRequest({ ...options(), verificationBaseUrl: 'http://verif.exemple.test' })).toThrow(FacturXRequestError);
    expect(() => buildFacturXRequest({ ...options(), verificationBaseUrl: 'https://u:p@verif.exemple.test' })).toThrow(FacturXRequestError);
    expect(() => buildFacturXRequest({ ...options(), verificationBaseUrl: 'https://verif.exemple.test/?a=1' })).toThrow(FacturXRequestError);
    expect(() => buildFacturXRequest({ ...options(), xhubUuid: 'pas-un-uuid' })).toThrow(FacturXRequestError);
    expect(() => buildFacturXRequest({ ...options(), input: { ...buildInput('380'), lines: [] } })).toThrow(UblGeneratorError);
    const huge: UblInvoiceInput = { ...buildInput('380'), lines: [{ descriptionFr: 'Hors plafond', quantityMilli: 1000, unitPriceCents: Number(AMOUNT_IN_WORDS_MAX_CENTS) + 1, vatRateBps: 0 }] };
    expect(() => buildFacturXRequest({ ...options(huge) })).toThrow(AmountInWordsError);
  });

  it('un message d’erreur ne reprend aucune donnée de la facture', () => {
    try {
      buildFacturXRequest({ ...options(), verificationBaseUrl: 'http://secret-host.exemple.test' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-host');
      expect((error as Error).message).toContain('verification.baseUrl');
    }
  });
});

describe('FacturXRequestSchema : types Zod stricts', () => {
  const valid = () => buildFacturXRequest(options());

  it('accepte le corps construit et refuse toute clé inconnue, à chaque niveau', () => {
    expect(FacturXRequestSchema.safeParse(valid()).success).toBe(true);
    const base = valid();
    expect(FacturXRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, presentation: { ...base.presentation, extra: 1 } }).success).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, presentation: { ...base.presentation, supplier: { ...base.presentation.supplier, extra: 1 } } }).success).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, verification: { ...base.verification, extra: 1 } }).success).toBe(false);
  });

  it('refuse les flottants, les montants négatifs, hors plafond, les taux hors 0 à 10000 points de base', () => {
    const base = valid();
    const withTotals = (totals: Record<string, number>) => ({ ...base, presentation: { ...base.presentation, totals: { ...base.presentation.totals, ...totals } } });
    expect(FacturXRequestSchema.safeParse(withTotals({ taxInclusiveCents: Number('1.5') })).success).toBe(false);
    expect(FacturXRequestSchema.safeParse(withTotals({ taxInclusiveCents: -1 })).success).toBe(false);
    expect(FacturXRequestSchema.safeParse(withTotals({ taxInclusiveCents: 100_000_000_000_000 })).success).toBe(false);
    const line = base.presentation.lines[0];
    if (line === undefined) throw new Error('ligne attendue');
    expect(FacturXRequestSchema.safeParse({ ...base, presentation: { ...base.presentation, lines: [{ ...line, vatRateBps: 10001 }] } }).success).toBe(false);
  });

  it('refuse type de document, devise, date, ICE, base64 et relation invalides', () => {
    const base = valid();
    const mutate = (patch: Record<string, unknown>) => FacturXRequestSchema.safeParse({ ...base, presentation: { ...base.presentation, ...patch } }).success;
    expect(mutate({ typeCode: '999' })).toBe(false);
    expect(mutate({ currencyCode: 'EUR' })).toBe(false);
    expect(mutate({ issueDate: '2026-13-01' })).toBe(false);
    expect(mutate({ supplier: { ...base.presentation.supplier, ice: '123' } })).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, xmlBase64: 'pas du base64 !' }).success).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, attachmentRelationship: 'Source' }).success).toBe(false);
    expect(FacturXRequestSchema.safeParse({ ...base, attachmentRelationship: 'Data' }).success).toBe(true);
  });
});

describe('arrêtés : TS et vecteurs d’or (la même source que JUnit)', () => {
  const file = JSON.parse(readFileSync(new URL('./golden/amount-in-words.vectors.json', import.meta.url), 'utf8')) as {
    vectors: { id: string; input: { amountCents: string }; expected?: { fr: string; ar: string }; expectedError?: string }[];
  };
  const accepted = file.vectors.filter((vector) => vector.expected !== undefined);

  it.each(accepted.map((vector) => [vector.id, vector] as const))('%s : la requête porte les arrêtés du vecteur', (_id, vector) => {
    const cents = Number(vector.input.amountCents);
    const input: UblInvoiceInput = { ...buildInput('380'), lines: [{ descriptionFr: 'Montant du vecteur', quantityMilli: 1000, unitPriceCents: cents, vatRateBps: 0 }] };
    const request = buildFacturXRequest({ input, xml: generateUblInvoiceXml(input), xhubUuid: XHUB_UUID, verificationBaseUrl: BASE_URL });
    expect(request.presentation.totals.taxInclusiveCents).toBe(cents);
    expect(request.expectedAmountInWords).toEqual(vector.expected);
  });
});

describe('src/facturx : aucun appel réseau hors interface injectée', () => {
  const directory = new URL('../src/facturx/', import.meta.url).pathname;
  const files = readdirSync(directory).filter((name) => name.endsWith('.ts'));
  it.each(files)('%s : pas de fetch global, pas de node:*, pas d’URL en dur', (name) => {
    const code = readFileSync(join(directory, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/(?<![.\w])fetch\s*\(|globalThis\.fetch/);
    expect(code).not.toMatch(/from\s+['"]node:/);
    expect(code).not.toMatch(/\bBuffer\b/);
    expect(code).not.toMatch(/https?:\/\//);
  });
});
