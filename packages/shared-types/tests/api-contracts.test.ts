import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BpsIntSchema,
  CentimesIntSchema,
  CreateInvoiceRequestSchema,
  Ice15Schema,
  MilliIntSchema,
  ProblemDetailsSchema,
  VatRate2026BpsSchema,
  verifySignedWebhookPayload,
} from '../src/index.ts';

const VALID_ICE = '003976749000084';

describe('CentimesIntSchema / BpsIntSchema / MilliIntSchema', () => {
  it('acceptent des entiers sûrs', () => {
    expect(CentimesIntSchema.parse(12450)).toBe(12450);
    expect(CentimesIntSchema.parse(-1)).toBe(-1);
    expect(BpsIntSchema.parse(0)).toBe(0);
    expect(BpsIntSchema.parse(10000)).toBe(10000);
    expect(MilliIntSchema.parse(1500)).toBe(1500);
  });

  it('refusent flottants, NaN, infinis, dépassements, chaînes', () => {
    for (const bad of [12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '100', null]) {
      expect(CentimesIntSchema.safeParse(bad).success).toBe(false);
    }
    for (const bad of [-1, 10001, 0.5]) {
      expect(BpsIntSchema.safeParse(bad).success).toBe(false);
    }
    for (const bad of [0, -5, 1.5]) {
      expect(MilliIntSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('Ice15Schema', () => {
  it('accepte un ICE de 15 chiffres dont la clé modulo 97 est valide', () => {
    expect(Ice15Schema.parse(VALID_ICE)).toBe(VALID_ICE);
  });

  it('refuse longueur, caractères et clé fausses', () => {
    for (const bad of ['00397674900008', '0039767490000840', '00397674900008A', '003976749000085', ' 003976749000084', '']) {
      expect(Ice15Schema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('VatRate2026BpsSchema', () => {
  it('admet 2000, 1000, 0 seulement', () => {
    for (const rate of [2000, 1000, 0]) {
      expect(VatRate2026BpsSchema.parse(rate)).toBe(rate);
    }
    for (const bad of [1400, 700, 2001, -1, '2000']) {
      expect(VatRate2026BpsSchema.safeParse(bad).success).toBe(false);
    }
  });
});

function validLine(): Record<string, unknown> {
  return {
    descriptionFr: 'Prestation de conseil',
    quantityMilli: 1000,
    unitPriceCents: 100000,
    vatRateBps: 2000,
    pcgeAccountNumber: '7121',
  };
}

function validInvoice(): Record<string, unknown> {
  return {
    ublTypeCode: '380_FACTURE',
    partnerId: 'partner-1',
    issueDate: '2026-03-01',
    serviceDeliveryDate: '2026-03-01',
    ublPaymentCode: '30_VIREMENT',
    lines: [validLine()],
  };
}

describe('CreateInvoiceRequestSchema', () => {
  it('accepte une facture valide et applique les défauts', () => {
    const parsed = CreateInvoiceRequestSchema.parse(validInvoice());
    expect(parsed.isBtpProgressStatement).toBe(false);
    expect(parsed.btpRetentionRateBps).toBe(0);
    expect(parsed.lines[0]?.discountBps).toBe(0);
    expect(parsed.lines[0]?.isDisbursementDebours).toBe(false);
  });

  it('refuse tenantId et companyId (jamais dans un contrat)', () => {
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), tenantId: 't' }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), companyId: 'c' }).success).toBe(false);
  });

  it('refuse un prix décimal, un taux hors 2026 et une date impossible', () => {
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [{ ...validLine(), unitPriceCents: Number("10.5") }] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [{ ...validLine(), vatRateBps: 1400 }] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), issueDate: '2026-13-45' }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [] }).success).toBe(false);
  });

  it('exige originInvoiceId pour un avoir (381) et une note de débit (383)', () => {
    for (const code of ['381_AVOIR', '383_NOTE_DEBIT']) {
      expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), ublTypeCode: code }).success).toBe(false);
      expect(
        CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), ublTypeCode: code, originInvoiceId: '3f2b8c1e-9d4a-4b7e-8c1f-2a6d5e4f3b2a' }).success,
      ).toBe(true);
    }
  });

  it('exige un motif d\'exonération pour une ligne à 0 % hors débours', () => {
    const zero = { ...validLine(), vatRateBps: 0 };
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [zero] }).success).toBe(false);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [{ ...zero, vatExemptionReasonCode: 'ART_91' }] }).success).toBe(true);
    expect(CreateInvoiceRequestSchema.safeParse({ ...validInvoice(), lines: [{ ...zero, isDisbursementDebours: true }] }).success).toBe(true);
  });
});

describe('ProblemDetailsSchema (RFC 9457)', () => {
  const problem = {
    type: 'https://fisca.ma/problems/validation',
    title: 'Validation',
    status: 400,
    errorCode: 'ADR_03_FLOAT_FORBIDDEN',
    traceId: 'trace-1',
    detail: 'montant décimal',
  };

  it('accepte instance et issues[] (membres d\'extension de Doc_07 § 01), les refuse malformés', () => {
    const issues = [{ path: 'lines[0].unitPriceCents', message: 'entier requis', code: 'ADR_03_FLOAT_FORBIDDEN' }, { path: 'issueDate', message: 'date illisible' }];
    expect(ProblemDetailsSchema.safeParse({ ...problem, instance: '/api/v1/ledger/entries/e1/post', issues }).success).toBe(true);
    expect(ProblemDetailsSchema.safeParse({ ...problem, issues: [] }).success).toBe(true);
    expect(ProblemDetailsSchema.safeParse({ ...problem, issues: [{ path: 'x' }] }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, issues: 'x' }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, instance: 42 }).success).toBe(false);
  });

  it('accepte une enveloppe valide, legalRef optionnel', () => {
    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
    expect(ProblemDetailsSchema.safeParse({ ...problem, legalRef: 'Art. 91 CGI' }).success).toBe(true);
    expect(ProblemDetailsSchema.safeParse({ ...problem, type: 'about:blank' }).success).toBe(true);
  });

  it('refuse un statut hors HTTP, un type non URI et un champ manquant', () => {
    expect(ProblemDetailsSchema.safeParse({ ...problem, status: 99 }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, status: 600 }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, status: 400.5 }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, type: 'pas une uri' }).success).toBe(false);
    expect(ProblemDetailsSchema.safeParse({ ...problem, traceId: undefined }).success).toBe(false);
  });
});

async function sign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('verifySignedWebhookPayload (ERRATA C : message signé = `${timestampSecHeader}.${rawBodyText}`)', () => {
  const NOW_SEC = 1_800_000_000;
  const secret = 'whsec_test_secret';
  const body = '{"event":"invoice.certified","amountCents":12450}';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_SEC * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function verify(overrides: Partial<Parameters<typeof verifySignedWebhookPayload>[0]> = {}, tsOffset = 0): Promise<boolean> {
    const ts = String(NOW_SEC + tsOffset);
    return verifySignedWebhookPayload({
      rawBodyText: body,
      timestampSecHeader: ts,
      signatureHexHeader: await sign(secret, `${ts}.${body}`),
      sharedSecret: secret,
      ...overrides,
    });
  }

  it('accepte une signature valide, minuscules ou majuscules', async () => {
    expect(await verify()).toBe(true);
    const ts = String(NOW_SEC);
    const upper = (await sign(secret, `${ts}.${body}`)).toUpperCase();
    expect(await verify({ signatureHexHeader: upper })).toBe(true);
  });

  it('accepte aux bornes de la fenêtre de 300 s et refuse à 301 s (passé et futur)', async () => {
    expect(await verify({}, -300)).toBe(true);
    expect(await verify({}, 300)).toBe(true);
    expect(await verify({}, -301)).toBe(false);
    expect(await verify({}, 301)).toBe(false);
  });

  it('refuse un corps ou un secret modifié, et un message signé sans horodatage', async () => {
    expect(await verify({ rawBodyText: `${body} ` })).toBe(false);
    expect(await verify({ sharedSecret: 'autre' })).toBe(false);
    expect(await verify({ signatureHexHeader: await sign(secret, body) })).toBe(false);
  });

  it('refuse signatures mal formées et horodatages non entiers stricts', async () => {
    for (const signatureHexHeader of ['', 'zz', '0'.repeat(64), `${'g'.repeat(64)}`, `${'0'.repeat(63)}g`]) {
      expect(await verify({ signatureHexHeader })).toBe(false);
    }
    for (const ts of ['', 'abc', `${NOW_SEC}abc`, ` ${NOW_SEC}`, `${NOW_SEC}.5`, `-${NOW_SEC}`, `1e9`]) {
      expect(
        await verifySignedWebhookPayload({
          rawBodyText: body,
          timestampSecHeader: ts,
          signatureHexHeader: await sign(secret, `${ts}.${body}`),
          sharedSecret: secret,
        }),
      ).toBe(false);
    }
  });

  it('échoue fermé sur un secret vide ou une fenêtre invalide', async () => {
    expect(await verify({ sharedSecret: '', signatureHexHeader: '0'.repeat(64) })).toBe(false);
    expect(await verify({ maxSkewSeconds: -1 })).toBe(false);
    expect(await verify({ maxSkewSeconds: 1.5 })).toBe(false);
    expect(await verify({ maxSkewSeconds: 10 }, 11)).toBe(false);
    expect(await verify({ maxSkewSeconds: 10 }, 10)).toBe(true);
  });
});
