/** PDF minimal VALIDE (xref classique) fabriqué pour les tests : aucune donnée réelle. */
export interface MinimalPdfOptions {
  /** Ajoute /Annots [] direct sur la page. */
  readonly withAnnots?: boolean;
  /** Ajoute un /AcroForm préexistant au catalogue (non supporté : échec fermé attendu). */
  readonly withAcroForm?: boolean;
  /** Termine le fichier sans retour à la ligne final. */
  readonly noTrailingNewline?: boolean;
}

export function buildMinimalPdf(options: MinimalPdfOptions = {}): Uint8Array {
  let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  const add = (body: string): void => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  const stream = 'BT /F1 12 Tf 72 720 Td (Facture de test) Tj ET';
  add(`<< /Type /Catalog /Pages 2 0 R${options.withAcroForm === true ? ' /AcroForm << /Fields [] >>' : ''} >>`);
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${options.withAnnots === true ? ' /Annots []' : ''} >>`);
  add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('<< /Producer (Fisca test) /Title (Facture de test) >>');
  const xrefOffset = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info 6 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>] >>\nstartxref\n${xrefOffset}\n%%EOF${options.noTrailingNewline === true ? '' : '\n'}`;
  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index += 1) bytes[index] = out.charCodeAt(index) & 0xff;
  return bytes;
}

/** Variante à flux xref (PDF 1.5) : doit être refusée en échec fermé. */
export function buildXrefStreamPdf(): Uint8Array {
  const out = '%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Type /XRef /Size 4 /W [1 2 1] /Root 1 0 R /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n78\n%%EOF\n';
  return Uint8Array.from(out, (character) => character.charCodeAt(0));
}
