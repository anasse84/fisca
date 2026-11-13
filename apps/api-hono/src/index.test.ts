/// <reference types="node" />
/** Point d'entrée du paquet : classes Durable Object sous le nom EXACT de wrangler.toml, fabrique de pipeline, manifeste de routes. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as entry from './index.ts';

const WRANGLER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.toml'), 'utf8');

function classNameOfBinding(binding: string): string {
  const match = new RegExp(`name\\s*=\\s*"${binding}"\\s*,\\s*class_name\\s*=\\s*"([A-Za-z0-9_]+)"`).exec(WRANGLER);
  if (match?.[1] === undefined) {
    throw new Error(`binding ${binding} introuvable dans wrangler.toml`);
  }
  return match[1];
}

describe('src/index.ts : exports de jonction', () => {
  it.each(['INVOICE_SEQUENCER', 'AGENT_HINDSIGHT_MEMORY'])('le binding %s est servi par une classe exportée sous le class_name exact de wrangler.toml', (binding) => {
    const className = classNameOfBinding(binding);
    const exported: unknown = Reflect.get(entry, className);
    expect(typeof exported).toBe('function');
    expect(Reflect.get(exported as object, 'name')).toBe(className);
  });

  it('les classes DO sont aussi les classes du coeur', () => {
    expect(entry.InvoiceSequencerDO.name).toBe('InvoiceSequencerDO');
    expect(entry.AgentHindsightMemoryDO.name).toBe('AgentHindsightMemoryDO');
  });

  it('API publique : createPipelineDeps et createSqlCpaMandatePresence sont des fonctions', () => {
    expect(typeof entry.createPipelineDeps).toBe('function');
    expect(typeof entry.createSqlCpaMandatePresence).toBe('function');
  });

  it('le manifeste de routes généré reste ré-exporté', () => {
    expect(Array.isArray(entry.routeManifest)).toBe(true);
    expect(entry.routeManifest.length).toBeGreaterThan(0);
    expect(entry.PACKAGE_NAME).toBe('@fisca/api-hono');
  });

  it("ne définit aucun gestionnaire fetch par défaut (ouverture D1 par identifiant non définie, provisionnement P4-C)", () => {
    expect('default' in entry).toBe(false);
  });
});
