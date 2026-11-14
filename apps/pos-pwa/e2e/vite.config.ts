import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Serveur Vite temporaire du banc de preuve OPFS. Pas d'en-têtes COOP/COEP : le VFS opfs-sahpool n'en a pas besoin. */
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
});
