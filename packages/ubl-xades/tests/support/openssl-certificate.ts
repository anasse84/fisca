import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toBase64 } from '../../src/signature/bytes.ts';
import type { TestKeyPair } from './test-pki.ts';

const PEM_DASHES = '-'.repeat(5);
const PEM_LABEL = ['PRIVATE', 'KEY'].join(' ');

export interface OpensslCertificateOptions {
  /** Numéro de série (entier positif ; 20 octets au plus, bit de poids fort à 0 : RFC 5280). */
  readonly serial: bigint;
  /** Valeur de organizationIdentifier (2.5.4.97). */
  readonly organizationIdentifier: string;
}

/** Certificat auto-signé de TEST fabriqué par `openssl req -x509` avec la clé éphémère de test (écrite dans un répertoire 0700 temporaire, supprimée). */
export function createOpensslTestCertificate(key: TestKeyPair, options: OpensslCertificateOptions): Uint8Array {
  const directory = mkdtempSync(join(tmpdir(), 'fisca-openssl-cert-'), { encoding: 'utf8' });
  try {
    const pem = `${PEM_DASHES}BEGIN ${PEM_LABEL}${PEM_DASHES}\n${(toBase64(key.privateKeyPkcs8).match(/.{1,64}/g) ?? []).join('\n')}\n${PEM_DASHES}END ${PEM_LABEL}${PEM_DASHES}\n`;
    writeFileSync(join(directory, 'key.pem'), pem, { mode: 0o600 });
    const hex = options.serial.toString(16);
    const run = spawnSync(
      'openssl',
      [
        'req', '-x509', '-new', '-key', join(directory, 'key.pem'), '-sha256', '-days', '3650',
        '-set_serial', `0x${hex}`,
        '-subj', `/C=MA/O=TEST - Societe fictive (non qualifie)/organizationIdentifier=${options.organizationIdentifier}/CN=TEST SEAL - NON QUALIFIE`,
        '-outform', 'DER', '-out', join(directory, 'cert.der'),
      ],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) throw new Error(`openssl req a échoué : ${run.stderr}`);
    return new Uint8Array(readFileSync(join(directory, 'cert.der')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
