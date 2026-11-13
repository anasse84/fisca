import { createRpcClient } from './rpc.ts';
import type { RpcPort } from './rpc.ts';
import type { PosStorage } from './ports.ts';

/** Se connecte au Worker OPFS : attend son message de disponibilité avant de rendre le `PosStorage` proxy. */
export function connectOpfsWorker(worker: RpcPort): Promise<PosStorage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    worker.addEventListener('message', (event) => {
      if (settled) return;
      const data = event.data as { type?: unknown; message?: unknown } | null;
      if (data === null || typeof data !== 'object') return;
      if (data.type === 'fisca-pos-storage-ready') {
        settled = true;
        resolve(createRpcClient(worker));
      } else if (data.type === 'fisca-pos-storage-failed') {
        settled = true;
        reject(new Error(typeof data.message === 'string' ? data.message : 'Initialisation OPFS échouée.'));
      }
    });
    worker.start?.();
  });
}
