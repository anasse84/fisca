import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.ts';

describe('@fisca/crypto-e2ee', () => {
  it('exporte son nom de paquet', () => {
    expect(pkg.PACKAGE_NAME).toBe('@fisca/crypto-e2ee');
  });

  it('exporte le contrat CTR-COD-08 e2ee-engine', () => {
    expect(typeof pkg.encryptFieldWithAad).toBe('function');
    expect(typeof pkg.decryptFieldWithAad).toBe('function');
    expect(typeof pkg.computeBlindIndex128).toBe('function');
  });
});
