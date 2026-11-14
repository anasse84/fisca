import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FiscalJavaClient,
  FiscalJavaClientError,
  buildFacturXRequest,
  generateUblInvoiceXml,
  preparePadesSignature,
  resolveSchema,
  schemaKindOfTypeCode,
  signPades,
  type UblInvoiceInput,
} from '../src/index.ts';
import { buildFullInput, buildInput, XHUB_UUID } from './support/fixtures.ts';
import { extractEmbeddedXml, nodeFetchTransport, startFiscalJava, type RunningFiscalJava } from './support/fiscal-java-server.ts';
import { guardTool, javaAvailability, mavenAvailability, opensslAvailability } from './support/java-tools.ts';
import { createTestIdentity, createTestTimestampProvider } from './support/test-pki.ts';
import { validateWithXmllint } from './support/xmllint.ts';

/**
 * Chaîne complète TypeScript -> HTTP -> conteneur Java réel (démarré en local par Maven, sans Docker) :
 * buildFacturXRequest, FiscalJavaClient, PDF/A-3b, arrêtés Java = arrêtés TS pour tous les vecteurs, XML embarqué, PAdES.
 */
const enabled = guardTool('JDK 21 + Maven (conteneur fiscal-java pour la chaîne /facturx)', {
  available: javaAvailability.available && mavenAvailability.available,
  reason: javaAvailability.available ? mavenAvailability.reason : javaAvailability.reason,
});
const opensslEnabled = guardTool('OpenSSL (cms -verify)', opensslAvailability);

const BASE_URL = 'https://verif.exemple.test';
const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

describe.runIf(enabled)('chaîne /facturx avec le conteneur Java réel', () => {
  let java: RunningFiscalJava;
  let client: FiscalJavaClient;
  const work = mkdtempSync(join(tmpdir(), 'fisca-facturx-'));

  beforeAll(async () => {
    java = await startFiscalJava();
    client = new FiscalJavaClient({ baseUrl: java.baseUrl, http: nodeFetchTransport, timeoutMs: 60_000 });
  }, 240_000);

  afterAll(() => {
    java?.stop();
    rmSync(work, { recursive: true, force: true });
  });

  const fullInput = buildFullInput('380');
  const fullXml = generateUblInvoiceXml(fullInput);
  const fullRequest = () => buildFacturXRequest({ input: fullInput, xml: fullXml, xhubUuid: XHUB_UUID, verificationBaseUrl: BASE_URL, supplierNameAr: 'شركة البائع للتجارب', customerNameAr: 'شركة المشتري للتجارب' });

  it('/validate : le client lit le rapport du conteneur', async () => {
    const report = await client.validate(fullXml);
    expect(report.profile).toBe('cius-ma-provisional');
    expect(typeof report.valid).toBe('boolean');
  });

  it('/facturx : PDF/A-3b dont le XML embarqué est octet pour octet celui du générateur, valide contre le XSD OASIS UBL 2.1', async () => {
    const pdf = await client.buildFacturX(fullRequest());
    expect(latin1(pdf.subarray(0, 8))).toMatch(/^%PDF-1\.\d/);
    const embedded = extractEmbeddedXml(pdf);
    expect(new TextDecoder().decode(embedded)).toBe(fullXml);
    const schema = resolveSchema(schemaKindOfTypeCode('380'), '2.1');
    expect(validateWithXmllint(new TextDecoder().decode(embedded), schema.path).valid).toBe(true);
    const raw = latin1(pdf);
    expect(raw).toContain('/AFRelationship /Alternative');
    expect(raw).toContain('<fx:DocumentFileName>ubl-invoice.xml</fx:DocumentFileName>');
    expect(raw).toContain('<fx:ConformanceLevel>UBL21-PROVISIONAL</fx:ConformanceLevel>');
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(raw).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(raw).not.toContain('factur-x.xml');
  });

  it('les erreurs du conteneur remontent avec leur code, sans contenu de facture', async () => {
    const request = fullRequest();
    const tampered = { ...request, presentation: { ...request.presentation, totals: { ...request.presentation.totals, taxInclusiveCents: request.presentation.totals.taxInclusiveCents + 1 } } };
    const error = await client.buildFacturX(tampered).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FiscalJavaClientError);
    expect(error).toMatchObject({ code: 'FISCAL_JAVA_REJECTED', status: 422, remoteCode: 'PRESENTATION_XML_MISMATCH', path: 'presentation.totals.taxInclusiveCents' });
    const badWords = { ...request, expectedAmountInWords: { fr: 'faux', ar: 'خطأ' } };
    await expect(client.buildFacturX(badWords)).rejects.toMatchObject({ remoteCode: 'AMOUNT_IN_WORDS_MISMATCH' });
  });

  const vectors = (
    JSON.parse(readFileSync(new URL('./golden/amount-in-words.vectors.json', import.meta.url), 'utf8')) as {
      vectors: { id: string; input: { amountCents: string }; expected?: { fr: string; ar: string } }[];
    }
  ).vectors.filter((vector) => vector.expected !== undefined);

  it(`le conteneur recalcule exactement les arrêtés TypeScript pour les ${vectors.length} vecteurs d'or (200 sinon 422 AMOUNT_IN_WORDS_MISMATCH)`, async () => {
    for (const vector of vectors) {
      const cents = Number(vector.input.amountCents);
      const input: UblInvoiceInput = { ...buildInput('380'), lines: [{ descriptionFr: 'Montant du vecteur', quantityMilli: 1000, unitPriceCents: cents, vatRateBps: 0 }] };
      const request = buildFacturXRequest({ input, xml: generateUblInvoiceXml(input), xhubUuid: XHUB_UUID, verificationBaseUrl: BASE_URL });
      expect(request.expectedAmountInWords, vector.id).toEqual(vector.expected);
      const pdf = await client.buildFacturX(request);
      expect(pdf.length, vector.id).toBeGreaterThan(5000);
    }
  }, 240_000);

  describe('F : PAdES sur le PDF/A-3b produit par Mustang', () => {
    it('preparePadesSignature accepte le PDF (xref classique) : aucun échec fermé', async () => {
      const pdf = await client.buildFacturX(fullRequest());
      const raw = latin1(pdf);
      expect(raw).not.toContain('/Type /XRef');
      expect(raw).not.toContain('/Type /ObjStm');
      const prepared = await preparePadesSignature(pdf, { signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)) });
      expect(prepared.pdf.length).toBeGreaterThan(pdf.length);
      expect(Array.from(prepared.pdf.subarray(0, pdf.length))).toEqual(Array.from(pdf));
    });

    it('signPades (clés éphémères de TEST, TSA de test non qualifiée) : incrément signé, original intact, CMS vérifiable par OpenSSL', async () => {
      const pdf = await client.buildFacturX(fullRequest());
      const identity = await createTestIdentity('ecdsa-p256');
      const tsa = await createTestTimestampProvider({ now: () => new Date(Date.UTC(2026, 10, 13, 12, 0, 7)) });
      const signed = await signPades(pdf, { certificateDer: identity.certificateDer, signer: identity.signer, timestampProvider: tsa, signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)) });
      expect(Array.from(signed.pdf.subarray(0, pdf.length))).toEqual(Array.from(pdf));
      const text = latin1(signed.pdf);
      expect(text).toContain('/SubFilter /ETSI.CAdES.detached');
      const [a, b, c, d] = signed.byteRange;
      expect(a).toBe(0);
      expect(c + d).toBe(signed.pdf.length);
      if (opensslEnabled) {
        const content = new Uint8Array(b + d);
        content.set(signed.pdf.subarray(a, a + b), 0);
        content.set(signed.pdf.subarray(c, c + d), b);
        writeFileSync(join(work, 'content.bin'), content);
        writeFileSync(join(work, 'sig.der'), signed.cms);
        const run = spawnSync('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', join(work, 'sig.der'), '-content', join(work, 'content.bin'), '-binary', '-out', '/dev/null'], { encoding: 'utf8' });
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      }
    }, 60_000);
  });
});
