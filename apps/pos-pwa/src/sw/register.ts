/** Enregistrement côté client ; le conteneur est injecté (navigator.serviceWorker en navigateur). */

export interface ServiceWorkerContainerLike {
  register(scriptUrl: string, options: { scope?: string; type?: 'classic' | 'module' }): Promise<{ readonly scope: string }>;
}

export interface RegisterOptions {
  readonly scriptUrl: string;
  readonly version: string;
  readonly scope: string;
}

export type RegisterResult =
  | { readonly status: 'REGISTERED'; readonly scope: string }
  | { readonly status: 'UNSUPPORTED' }
  | { readonly status: 'FAILED'; readonly message: string };

export function buildServiceWorkerUrl(scriptUrl: string, version: string): string {
  const separator = scriptUrl.includes('?') ? '&' : '?';
  return `${scriptUrl}${separator}v=${encodeURIComponent(version)}`;
}

export async function registerPosServiceWorker(
  container: ServiceWorkerContainerLike | undefined,
  options: RegisterOptions,
): Promise<RegisterResult> {
  if (container === undefined) return { status: 'UNSUPPORTED' };
  try {
    const registration = await container.register(buildServiceWorkerUrl(options.scriptUrl, options.version), {
      scope: options.scope,
      type: 'module',
    });
    return { status: 'REGISTERED', scope: registration.scope };
  } catch (error) {
    return { status: 'FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}
