/**
 * Coquille d'application précachée. Chemins stables ; les ressources à empreinte produites par le bundler
 * (étape de build, hors de ce ticket) s'ajoutent à cette liste à la génération.
 */
export const SHELL_PATH = '/index.html';
export const PRECACHE_PATHS: readonly string[] = ['/', SHELL_PATH, '/manifest.webmanifest'];
