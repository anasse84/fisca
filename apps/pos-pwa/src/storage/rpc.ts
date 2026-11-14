import type { PosStorage, SqlRow, SqlStatement, SqlValue } from './ports.ts';

/**
 * Pont RPC entre le thread principal (client) et le Worker qui détient la base OPFS (serveur).
 * Transport : tout objet de type MessagePort (Worker, MessageChannel).
 */

export interface RpcPort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  start?(): void;
}

type RpcRequest =
  | { readonly id: number; readonly method: 'run'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly id: number; readonly method: 'all'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly id: number; readonly method: 'batch'; readonly statements: readonly SqlStatement[] }
  | { readonly id: number; readonly method: 'close' };

type RpcResponse =
  | { readonly id: number; readonly ok: true; readonly rows?: readonly SqlRow[] }
  | { readonly id: number; readonly ok: false; readonly message: string };

function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; method?: unknown };
  return typeof candidate.id === 'number' && typeof candidate.method === 'string';
}

function isResponse(value: unknown): value is RpcResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { id?: unknown; ok?: unknown };
  return typeof candidate.id === 'number' && typeof candidate.ok === 'boolean';
}

/** Côté Worker : expose `storage` sur le port. */
export function serveStorage(storage: PosStorage, port: RpcPort): void {
  port.addEventListener('message', (event) => {
    const request = event.data;
    if (!isRequest(request)) return;
    void execute(storage, request).then(
      (rows) => port.postMessage(rows === undefined ? { id: request.id, ok: true } : { id: request.id, ok: true, rows }),
      (error: unknown) => port.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) }),
    );
  });
  port.start?.();
}

async function execute(storage: PosStorage, request: RpcRequest): Promise<readonly SqlRow[] | undefined> {
  switch (request.method) {
    case 'run':
      await storage.run(request.sql, request.params);
      return undefined;
    case 'all':
      return storage.all(request.sql, request.params);
    case 'batch':
      await storage.batch(request.statements);
      return undefined;
    case 'close':
      await storage.close();
      return undefined;
  }
}

/** Côté thread principal : un `PosStorage` qui délègue au Worker. */
export function createRpcClient(port: RpcPort): PosStorage {
  let nextId = 1;
  const pending = new Map<number, { resolve: (rows: readonly SqlRow[]) => void; reject: (error: Error) => void }>();

  port.addEventListener('message', (event) => {
    const response = event.data;
    if (!isResponse(response)) return;
    const waiter = pending.get(response.id);
    if (waiter === undefined) return;
    pending.delete(response.id);
    if (response.ok) waiter.resolve(response.rows ?? []);
    else waiter.reject(new Error(response.message));
  });
  port.start?.();

  const call = (build: (id: number) => RpcRequest): Promise<readonly SqlRow[]> =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      port.postMessage(build(id));
    });

  return {
    async run(sql, params = []) {
      await call((id) => ({ id, method: 'run', sql, params }));
    },
    all: (sql, params = []) => call((id) => ({ id, method: 'all', sql, params })),
    async batch(statements) {
      await call((id) => ({ id, method: 'batch', statements }));
    },
    async close() {
      await call((id) => ({ id, method: 'close' }));
    },
  };
}
