# @fisca/pos-pwa — caisse Fisca POS (étape 1 sur 4 : socle)

## Variante SQLite WASM retenue

`@sqlite.org/sqlite-wasm` 3.54.1-build1, VFS **`opfs-sahpool`** (pool de `SyncAccessHandle`), dans un **Worker dédié** (`src/storage/opfs-worker.ts`).

- Pas de `SharedArrayBuffer` : les en-têtes `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` ne sont **pas requis** (ils le seraient pour le VFS `opfs` classique ; le skill `fisca-pos-offline-sce` § 5 les cite pour cette variante-là). Les poser reste possible mais ne conditionne pas la persistance.
- Contrepartie : un seul onglet de caisse peut ouvrir la base à la fois (le second échoue à l'initialisation, `OpfsUnavailableError`). Aucun repli silencieux en mémoire.
- Dossier du pool : `/fisca-pos-sahpool`, fichier `/fisca-pos.sqlite3`.
- Le thread principal parle au Worker par `connectOpfsWorker(worker)` (pont RPC, `src/storage/rpc.ts`) ; les tests utilisent `createMemoryStorage()` (même SQLite WASM, base `:memory:`).

## Fenêtre hors-ligne de 72 h

`src/offline/offline-window.ts` : la fenêtre se compte depuis la dernière synchronisation réussie. Au-delà de 72 h (strictement), nouvelles ventes refusées, en ligne ou non, jusqu'à resynchronisation.

## Appairage

Le serveur est atteint par le port `PairingGateway` ; aucune route d'appairage n'existe au registre des contrats, aucune n'est devinée.
