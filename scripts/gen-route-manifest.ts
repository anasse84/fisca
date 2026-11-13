import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTE_ENTRY_FILE = 'index.ts';
const MANIFEST_FILE = 'routes.generated.ts';

/** Noms des dossiers de apps/api-hono/src/routes/* qui contiennent un index.ts, triés. */
export function listRouteNames(routesDir: string): string[] {
  if (!existsSync(routesDir)) return [];
  return readdirSync(routesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(routesDir, entry.name, ROUTE_ENTRY_FILE)))
    .map((entry) => entry.name)
    .sort();
}

export function buildManifestSource(routeNames: readonly string[]): string {
  const header = [
    '// Fichier généré par scripts/gen-route-manifest.ts : ne pas modifier, ne pas commiter.',
    '',
    'export interface RouteManifestEntry {',
    '  readonly name: string;',
    '  readonly module: unknown;',
    '}',
    '',
  ];
  if (routeNames.length === 0) {
    return [...header, 'export const routeManifest: readonly RouteManifestEntry[] = [];', ''].join('\n');
  }
  const imports = routeNames.map((name, index) => `import * as route${index} from './routes/${name}/${ROUTE_ENTRY_FILE}';`);
  const entries = routeNames.map((name, index) => `  { name: '${name}', module: route${index} },`);
  return [
    ...imports,
    '',
    ...header,
    'export const routeManifest: readonly RouteManifestEntry[] = [',
    ...entries,
    '];',
    '',
  ].join('\n');
}

export function writeRouteManifest(apiDir: string): string {
  const names = listRouteNames(join(apiDir, 'src', 'routes'));
  const target = join(apiDir, 'src', MANIFEST_FILE);
  writeFileSync(target, buildManifestSource(names));
  return target;
}

if (import.meta.main) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = writeRouteManifest(join(repoRoot, 'apps', 'api-hono'));
  process.stdout.write(`manifeste de routes écrit : ${target}\n`);
}
