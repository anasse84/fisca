import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildManifestSource, listRouteNames, writeRouteManifest } from './gen-route-manifest.ts';

const created: string[] = [];

function makeApiDir(routes: Record<string, boolean>): string {
  const apiDir = mkdtempSync(join(tmpdir(), 'fisca-routes-'));
  created.push(apiDir);
  mkdirSync(join(apiDir, 'src', 'routes'), { recursive: true });
  for (const [name, hasIndex] of Object.entries(routes)) {
    mkdirSync(join(apiDir, 'src', 'routes', name), { recursive: true });
    if (hasIndex) writeFileSync(join(apiDir, 'src', 'routes', name, 'index.ts'), 'export {};\n');
  }
  return apiDir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('gen-route-manifest', () => {
  it('ne retient que les dossiers qui contiennent un index.ts, triés', () => {
    const apiDir = makeApiDir({ ledger: true, auth: true, vide: false });
    expect(listRouteNames(join(apiDir, 'src', 'routes'))).toEqual(['auth', 'ledger']);
  });

  it('retourne une liste vide si le dossier des routes est absent', () => {
    expect(listRouteNames(join(tmpdir(), 'fisca-inexistant-routes'))).toEqual([]);
  });

  it('génère un manifeste vide valide sans route', () => {
    const source = buildManifestSource([]);
    expect(source).toContain('export const routeManifest: readonly RouteManifestEntry[] = [];');
  });

  it('génère un import et une entrée par route', () => {
    const source = buildManifestSource(['auth', 'ledger']);
    expect(source).toContain("import * as route0 from './routes/auth/index.ts';");
    expect(source).toContain("{ name: 'ledger', module: route1 }");
  });

  it('écrit le fichier généré dans src/routes.generated.ts', () => {
    const apiDir = makeApiDir({ auth: true });
    const target = writeRouteManifest(apiDir);
    expect(target.endsWith(join('src', 'routes.generated.ts'))).toBe(true);
  });
});
