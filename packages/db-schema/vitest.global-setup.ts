import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Démarre PostgreSQL 16 s'il n'écoute pas déjà (scripts/ensure-postgres.sh) avant les tests de parité SQL.
 * Échec franc si le serveur reste injoignable : aucun test PostgreSQL n'est ignoré.
 */
export default function setup(): void {
  const script = fileURLToPath(new URL('../../scripts/ensure-postgres.sh', import.meta.url));
  execFileSync('bash', [script], { stdio: 'inherit' });
}
