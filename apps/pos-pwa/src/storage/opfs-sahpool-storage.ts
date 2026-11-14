import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapOo1Database } from './oo1-storage.ts';
import type { PosStorage } from './ports.ts';

/**
 * Variante retenue : VFS `opfs-sahpool` (pool de SyncAccessHandle), exécuté dans un Worker dédié.
 * - Ne requiert ni SharedArrayBuffer ni les en-têtes COOP/COEP (contrairement au VFS `opfs` classique).
 * - Pas de concurrence entre onglets : un seul onglet de caisse peut ouvrir la base (les autres échouent à l'initialisation).
 * - Le dossier du pool est dédié à Fisca POS : tout fichier qu'il contient est géré par le VFS.
 */
export const OPFS_SAHPOOL_DIRECTORY = '/fisca-pos-sahpool';
export const OPFS_DB_FILENAME = '/fisca-pos.sqlite3';

export class OpfsUnavailableError extends Error {
  constructor(cause: string) {
    super(`OPFS indisponible pour le stockage persistant de la caisse : ${cause}`);
    this.name = 'OpfsUnavailableError';
  }
}

/** Vrai si le contexte courant expose l'API OPFS (Worker de navigateur compatible). */
function opfsAvailable(): boolean {
  const nav = (globalThis as { navigator?: { storage?: { getDirectory?: unknown } } }).navigator;
  return typeof nav?.storage?.getDirectory === 'function';
}

/**
 * Ouvre la base persistante sur OPFS. À appeler DANS un Worker. Aucun repli silencieux sur la mémoire :
 * une caisse qui perdrait ses tickets au rechargement serait un défaut fiscal.
 */
export async function openOpfsStorage(): Promise<PosStorage> {
  if (!opfsAvailable()) {
    throw new OpfsUnavailableError('navigator.storage.getDirectory est absent (hors navigateur ou contexte non sécurisé).');
  }
  const sqlite3 = await sqlite3InitModule();
  let pool;
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({ directory: OPFS_SAHPOOL_DIRECTORY, clearOnInit: false });
  } catch (error) {
    throw new OpfsUnavailableError(error instanceof Error ? error.message : String(error));
  }
  const db = new pool.OpfsSAHPoolDb(OPFS_DB_FILENAME);
  db.exec('PRAGMA foreign_keys = ON');
  return wrapOo1Database(db);
}
