import { encodeText } from './codepage.ts';
import type { EncodeOptions, TextEncoding } from './codepage.ts';

/**
 * Encodeur ESC/POS pur : aucune E/S, aucune horloge. Séquences : ESC @ (init), ESC t (page de code), ESC a (alignement),
 * ESC E (gras), GS ! (taille), ESC d (avance), GS V 66 (coupe partielle), GS ( k (QR natif, modèle 2), ESC p (tiroir-caisse).
 * Les numéros de page de code ESC t sont ceux de la famille Epson (19 = PC858, 22 = PC864) : ils vivent dans le profil
 * de l'imprimante et s'ajustent sans toucher au code (à valider sur le matériel réel, non testé ici).
 */

export type PaperWidthMm = 58 | 80;

export interface PrinterProfile {
  readonly paperWidthMm: PaperWidthMm;
  readonly encoding: TextEncoding;
  /** Numéro envoyé à ESC t ; ignoré en UTF8. */
  readonly codePageId: number;
  readonly unencodable?: EncodeOptions['unencodable'];
}

/** Police A : 12 points par caractère, 384 points en 58 mm, 576 en 80 mm. */
export function columnsForWidth(width: PaperWidthMm): number {
  return width === 58 ? 32 : 48;
}

export const PRINTER_PROFILE_58_CP858: PrinterProfile = { paperWidthMm: 58, encoding: 'CP858', codePageId: 19 };
export const PRINTER_PROFILE_80_CP858: PrinterProfile = { paperWidthMm: 80, encoding: 'CP858', codePageId: 19 };
export const PRINTER_PROFILE_58_CP864: PrinterProfile = { paperWidthMm: 58, encoding: 'CP864', codePageId: 22 };
export const PRINTER_PROFILE_80_CP864: PrinterProfile = { paperWidthMm: 80, encoding: 'CP864', codePageId: 22 };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Alignment = 'left' | 'center' | 'right';
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  readonly moduleSize?: number;
  readonly errorCorrection?: QrErrorCorrection;
}

const QR_EC_CODE: Readonly<Record<QrErrorCorrection, number>> = { L: 48, M: 49, Q: 50, H: 51 };
/** Capacité maximale du stockage QR natif (octets). */
const QR_MAX_BYTES = 7089;

export class EscPosBuilder {
  private readonly bytes: number[] = [];
  private readonly profile: PrinterProfile;

  constructor(profile: PrinterProfile) {
    this.profile = profile;
  }

  private push(...values: number[]): this {
    this.bytes.push(...values);
    return this;
  }

  init(): this {
    this.push(ESC, 0x40);
    if (this.profile.encoding !== 'UTF8') this.push(ESC, 0x74, this.profile.codePageId);
    return this;
  }

  align(alignment: Alignment): this {
    return this.push(ESC, 0x61, alignment === 'left' ? 0 : alignment === 'center' ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  size(width: number, height: number): this {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > 8 || height < 1 || height > 8) {
      throw new RangeError('Taille de caractère : largeur et hauteur entières de 1 à 8.');
    }
    return this.push(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  text(value: string): this {
    const encoded = encodeText(value, this.profile.encoding, this.profile.unencodable === undefined ? {} : { unencodable: this.profile.unencodable });
    for (const byte of encoded) this.bytes.push(byte);
    return this;
  }

  line(value: string): this {
    return this.text(value).push(LF);
  }

  feed(lines: number): this {
    if (!Number.isInteger(lines) || lines < 0 || lines > 255) throw new RangeError('Avance papier : entier de 0 à 255.');
    return this.push(ESC, 0x64, lines);
  }

  separator(char = '-'): this {
    return this.line(char.repeat(columnsForWidth(this.profile.paperWidthMm)));
  }

  qr(data: string, options: QrOptions = {}): this {
    const payload = new TextEncoder().encode(data);
    const moduleSize = options.moduleSize ?? 6;
    if (payload.length === 0) throw new RangeError('QR : donnée vide.');
    if (payload.length > QR_MAX_BYTES) throw new RangeError(`QR : ${QR_MAX_BYTES} octets au plus.`);
    if (!Number.isInteger(moduleSize) || moduleSize < 1 || moduleSize > 16) throw new RangeError('QR : taille de module entière de 1 à 16.');
    const storeLength = payload.length + 3;
    this.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize);
    this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, QR_EC_CODE[options.errorCorrection ?? 'M']);
    this.push(GS, 0x28, 0x6b, storeLength & 0xff, (storeLength >> 8) & 0xff, 0x31, 0x50, 0x30);
    for (const byte of payload) this.bytes.push(byte);
    return this.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  }

  cut(): this {
    return this.push(GS, 0x56, 0x42, 0x00);
  }

  openDrawer(): this {
    return this.push(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
