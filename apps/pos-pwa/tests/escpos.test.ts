import { describe, expect, it } from 'vitest';
import { EscPosBuilder, PRINTER_PROFILE_58_CP858, PRINTER_PROFILE_80_CP864, columnsForWidth } from '../src/printing/escpos.ts';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const builder = (): EscPosBuilder => new EscPosBuilder(PRINTER_PROFILE_58_CP858);

describe('encodeur ESC/POS : octets exacts', () => {
  it('init : ESC @ puis ESC t (page de code du profil, 19 pour CP858)', () => {
    expect(hex(builder().init().build())).toBe('1b 40 1b 74 13');
    expect(hex(new EscPosBuilder(PRINTER_PROFILE_80_CP864).init().build())).toBe('1b 40 1b 74 16');
    expect(hex(new EscPosBuilder({ ...PRINTER_PROFILE_58_CP858, encoding: 'UTF8' }).init().build())).toBe('1b 40');
  });

  it('alignement : ESC a 0 / 1 / 2', () => {
    expect(hex(builder().align('left').align('center').align('right').build())).toBe('1b 61 00 1b 61 01 1b 61 02');
  });

  it('gras : ESC E 1 / 0 ; taille : GS ! n', () => {
    expect(hex(builder().bold(true).bold(false).build())).toBe('1b 45 01 1b 45 00');
    expect(hex(builder().size(2, 2).size(1, 1).build())).toBe('1d 21 11 1d 21 00');
    expect(() => builder().size(9, 1)).toThrow();
  });

  it('texte : octets de la page de code, ligne : + LF', () => {
    expect(hex(builder().line('Pain é').build())).toBe('50 61 69 6e 20 82 0a');
  });

  it('avance papier : ESC d n ; coupe partielle : GS V 66 0', () => {
    expect(hex(builder().feed(3).cut().build())).toBe('1b 64 03 1d 56 42 00');
  });

  it('ligne de séparation : tirets sur toute la largeur (32 colonnes en 58 mm, 48 en 80 mm)', () => {
    expect(columnsForWidth(58)).toBe(32);
    expect(columnsForWidth(80)).toBe(48);
    expect(builder().separator().build()).toHaveLength(33);
    expect(new EscPosBuilder(PRINTER_PROFILE_80_CP864).separator().build()).toHaveLength(49);
  });

  it('QR natif GS ( k : modèle 2, taille de module, correction M, stockage, impression', () => {
    const data = 'AB';
    const out = hex(builder().qr(data, { moduleSize: 6, errorCorrection: 'M' }).build());
    expect(out).toBe(
      [
        '1d 28 6b 04 00 31 41 32 00', // modèle 2
        '1d 28 6b 03 00 31 43 06', // taille du module
        '1d 28 6b 03 00 31 45 31', // correction d'erreur M (49)
        '1d 28 6b 05 00 31 50 30 41 42', // stockage : pL = len + 3
        '1d 28 6b 03 00 31 51 30', // impression
      ].join(' '),
    );
  });

  it('QR : longueur stockée sur deux octets (pL pH) pour une donnée de 300 octets', () => {
    const bytes = builder().qr('x'.repeat(300)).build();
    const text = hex(bytes);
    expect(text).toContain('1d 28 6b 2f 01 31 50 30'); // 303 = 0x012f
  });

  it('QR : refuse une donnée vide, une taille de module hors 1–16, une donnée au-delà de 7 089 octets', () => {
    expect(() => builder().qr('')).toThrow();
    expect(() => builder().qr('a', { moduleSize: 17 })).toThrow();
    expect(() => builder().qr('a'.repeat(7090))).toThrow();
  });

  it('tiroir-caisse : ESC p 0 25 250', () => {
    expect(hex(builder().openDrawer().build())).toBe('1b 70 00 19 fa');
  });

  it('build renvoie une copie : le constructeur reste réutilisable', () => {
    const b = builder().init();
    const first = b.build();
    b.line('x');
    expect(first).toHaveLength(5);
    expect(b.build().length).toBeGreaterThan(5);
  });
});
