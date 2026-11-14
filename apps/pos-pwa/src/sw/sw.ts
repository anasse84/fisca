import { PRECACHE_PATHS, SHELL_PATH } from './sw-manifest.ts';
import { installServiceWorker } from './sw-runtime.ts';
import type { SwCacheStorageLike, SwScope } from './sw-runtime.ts';

/** Point d'entrée du Service Worker (compilé en fichier séparé par le bundler). Version lue dans `?v=` de l'URL d'enregistrement. */
interface WorkerGlobal extends SwScope {
  readonly location: { readonly href: string; readonly origin: string };
  readonly caches: SwCacheStorageLike;
}

const scope = self as unknown as WorkerGlobal;
const version = new URL(scope.location.href).searchParams.get('v') ?? '0';

installServiceWorker(scope, {
  caches: scope.caches,
  fetchFn: (request) => fetch(request),
  nowMs: () => Date.now(),
  config: {
    version,
    origin: scope.location.origin,
    shellPath: SHELL_PATH,
    precachePaths: PRECACHE_PATHS,
  },
});
