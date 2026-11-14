import { describe, expect, it } from 'vitest';
import {
  FiscalJavaClient,
  FiscalJavaClientError,
  buildFacturXRequest,
  generateUblInvoiceXml,
  type FiscalJavaHttpClient,
  type FiscalJavaHttpResponse,
  type FiscalJavaRequestInit,
} from '../src/index.ts';
import { buildFullInput, XHUB_UUID } from './support/fixtures.ts';

function reply(status: number, contentType: string, body: Uint8Array | string): FiscalJavaHttpResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

interface Recorded {
  url: string;
  init: FiscalJavaRequestInit;
}

function transport(handler: (url: string, init: FiscalJavaRequestInit) => Promise<FiscalJavaHttpResponse>, calls: Recorded[] = []): FiscalJavaHttpClient {
  return {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const input = buildFullInput('380');
const request = buildFacturXRequest({ input, xml: generateUblInvoiceXml(input), xhubUuid: XHUB_UUID, verificationBaseUrl: 'https://verif.exemple.test' });

describe('FiscalJavaClient.buildFacturX', () => {
  it('envoie un JSON à /facturx et rend les octets du PDF', async () => {
    const calls: Recorded[] = [];
    const client = new FiscalJavaClient({ baseUrl: 'http://conteneur.interne/', http: transport(async () => reply(200, 'application/pdf', PDF), calls) });
    const pdf = await client.buildFacturX(request);
    expect(Array.from(pdf)).toEqual(Array.from(PDF));
    expect(calls[0]?.url).toBe('http://conteneur.interne/facturx');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers['content-type']).toBe('application/json');
    const sent = JSON.parse(new TextDecoder().decode(calls[0]?.init.body)) as { presentation: { invoiceNumber: string } };
    expect(sent.presentation.invoiceNumber).toBe('FAC-2026-000001');
  });

  it('refuse avant envoi une requête hors schéma', async () => {
    const calls: Recorded[] = [];
    const client = new FiscalJavaClient({ baseUrl: 'http://c.interne', http: transport(async () => reply(200, 'application/pdf', PDF), calls) });
    const bad = { ...request, presentation: { ...request.presentation, typeCode: '999' } } as unknown as Parameters<FiscalJavaClient['buildFacturX']>[0];
    await expect(client.buildFacturX(bad)).rejects.toMatchObject({ code: 'FISCAL_JAVA_REQUEST_INVALID', path: 'presentation.typeCode' });
    expect(calls).toHaveLength(0);
  });

  it('traduit un refus 4xx en FISCAL_JAVA_REJECTED avec le code et le chemin du conteneur, sans reprendre le corps', async () => {
    const client = new FiscalJavaClient({
      baseUrl: 'http://c.interne',
      http: transport(async () => reply(422, 'application/json', '{"error":"PRESENTATION_XML_MISMATCH","message":"secret-ICE-000970000000097","path":"presentation.totals.taxInclusiveCents"}')),
    });
    const error = await client.buildFacturX(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FiscalJavaClientError);
    expect(error).toMatchObject({ code: 'FISCAL_JAVA_REJECTED', status: 422, remoteCode: 'PRESENTATION_XML_MISMATCH', path: 'presentation.totals.taxInclusiveCents' });
    expect((error as Error).message).not.toContain('000970000000097');
  });

  it('traduit 5xx, réponse non PDF, réseau et délai', async () => {
    const make = (handler: Parameters<typeof transport>[0], timeoutMs?: number) =>
      new FiscalJavaClient({ baseUrl: 'http://c.interne', http: transport(handler), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    await expect(make(async () => reply(500, 'application/json', '{"error":"PDF_BUILD_FAILED"}')).buildFacturX(request)).rejects.toMatchObject({ code: 'FISCAL_JAVA_SERVER_ERROR', remoteCode: 'PDF_BUILD_FAILED' });
    await expect(make(async () => reply(200, 'text/html', 'pas un pdf')).buildFacturX(request)).rejects.toMatchObject({ code: 'FISCAL_JAVA_RESPONSE_INVALID' });
    await expect(make(async () => reply(200, 'application/pdf', 'XXXXXX')).buildFacturX(request)).rejects.toMatchObject({ code: 'FISCAL_JAVA_RESPONSE_INVALID' });
    await expect(make(async () => Promise.reject(new Error('ECONNREFUSED'))).buildFacturX(request)).rejects.toMatchObject({ code: 'FISCAL_JAVA_NETWORK_ERROR' });
    const never = (_url: string, init: FiscalJavaRequestInit): Promise<FiscalJavaHttpResponse> =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(make(never, 20).buildFacturX(request)).rejects.toMatchObject({ code: 'FISCAL_JAVA_TIMEOUT' });
  });

  it('refuse une configuration invalide', () => {
    const http = transport(async () => reply(200, 'application/pdf', PDF));
    for (const baseUrl of ['pas une url', 'ftp://c.interne', 'http://u:p@c.interne', 'http://c.interne/?a=1']) {
      expect(() => new FiscalJavaClient({ baseUrl, http })).toThrowError(FiscalJavaClientError);
    }
  });
});

describe('FiscalJavaClient.validate', () => {
  const report = { valid: false, ruleSet: 'r', profile: 'cius-ma-provisional', profileStatus: 'PROVISIONAL', errorCount: 1, warningCount: 0, issues: [{ rule: 'BR-CO-15', location: '/Invoice', severity: 'ERROR', message: 'm' }] };

  it('POST /validate avec le profil en paramètre et rapport typé', async () => {
    const calls: Recorded[] = [];
    const client = new FiscalJavaClient({ baseUrl: 'http://c.interne', http: transport(async () => reply(200, 'application/json', JSON.stringify(report)), calls) });
    const result = await client.validate('<Invoice/>', 'cius-ma-provisional');
    expect(result.errorCount).toBe(1);
    expect(result.issues[0]?.rule).toBe('BR-CO-15');
    expect(calls[0]?.url).toBe('http://c.interne/validate?profile=cius-ma-provisional');
    expect(calls[0]?.init.headers['content-type']).toBe('application/xml');
  });

  it('rejette un rapport hors contrat et un profil inconnu (400)', async () => {
    const bad = new FiscalJavaClient({ baseUrl: 'http://c.interne', http: transport(async () => reply(200, 'application/json', '{"valid":"oui"}')) });
    await expect(bad.validate('<a/>')).rejects.toMatchObject({ code: 'FISCAL_JAVA_RESPONSE_INVALID' });
    const unknown = new FiscalJavaClient({ baseUrl: 'http://c.interne', http: transport(async () => reply(400, 'application/json', '{"error":"UNKNOWN_PROFILE","message":"x"}')) });
    await expect(unknown.validate('<a/>', 'zzz')).rejects.toMatchObject({ code: 'FISCAL_JAVA_REJECTED', remoteCode: 'UNKNOWN_PROFILE' });
  });
});
