import { openOpfsStorage } from './opfs-sahpool-storage.ts';
import { serveStorage } from './rpc.ts';
import type { RpcPort } from './rpc.ts';

/**
 * Point d'entrée du Worker dédié à la base OPFS (module Worker : `new Worker(url, { type: 'module' })`).
 * Le thread principal parle à ce Worker par `createRpcClient(worker)`.
 */
interface WorkerScopeLike extends RpcPort {
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScopeLike;

void openOpfsStorage().then(
  (storage) => {
    serveStorage(storage, scope);
    scope.postMessage({ type: 'fisca-pos-storage-ready' });
  },
  (error: unknown) => {
    scope.postMessage({ type: 'fisca-pos-storage-failed', message: error instanceof Error ? error.message : String(error) });
  },
);
