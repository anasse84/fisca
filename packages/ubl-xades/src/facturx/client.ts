import { z } from 'zod';
import { utf8 } from '../signature/bytes.ts';
import { FacturXRequestSchema, type FacturXRequestInput } from './schema.ts';

/**
 * Client du conteneur fiscal-java (`/validate`, `/facturx`). Aucun appel réseau n'est écrit ici : tout passe par l'interface
 * injectée `FiscalJavaHttpClient` (en production le binding du conteneur, en test un faux serveur ou le serveur local).
 */

export interface FiscalJavaHttpResponse {
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface FiscalJavaRequestInit {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly signal?: AbortSignal;
}

/** Interface de transport injectable (forme de `fetch`). */
export interface FiscalJavaHttpClient {
  readonly fetch: (url: string, init: FiscalJavaRequestInit) => Promise<FiscalJavaHttpResponse>;
}

export interface FiscalJavaClientConfig {
  /** URL interne du conteneur (binding) ; paramètre de configuration, jamais une constante. */
  readonly baseUrl: string;
  readonly http: FiscalJavaHttpClient;
  /** Délai par appel, 30 s par défaut. */
  readonly timeoutMs?: number;
}

export type FiscalJavaClientErrorCode =
  | 'FISCAL_JAVA_CONFIG_INVALID'
  | 'FISCAL_JAVA_REQUEST_INVALID'
  | 'FISCAL_JAVA_REJECTED'
  | 'FISCAL_JAVA_SERVER_ERROR'
  | 'FISCAL_JAVA_NETWORK_ERROR'
  | 'FISCAL_JAVA_TIMEOUT'
  | 'FISCAL_JAVA_RESPONSE_INVALID';

/** Erreur à message constant : ni corps de facture, ni XML, ni donnée personnelle. `remoteCode` et `path` viennent du conteneur. */
export class FiscalJavaClientError extends Error {
  readonly code: FiscalJavaClientErrorCode;
  readonly status: number | undefined;
  readonly remoteCode: string | undefined;
  readonly path: string | undefined;

  constructor(code: FiscalJavaClientErrorCode, message: string, details: { status?: number; remoteCode?: string; path?: string } = {}) {
    super(message);
    this.name = 'FiscalJavaClientError';
    this.code = code;
    this.status = details.status;
    this.remoteCode = details.remoteCode;
    this.path = details.path;
  }
}

export const ValidationIssueSchema = z.object({
  rule: z.string(),
  location: z.string(),
  severity: z.string(),
  message: z.string(),
});

export const ValidationReportSchema = z.object({
  valid: z.boolean(),
  ruleSet: z.string(),
  profile: z.string(),
  profileStatus: z.string(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  issues: z.array(ValidationIssueSchema),
});
export type FiscalJavaValidationReport = z.output<typeof ValidationReportSchema>;

const ErrorBodySchema = z.object({ error: z.string().max(80), path: z.string().max(200).optional() });

const DEFAULT_TIMEOUT_MS = 30_000;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export class FiscalJavaClient {
  private readonly baseUrl: string;
  private readonly http: FiscalJavaHttpClient;
  private readonly timeoutMs: number;

  constructor(config: FiscalJavaClientConfig) {
    let parsed: URL;
    try {
      parsed = new URL(config.baseUrl);
    } catch {
      throw new FiscalJavaClientError('FISCAL_JAVA_CONFIG_INVALID', 'URL du conteneur invalide.');
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
      throw new FiscalJavaClientError('FISCAL_JAVA_CONFIG_INVALID', 'URL du conteneur invalide.');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.http = config.http;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `POST /validate` : validation UBL 2.1 + EN 16931 ; un XML invalide donne un rapport `valid: false`, pas une erreur. */
  async validate(xml: string | Uint8Array, profile?: string): Promise<FiscalJavaValidationReport> {
    const query = profile === undefined ? '' : `?profile=${encodeURIComponent(profile)}`;
    const response = await this.call(`/validate${query}`, 'application/xml', typeof xml === 'string' ? utf8(xml) : xml);
    const body = await this.readBody(response);
    this.assertOk(response.status, body);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new FiscalJavaClientError('FISCAL_JAVA_RESPONSE_INVALID', 'Réponse /validate illisible.', { status: response.status });
    }
    const report = ValidationReportSchema.safeParse(json);
    if (!report.success) throw new FiscalJavaClientError('FISCAL_JAVA_RESPONSE_INVALID', 'Réponse /validate hors contrat.', { status: response.status });
    return report.data;
  }

  /** `POST /facturx` : PDF/A-3b avec facture UBL embarquée (profil provisoire), octets du PDF. */
  async buildFacturX(request: FacturXRequestInput): Promise<Uint8Array> {
    const checked = FacturXRequestSchema.safeParse(request);
    if (!checked.success) {
      throw new FiscalJavaClientError('FISCAL_JAVA_REQUEST_INVALID', 'Requête /facturx invalide avant envoi.', {
        path: checked.error.issues[0]?.path.join('.') ?? '',
      });
    }
    const response = await this.call('/facturx', 'application/json', utf8(JSON.stringify(checked.data)));
    const body = await this.readBody(response);
    this.assertOk(response.status, body);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/pdf') || PDF_MAGIC.some((byte, index) => body[index] !== byte)) {
      throw new FiscalJavaClientError('FISCAL_JAVA_RESPONSE_INVALID', 'Réponse /facturx : PDF attendu.', { status: response.status });
    }
    return body;
  }

  private async call(path: string, contentType: string, body: Uint8Array): Promise<FiscalJavaHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.http
        .fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': contentType }, body, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new FiscalJavaClientError('FISCAL_JAVA_TIMEOUT', 'Délai dépassé en appelant le conteneur.');
      throw new FiscalJavaClientError('FISCAL_JAVA_NETWORK_ERROR', 'Conteneur injoignable.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(response: FiscalJavaHttpResponse): Promise<Uint8Array> {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new FiscalJavaClientError('FISCAL_JAVA_NETWORK_ERROR', 'Réponse du conteneur interrompue.', { status: response.status });
    }
  }

  private assertOk(status: number, body: Uint8Array): void {
    if (status === 200) return;
    let remoteCode: string | undefined;
    let path: string | undefined;
    try {
      const parsed = ErrorBodySchema.safeParse(JSON.parse(new TextDecoder().decode(body)));
      if (parsed.success) {
        remoteCode = parsed.data.error;
        path = parsed.data.path;
      }
    } catch {
      remoteCode = undefined;
    }
    const details = { status, ...(remoteCode === undefined ? {} : { remoteCode }), ...(path === undefined ? {} : { path }) };
    if (status >= 500) throw new FiscalJavaClientError('FISCAL_JAVA_SERVER_ERROR', 'Erreur du conteneur.', details);
    throw new FiscalJavaClientError('FISCAL_JAVA_REJECTED', 'Requête refusée par le conteneur.', details);
  }
}
