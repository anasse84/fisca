import type { EdgeCachePort, KvLike, OutboundPort, OutboundRequest } from '../../src/edge/ports.ts';

/** Pilote KV mémoire : aucune ressource Cloudflare réelle. */
export class MemoryKv implements KvLike {
  readonly data = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  put(key: string, value: string, options?: { readonly expirationTtl?: number }): Promise<void> {
    this.data.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
    return Promise.resolve();
  }
}

export class MemoryEdgeCache implements EdgeCachePort {
  readonly entries = new Map<string, Response>();
  readonly deleted: string[] = [];

  match(url: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(url)?.clone());
  }

  put(url: string, response: Response): Promise<void> {
    this.entries.set(url, response);
    return Promise.resolve();
  }

  delete(url: string): Promise<boolean> {
    this.deleted.push(url);
    return Promise.resolve(this.entries.delete(url));
  }
}

/** Réseau sortant SIMULÉ : enregistre les requêtes, ne contacte personne. */
export class RecordingOutbound implements OutboundPort {
  readonly requests: OutboundRequest[] = [];

  constructor(private readonly respond: (request: OutboundRequest) => number | Error = () => 200) {}

  send(request: OutboundRequest): Promise<{ readonly status: number }> {
    this.requests.push(request);
    const result = this.respond(request);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ status: result });
  }
}
