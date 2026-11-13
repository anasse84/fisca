/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_V1_ROUTE_CONTRACTS } from '../../core/api-v1-contracts.ts';
import { buildOpenApiDocument, openApiPathOf } from '../../core/openapi-document.ts';
import { buildKit } from './ledger-routes-test-kit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, '..', '..', '..');
const REPO = resolve(API_DIR, '..', '..');

interface OpenApiOperation {
  readonly operationId: string;
  readonly responses: Record<string, unknown>;
  readonly security?: readonly unknown[];
  readonly parameters?: readonly { readonly name: string; readonly in: string; readonly required?: boolean }[];
  readonly requestBody?: { readonly content: Record<string, { readonly schema: unknown }> };
}
interface OpenApiDoc {
  readonly openapi: string;
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly components: { readonly schemas: Record<string, unknown> };
}

function asDoc(value: unknown): OpenApiDoc {
  return value as OpenApiDoc;
}

describe('document OpenAPI généré à partir des schémas Zod', () => {
  const doc = asDoc(buildOpenApiDocument());

  it('contient exactement les huit routes du registre (CTR-API-10 à 13, 45 à 48), avec leur méthode', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/banking/reconcile',
      '/api/v1/directory/ice/{ice}',
      '/api/v1/health/deep',
      '/api/v1/ledger/entries',
      '/api/v1/ledger/entries/{id}/post',
      '/api/v1/ledger/entries/{id}/submit',
      '/api/v1/ledger/entries/{id}/visa',
      '/api/v1/ledger/verify-chain',
    ]);
    expect(Object.keys(doc.paths['/api/v1/ledger/entries'] ?? {})).toEqual(['post']);
    expect(Object.keys(doc.paths['/api/v1/ledger/entries/{id}/submit'] ?? {})).toEqual(['post']);
    expect(Object.keys(doc.paths['/api/v1/ledger/entries/{id}/visa'] ?? {})).toEqual(['post']);
    const visa = doc.paths['/api/v1/ledger/entries/{id}/visa']?.['post'];
    expect((visa?.parameters ?? []).map((p) => `${p.in}:${p.name}`)).toEqual(expect.arrayContaining(['path:id', 'header:X-Fisca-Company-Id', 'header:Idempotency-Key']));
    expect(Object.keys(doc.paths['/api/v1/ledger/verify-chain'] ?? {})).toEqual(['get']);
    const verify = doc.paths['/api/v1/ledger/verify-chain']?.['get'];
    expect((verify?.parameters ?? []).map((p) => `${p.in}:${p.name}`)).toEqual(expect.arrayContaining(['query:journalId', 'header:X-Fisca-Company-Id']));
    expect((verify?.parameters ?? []).map((p) => p.name)).not.toContain('Idempotency-Key');
    expect(Object.keys(doc.paths['/api/v1/directory/ice/{ice}'] ?? {})).toEqual(['get']);
    expect(Object.keys(doc.paths['/api/v1/ledger/entries/{id}/post'] ?? {})).toEqual(['post']);
    expect(Object.keys(doc.paths['/api/v1/banking/reconcile'] ?? {})).toEqual(['post']);
    expect(Object.keys(doc.paths['/api/v1/health/deep'] ?? {})).toEqual(['get']);
  });

  it("déclare l'en-tête de dossier et la clé d'idempotence des écritures, l'enveloppe RFC 9457 et zéro flottant", () => {
    const post = doc.paths['/api/v1/ledger/entries/{id}/post']?.['post'];
    const names = (post?.parameters ?? []).map((p) => `${p.in}:${p.name}`);
    expect(names).toEqual(expect.arrayContaining(['path:id', 'header:X-Fisca-Company-Id', 'header:Idempotency-Key']));
    expect(post?.responses).toHaveProperty('401');
    expect(JSON.stringify(doc.components.schemas['Problem'])).toContain('issues');
    const ice = doc.paths['/api/v1/directory/ice/{ice}']?.['get'];
    expect((ice?.parameters ?? []).map((p) => p.name)).not.toContain('X-Fisca-Company-Id');
    expect(JSON.stringify(doc)).not.toContain('"type":"number"');
  });

  it('chaque contrat porte son identifiant de registre', () => {
    expect(API_V1_ROUTE_CONTRACTS.map((c) => c.registryId).sort()).toEqual(['CTR-API-10', 'CTR-API-11', 'CTR-API-12', 'CTR-API-13', 'CTR-API-45', 'CTR-API-46', 'CTR-API-47', 'CTR-API-48']);
    expect(Object.keys(doc.paths).some((path) => path.includes('/cycles/'))).toBe(false);
    expect(openApiPathOf('/api/v1/ledger/entries/:id/post')).toBe('/api/v1/ledger/entries/{id}/post');
  });

  it("les routes réellement montées par Hono sont exactement celles du contrat (aucune route cachée)", async () => {
    const kit = await buildKit();
    const mounted = kit.app.routes
      .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/v1/') && !route.path.endsWith('*'))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(mounted).toEqual(API_V1_ROUTE_CONTRACTS.map((c) => `${c.method.toUpperCase()} ${c.path}`).sort());
  });
});

describe('node src/core/openapi-gen.ts (script openapi:gen en SEAM_REQUEST)', () => {
  it('écrit un fichier IGNORÉ par Git (D-18), qui contient les routes exactes', () => {
    const target = join(API_DIR, 'openapi.json');
    rmSync(target, { force: true });
    execFileSync('node', ['src/core/openapi-gen.ts'], { cwd: API_DIR, stdio: 'pipe' });
    expect(existsSync(target)).toBe(true);
    const written = asDoc(JSON.parse(readFileSync(target, 'utf8')));
    expect(Object.keys(written.paths)).toContain('/api/v1/banking/reconcile');
    execFileSync('git', ['check-ignore', '-q', target], { cwd: REPO });
    rmSync(target, { force: true });
  });
});
