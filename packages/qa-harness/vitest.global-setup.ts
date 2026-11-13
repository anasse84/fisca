import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Démarre PostgreSQL 16 s'il n'écoute pas déjà (scripts/ensure-postgres.sh) avant les tests adverses du grand livre,
 * qui rejouent les triggers sur SQLite ET PostgreSQL. Échec franc si le serveur reste injoignable.
 */
export default function setup(): void {
  const script = fileURLToPath(new URL('../../scripts/ensure-postgres.sh', import.meta.url));
  execFileSync('bash', [script], { stdio: 'inherit' });
}
