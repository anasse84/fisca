import { describe, expect, it } from 'vitest';
import { createConnectivityMonitor } from '../src/offline/connectivity.ts';
import type { ConnectivityTarget } from '../src/offline/connectivity.ts';
import { buildServiceWorkerUrl, registerPosServiceWorker } from '../src/sw/register.ts';

describe('enregistrement du Service Worker', () => {
  it('ajoute la version à l’URL du script', () => {
    expect(buildServiceWorkerUrl('/sw.js', '12')).toBe('/sw.js?v=12');
    expect(buildServiceWorkerUrl('/sw.js?x=1', 'a b')).toBe('/sw.js?x=1&v=a%20b');
  });

  it('UNSUPPORTED sans navigateur compatible', async () => {
    expect(await registerPosServiceWorker(undefined, { scriptUrl: '/sw.js', version: '1', scope: '/' })).toEqual({ status: 'UNSUPPORTED' });
  });

  it('REGISTERED avec la portée et le module demandés', async () => {
    const calls: Array<{ url: string; scope: string | undefined }> = [];
    const result = await registerPosServiceWorker(
      {
        register: async (url, options) => {
          calls.push({ url, scope: options.scope });
          return { scope: options.scope ?? '' };
        },
      },
      { scriptUrl: '/sw.js', version: '3', scope: '/' },
    );
    expect(result).toEqual({ status: 'REGISTERED', scope: '/' });
    expect(calls).toEqual([{ url: '/sw.js?v=3', scope: '/' }]);
  });

  it('FAILED conserve le message d’erreur', async () => {
    const result = await registerPosServiceWorker(
      {
        register: async () => {
          throw new Error('refusé');
        },
      },
      { scriptUrl: '/sw.js', version: '3', scope: '/' },
    );
    expect(result).toEqual({ status: 'FAILED', message: 'refusé' });
  });
});

describe('moniteur de connectivité', () => {
  it('notifie les passages en ligne / hors ligne et se désabonne', () => {
    const listeners = new Map<string, () => void>();
    let online = true;
    const target: ConnectivityTarget = {
      addEventListener: (type, listener) => void listeners.set(type, listener),
      removeEventListener: (type) => void listeners.delete(type),
    };
    const seen: boolean[] = [];
    const stop = createConnectivityMonitor(target, () => online, (value) => seen.push(value));
    expect(seen).toEqual([true]);
    online = false;
    listeners.get('offline')?.();
    online = true;
    listeners.get('online')?.();
    expect(seen).toEqual([true, false, true]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
