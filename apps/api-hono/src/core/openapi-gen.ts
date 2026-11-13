/// <reference types="node" />
/**
 * `pnpm --filter @fisca/api-hono openapi:gen` (ERRATA D-18) : écrit `apps/api-hono/openapi.json`, fichier IGNORÉ par Git
 * (motif `openapi.json` du .gitignore racine) ; l'orchestrateur commite `.meta/openapi.snapshot.json` à la barrière.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi-document.ts';

export function writeOpenApiDocument(targetDir: string): string {
  const target = join(targetDir, 'openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  return target;
}

if (import.meta.main) {
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  process.stdout.write(`openapi.json écrit : ${writeOpenApiDocument(apiDir)}\n`);
}
