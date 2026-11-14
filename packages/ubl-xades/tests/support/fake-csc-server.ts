import { fromBase64, toBase64 } from '../../src/signature/bytes.ts';
import type { CscHttpClient, CscRequestInit, CscResponse } from '../../src/signature/csc-client.ts';

/**
 * Faux serveur CSC API v2.0 LOCAL (tests uniquement) : aucun réseau, aucune clé de production. Il répond comme un RSSP, signe avec une clé
 * éphémère de test fournie par le test, et compte les appels par point d'accès (preuve que signHash n'est jamais appelé après un refus).
 */
export const PATHS = {
  login: '/csc/v2/auth/login',
  info: '/csc/v2/credentials/info',
  authorize: '/csc/v2/credentials/authorize',
  signHash: '/csc/v2/signatures/signHash',
} as const;
export type FakePath = (typeof PATHS)[keyof typeof PATHS];

export type ScriptedReply =
  | { readonly status: number; readonly body: unknown }
  | { readonly hang: true }
  | { readonly networkError: true };

export interface RecordedCall {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface FakeCscOptions {
  /** Certificat renvoyé par credentials/info (DER). */
  readonly certificateDer: Uint8Array;
  /** OID annoncés dans key/algo. */
  readonly keyAlgoOids: readonly string[];
  /** Signe le condensé reçu (octets bruts du condensé) et renvoie les octets de signature dans le format que le test veut servir. */
  readonly sign: (digest: Uint8Array) => Promise<Uint8Array>;
  readonly accessToken?: string;
  readonly sad?: string;
  /** Réponses forcées, consommées dans l'ordre par point d'accès ; ensuite le comportement normal reprend. */
  readonly script?: Partial<Record<FakePath, readonly ScriptedReply[]>>;
}

export interface FakeCscServer {
  readonly client: CscHttpClient;
  readonly calls: RecordedCall[];
  count(path: FakePath): number;
}

function reply(status: number, body: unknown): CscResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

export function createFakeCscServer(options: FakeCscOptions): FakeCscServer {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, ScriptedReply[]>(Object.entries(options.script ?? {}).map(([path, replies]) => [path, [...replies]]));
  const token = options.accessToken ?? 'jeton-acces-de-test';
  const sad = options.sad ?? 'sad-de-test';

  async function normal(path: string, body: Record<string, unknown>): Promise<CscResponse> {
    if (path === PATHS.login) return reply(200, { access_token: token, expires_in: 3600 });
    if (path === PATHS.info) {
      return reply(200, {
        key: { status: 'enabled', algo: [...options.keyAlgoOids], len: 256 },
        cert: { status: 'valid', certificates: [toBase64(options.certificateDer)] },
        auth: { mode: 'explicit', objects: [{ type: 'Password', id: 'PIN', format: 'N' }] },
        SCAL: '2',
        multisign: 1,
      });
    }
    if (path === PATHS.authorize) return reply(200, { SAD: sad });
    if (path === PATHS.signHash) {
      const hashes = body['hashes'];
      if (!Array.isArray(hashes) || typeof hashes[0] !== 'string' || body['SAD'] !== sad) return reply(400, { error: 'invalid_request', error_description: 'Invalid parameter SAD' });
      return reply(200, { signatures: [toBase64(await options.sign(fromBase64(hashes[0])))] });
    }
    return reply(404, { error: 'invalid_request' });
  }

  const client: CscHttpClient = {
    fetch: (url: string, init: CscRequestInit): Promise<CscResponse> => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ path, headers: init.headers, body });
      const scripted = queues.get(path)?.shift();
      if (scripted === undefined) return normal(path, body);
      if ('networkError' in scripted) return Promise.reject(new Error('ECONNRESET sur le faux serveur de test'));
      if ('hang' in scripted) {
        return new Promise<CscResponse>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('requête interrompue')), { once: true });
        });
      }
      return Promise.resolve(reply(scripted.status, scripted.body));
    },
  };
  return { client, calls, count: (path) => calls.filter((call) => call.path === path).length };
}
