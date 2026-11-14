import { describe, expect, it } from 'vitest';
import { sha256Hex, validateEvidenceFile, validateEvidenceSelection } from './evidence.ts';
import type { EvidencePolicy } from './ports-ops.ts';

const POLICY: EvidencePolicy = { maxFileBytes: 500, maxFiles: 2, allowedMimeTypes: ['application/pdf', 'image/png'] };
const f = (name: string, size: number, type: string) => ({ name, size, type });

describe('validation côté client des preuves (valeurs fournies par le port)', () => {
  it('accepte un fichier conforme à la politique', () => expect(validateEvidenceFile(f('a.pdf', 500, 'application/pdf'), POLICY)).toBeNull());
  it('refuse trop gros, vide, ou type non autorisé', () => {
    expect(validateEvidenceFile(f('a.pdf', 501, 'application/pdf'), POLICY)).toBe('tooLarge');
    expect(validateEvidenceFile(f('a.pdf', 0, 'application/pdf'), POLICY)).toBe('empty');
    expect(validateEvidenceFile(f('a.exe', 10, 'application/x-msdownload'), POLICY)).toBe('type');
    expect(validateEvidenceFile(f('a', 10, ''), POLICY)).toBe('type');
  });
  it('limite le nombre de fichiers', () => {
    const three = [f('1.pdf', 1, 'application/pdf'), f('2.pdf', 1, 'application/pdf'), f('3.pdf', 1, 'application/pdf')];
    expect(validateEvidenceSelection(three, POLICY, 0)).toEqual({ tooMany: true });
    expect(validateEvidenceSelection(three.slice(0, 2), POLICY, 1)).toEqual({ tooMany: true });
    expect(validateEvidenceSelection(three.slice(0, 2), POLICY, 0)).toEqual({ tooMany: false });
  });
});

describe('empreinte SHA-256 par WebCrypto', () => {
  it('vecteur connu : « abc »', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('fichier vide', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('64 hexadécimaux minuscules', async () => {
    expect(await sha256Hex(new Blob([new Uint8Array([0, 255, 7])]))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('affichage des tailles de la politique', () => {
  it('unité exacte la plus grande, sans arrondi', async () => {
    const { formatBytes } = await import('./evidence.ts');
    expect(formatBytes(2_000_000)).toEqual({ value: 2, unit: 'mb' });
    expect(formatBytes(512_000)).toEqual({ value: 512, unit: 'kb' });
    expect(formatBytes(1_500_000)).toEqual({ value: 1500, unit: 'kb' });
    expect(formatBytes(1_234_567)).toEqual({ value: 1_234_567, unit: 'byte' });
    expect(formatBytes(5)).toEqual({ value: 5, unit: 'byte' });
  });
});
