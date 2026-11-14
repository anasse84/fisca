/// <reference types="astro/client" />

declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;
  export default component;
}

declare namespace App {
  interface Locals {
    /** Adaptateur @astrojs/cloudflare 12 : environnement, contexte d'exécution et caches (absent hors Workers). Même forme que `EdgeRuntime` de src/edge/runtime.ts. */
    runtime?: {
      readonly env?: Readonly<Record<string, unknown>>;
      readonly ctx?: { waitUntil(promise: Promise<unknown>): void };
      readonly caches?: {
        readonly default?: {
          match(request: string): Promise<Response | undefined>;
          put(request: string, response: Response): Promise<void>;
          delete(request: string): Promise<boolean>;
        };
      };
    };
    /** Date de dernière modification de la page (ISO 8601 UTC), posée par le middleware depuis le magasin de fraîcheur. */
    dateModifiedIso?: string;
  }
}
