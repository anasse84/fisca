import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildPihTuple,
  computeInvoicePih,
  computeUblInvoicePih,
  generateUblInvoiceXml,
  INVOICE_GENESIS_HASH,
  pihFieldsOfInvoice,
  serializePihTuple,
  UblGeneratorError,
  verifyPihChain,
  type ChainedInvoicePih,
  type InvoicePihFields,
} from '../src/index.ts';
import { buildFullInput, buildInput, PREVIOUS_HASH_HEX } from './support/fixtures.ts';

const GOLD_FIELDS: InvoicePihFields = {
  emitterIce15: '001534290000057',
  sequentialNumber: 'FAC-2026-000001',
  icvCounter: 1,
  ublTypeCode: '380',
  issueDate: '2026-11-13',
  buyerIdentifier: '003042032000080',
  currencyCode: 'MAD',
  totalHtCents: 100000,
  totalVatCents: 20000,
  stampDutyCents: 0,
  totalTtcCents: 120000,
  previousPiHash: INVOICE_GENESIS_HASH,
};
const GOLD_HASH = '0ec5abda99c2661c14b933a1133263083d83965fcbea0d4d55ac147eda3aa797';

/** Contrôle indépendant : node:crypto (autorisé dans les tests seulement), sérialisation écrite à la main. */
function independentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('amorce de chaîne', () => {
  it('GENESIS_HASH_ + 32 zéros : 45 caractères', () => {
    expect(INVOICE_GENESIS_HASH).toBe('GENESIS_HASH_00000000000000000000000000000000');
    expect(INVOICE_GENESIS_HASH).toHaveLength(45);
  });
});

describe('empreinte PIH', () => {
  it('sérialisation : tuple de 13 éléments, sans espace, JSON.stringify', () => {
    expect(serializePihTuple(GOLD_FIELDS)).toBe(
      '["FISCA_INV_PIH_V1","001534290000057","FAC-2026-000001",1,"380","2026-11-13","003042032000080","MAD",100000,20000,0,120000,"GENESIS_HASH_00000000000000000000000000000000"]',
    );
    expect(buildPihTuple(GOLD_FIELDS)).toHaveLength(13);
  });

  it('empreinte d’or imposée par le propriétaire (WebCrypto et node:crypto concordent)', async () => {
    expect(await computeInvoicePih(GOLD_FIELDS)).toBe(GOLD_HASH);
    expect(independentHash(serializePihTuple(GOLD_FIELDS))).toBe(GOLD_HASH);
  });

  it('undefined → null et -0 → 0', async () => {
    const withoutBuyer = { ...GOLD_FIELDS, buyerIdentifier: undefined, stampDutyCents: -0 };
    const text = serializePihTuple(withoutBuyer);
    expect(text).toContain(',null,"MAD",100000,20000,0,120000,');
    expect(text).not.toContain(',-0,');
    expect(await computeInvoicePih(withoutBuyer)).toBe(independentHash(text));
  });

  it('refuse des champs invalides sans recopier les valeurs', async () => {
    const bad = { ...GOLD_FIELDS, icvCounter: 0, previousPiHash: 'abc', totalTtcCents: Number('10.5') };
    await expect(computeInvoicePih(bad)).rejects.toBeInstanceOf(UblGeneratorError);
    try {
      await computeInvoicePih(bad);
    } catch (error) {
      const typed = error as UblGeneratorError;
      expect(typed.code).toBe('UBL_PIH_INVALID');
      expect(typed.details.map((detail) => ('path' in detail ? detail.path : ''))).toEqual(['icvCounter', 'totalTtcCents', 'previousPiHash']);
      expect(typed.message).not.toContain('abc');
    }
  });

  it('empreinte précédente : genèse de 45 caractères ou 64 hexadécimaux minuscules seulement', async () => {
    await expect(computeInvoicePih({ ...GOLD_FIELDS, previousPiHash: GOLD_HASH.toUpperCase() })).rejects.toBeInstanceOf(UblGeneratorError);
    await expect(computeInvoicePih({ ...GOLD_FIELDS, previousPiHash: GOLD_HASH })).resolves.toHaveLength(64);
  });
});

async function buildChain(): Promise<ChainedInvoicePih[]> {
  const first: InvoicePihFields = GOLD_FIELDS;
  const second: InvoicePihFields = {
    ...GOLD_FIELDS,
    sequentialNumber: 'FAC-2026-000002',
    icvCounter: 2,
    totalHtCents: 50000,
    totalVatCents: 10000,
    totalTtcCents: 60000,
    previousPiHash: await computeInvoicePih(first),
  };
  const third: InvoicePihFields = {
    ...GOLD_FIELDS,
    sequentialNumber: 'FAC-2026-000003',
    icvCounter: 3,
    previousPiHash: await computeInvoicePih(second),
  };
  return [first, second, third].map((fields) => ({ ...fields, piHash: '' })).reduce<Promise<ChainedInvoicePih[]>>(async (accPromise, item) => {
    const acc = await accPromise;
    return [...acc, { ...item, piHash: await computeInvoicePih(item) }];
  }, Promise.resolve([]));
}

describe('verifyPihChain', () => {
  it('accepte une chaîne intacte depuis l’amorce', async () => {
    expect(await verifyPihChain(await buildChain())).toEqual({ valid: true, violations: [] });
  });

  it('accepte un segment avec ancre', async () => {
    const chain = await buildChain();
    const first = chain[0] as ChainedInvoicePih;
    expect((await verifyPihChain(chain.slice(1), { icvCounter: first.icvCounter, piHash: first.piHash })).valid).toBe(true);
  });

  it('détecte une rupture : maillon modifié après coup', async () => {
    const chain = await buildChain();
    const tampered = chain.map((item, index) => (index === 1 ? { ...item, totalTtcCents: item.totalTtcCents + 1 } : item));
    const report = await verifyPihChain(tampered);
    expect(report.valid).toBe(false);
    expect(report.violations).toContainEqual({ index: 1, code: 'HASH_MISMATCH' });
  });

  it('détecte un hash précédent erroné', async () => {
    const chain = await buildChain();
    const wrongPrevious = chain.map((item, index) => (index === 2 ? { ...item, previousPiHash: PREVIOUS_HASH_HEX } : item));
    const report = await verifyPihChain(wrongPrevious);
    expect(report.violations).toContainEqual({ index: 2, code: 'PREVIOUS_HASH_MISMATCH' });
  });

  it('une première facture sans amorce est une rupture', async () => {
    const chain = await buildChain();
    const first = chain[0] as ChainedInvoicePih;
    const report = await verifyPihChain([{ ...first, previousPiHash: PREVIOUS_HASH_HEX }]);
    expect(report.violations).toContainEqual({ index: 0, code: 'PREVIOUS_HASH_MISMATCH' });
  });

  it('détecte un ICV non monotone', async () => {
    const chain = await buildChain();
    const [first, second] = chain as [ChainedInvoicePih, ChainedInvoicePih, ChainedInvoicePih];
    const repeated = { ...second, icvCounter: 1 };
    const report = await verifyPihChain([first, { ...repeated, piHash: await computeInvoicePih(repeated) }]);
    expect(report.violations.map((violation) => violation.code)).toContain('ICV_NOT_MONOTONIC');
  });

  it('détecte un trou d’ICV', async () => {
    const chain = await buildChain();
    const [first, second] = chain as [ChainedInvoicePih, ChainedInvoicePih, ChainedInvoicePih];
    const gap = { ...second, icvCounter: 5 };
    const report = await verifyPihChain([first, { ...gap, piHash: await computeInvoicePih(gap) }]);
    expect(report.violations).toContainEqual({ index: 1, code: 'ICV_GAP' });
  });

  it('signale des champs invalides sans lever', async () => {
    const chain = await buildChain();
    const first = chain[0] as ChainedInvoicePih;
    const report = await verifyPihChain([{ ...first, emitterIce15: 'x' }]);
    expect(report.violations).toContainEqual({ index: 0, code: 'FIELDS_INVALID' });
  });
});

describe('insertion dans le XML', () => {
  it('PIH : Base64 du hash précédent, mimeCode text/plain ; ICV : compteur', () => {
    const xml = generateUblInvoiceXml(buildFullInput('380'));
    const encoded = Buffer.from(PREVIOUS_HASH_HEX, 'utf8').toString('base64');
    expect(xml).toContain(
      `<cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain" filename="pih.txt">${encoded}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`,
    );
    expect(xml).toContain('<cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>2</cbc:UUID></cac:AdditionalDocumentReference>');
  });

  it('la genèse (45 caractères) s’encode aussi', () => {
    const xml = generateUblInvoiceXml({ ...buildInput('380'), pih: { icvCounter: 1, previousPiHash: INVOICE_GENESIS_HASH } });
    expect(xml).toContain(Buffer.from(INVOICE_GENESIS_HASH, 'utf8').toString('base64'));
  });

  it('sans pih : aucune référence PIH ni ICV', () => {
    expect(generateUblInvoiceXml(buildInput('380'))).not.toContain('PIH');
  });

  it('refuse un ICV nul, une empreinte invalide, ou un émetteur sans ICE', () => {
    const base = buildInput('380');
    expect(() => generateUblInvoiceXml({ ...base, pih: { icvCounter: 0, previousPiHash: INVOICE_GENESIS_HASH } })).toThrow(UblGeneratorError);
    expect(() => generateUblInvoiceXml({ ...base, pih: { icvCounter: 1, previousPiHash: 'zz' } })).toThrow(UblGeneratorError);
    const supplierWithoutIce = { ...base.supplier, ice: undefined };
    expect(() =>
      generateUblInvoiceXml({ ...base, supplier: supplierWithoutIce, pih: { icvCounter: 1, previousPiHash: INVOICE_GENESIS_HASH } }),
    ).toThrow(UblGeneratorError);
  });

  it('l’empreinte de la facture = tuple tiré des totaux du générateur (HT, TVA, timbre, TTC)', async () => {
    const input = buildFullInput('380');
    const fields = pihFieldsOfInvoice(input);
    expect(fields).toMatchObject({
      emitterIce15: '000970000000097',
      sequentialNumber: 'FAC-2026-000001',
      icvCounter: 2,
      ublTypeCode: '380',
      buyerIdentifier: '001197530853397',
      totalHtCents: 150000,
      totalVatCents: 20000,
      stampDutyCents: 425,
      totalTtcCents: 170425,
      previousPiHash: PREVIOUS_HASH_HEX,
    });
    expect(await computeUblInvoicePih(input)).toBe(independentHash(serializePihTuple(fields)));
  });
});
