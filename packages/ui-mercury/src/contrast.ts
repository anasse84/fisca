export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX6 = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/;

export function parseHexColor(hex: string): Rgb {
  const m = HEX6.exec(hex);
  if (m === null) {
    throw new Error(`Couleur hexadécimale invalide : ${hex}`);
  }
  return {
    r: parseInt(m[1] ?? '', 16),
    g: parseInt(m[2] ?? '', 16),
    b: parseInt(m[3] ?? '', 16),
  };
}

function linearize(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG 2.x (affichage uniquement, aucune valeur monétaire). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const a = relativeLuminance(parseHexColor(foregroundHex));
  const b = relativeLuminance(parseHexColor(backgroundHex));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
