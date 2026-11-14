import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Compatibilité Cloudflare Workers : src/signature n'importe aucun module node:*, n'utilise ni Buffer, ni DOM, ni clé privée, ni TSA de test. */
const DIRECTORY = new URL('../src/signature/', import.meta.url).pathname;

describe('src/signature : pureté WebCrypto / Workers', () => {
  const files = readdirSync(DIRECTORY).filter((name) => name.endsWith('.ts'));

  it.each(files)('%s : aucun import node:*, Buffer, DOM, réseau, ni exportation de matériel de test', (name) => {
    const code = readFileSync(join(DIRECTORY, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/from\s+['"]node:/);
    expect(code).not.toMatch(/require\(/);
    expect(code).not.toMatch(/\bBuffer\b/);
    expect(code).not.toMatch(/\b(?:window|globalThis\.document|DOMParser|XMLSerializer|XMLHttpRequest)\b/);
    // Aucun appel réseau direct : `fetch` global interdit ; seul le client HTTP injecté (`config.http.fetch`, propriété) est permis (csc-client.ts).
    expect(code).not.toMatch(/(?<![.\w])fetch\s*\(|globalThis\.fetch/);
    expect(code).not.toMatch(/generateKey|exportKey|createTestTimestampProvider|TEST_TSA/);
  });

  it('couvre tous les fichiers du module', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
});
