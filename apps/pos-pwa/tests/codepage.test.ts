import { describe, expect, it } from 'vitest';
import { UnencodableTextError, encodeText, shapeArabicForPrinter } from '../src/printing/codepage.ts';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('encodage texte imprimante', () => {
  it('CP858 : ASCII inchangé, accents et euro aux octets de la table', () => {
    expect(hex(encodeText('Total 12,50', 'CP858'))).toBe(hex(new TextEncoder().encode('Total 12,50')));
    expect(hex(encodeText('é à Ç €', 'CP858'))).toBe('822085208020d5');
  });

  it('UTF-8 : é → c3 a9', () => {
    expect(hex(encodeText('é', 'UTF8'))).toBe('c3a9');
  });

  it('caractère non encodable : erreur typée en mode strict, « ? » en mode remplacement', () => {
    expect(() => encodeText('ⵜ', 'CP858', { unencodable: 'throw' })).toThrowError(UnencodableTextError);
    expect(hex(encodeText('aⵜb', 'CP858', { unencodable: 'replace' }))).toBe('613f62');
  });

  it('CP864 : lettre isolée ب → a9 ; lam-alef → ligature 9d', () => {
    expect(hex(encodeText('ب', 'CP864'))).toBe('a9');
    expect(hex(encodeText('لا', 'CP864'))).toBe('9d');
  });

  it('CP864 : mise en forme contextuelle et ordre visuel (« با » → alef finale puis ba initiale : a8 c8)', () => {
    expect(hex(encodeText('با', 'CP864'))).toBe('a8c8');
  });

  it('CP864 : le latin et les chiffres gardent leur ordre dans une ligne arabe', () => {
    const bytes = encodeText('ب 12', 'CP864');
    const tail = new TextDecoder().decode(bytes.slice(0, 2));
    expect(tail).toBe('12');
    expect(shapeArabicForPrinter('12')).toBe('12');
  });

  it('CP864 : les lettres latines accentuées absentes de la page sont réduites à leur lettre de base (é → e)', () => {
    expect(hex(encodeText('é', 'CP864'))).toBe('65');
    expect(() => encodeText('ⵜ', 'CP864', { unencodable: 'throw' })).toThrowError(UnencodableTextError);
  });
});
