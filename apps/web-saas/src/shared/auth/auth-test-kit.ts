import type { FetchLike } from './api-client.ts';

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface FakeReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type FakeRoutes = Readonly<Record<string, FakeReply | ((call: RecordedCall) => FakeReply)>>;

/** `fetch` injectable : clé = « METHODE chemin » (sans requête). Toute route non déclarée lève (jamais de réseau). */
export function fakeFetch(routes: FakeRoutes): { readonly fetch: FetchLike; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const call: RecordedCall = { url: input, method, headers, body: rawBody === undefined ? undefined : JSON.parse(rawBody) };
    calls.push(call);
    const path = input.split('?')[0] ?? input;
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      throw new Error(`ROUTE_NON_SIMULEE ${method} ${path}`);
    }
    const reply = typeof route === 'function' ? route(call) : route;
    const isProblem = reply.status >= 400;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': isProblem ? 'application/problem+json' : 'application/json', ...reply.headers },
    });
  };
  return { fetch: fetchImpl, calls };
}

export function problemBody(status: number, errorCode: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'about:blank', title: 'Titre serveur en français', status, errorCode, traceId: 'trace-1', detail: 'Détail serveur en français', ...extra };
}
