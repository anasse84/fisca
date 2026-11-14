import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface XmllintResult {
  readonly valid: boolean;
  readonly output: string;
}

/** Valide un XML contre un XSD avec xmllint, sans shell (spawnSync, arguments séparés). */
export function validateWithXmllint(xml: string, xsdPath: string): XmllintResult {
  const dir = mkdtempSync(join(tmpdir(), 'fisca-xsd-'));
  const file = join(dir, 'document.xml');
  try {
    writeFileSync(file, xml, 'utf8');
    const run = spawnSync('xmllint', ['--noout', '--schema', xsdPath, file], { encoding: 'utf8' });
    if (run.error !== undefined) {
      throw new Error('xmllint est introuvable ou inutilisable : installer libxml2 (dnf install libxml2).');
    }
    return { valid: run.status === 0, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
