import { generateUblInvoiceXml, resolveSchema, schemaKindOfTypeCode, type UblDocumentKind } from '../src/index.ts';
import { buildFullInput, buildInput, TYPE_CODES } from '../tests/support/fixtures.ts';
import { validateWithXmllint } from '../tests/support/xmllint.ts';

/** Valide un document généré par type (380, 381, 383, 386, 389 ; le 383 est émis en Invoice) contre le XSD OASIS UBL 2.1 officiel, avec xmllint. */
const KIND_BY_TYPE: Readonly<Record<(typeof TYPE_CODES)[number], UblDocumentKind>> = {
  '380': schemaKindOfTypeCode('380'),
  '381': schemaKindOfTypeCode('381'),
  '383': schemaKindOfTypeCode('383'),
  '386': schemaKindOfTypeCode('386'),
  '389': schemaKindOfTypeCode('389'),
};

process.stdout.write(
  'Schéma utilisé : OASIS UBL 2.1 officiel (packages/ubl-xades/xsd ; 383 émis en Invoice) ; profil provisoire cius-ma-provisional, écarts PHIVE connus : BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24\n',
);

let failures = 0;
for (const code of TYPE_CODES) {
  const schema = resolveSchema(KIND_BY_TYPE[code], '2.1');
  const result = validateWithXmllint(generateUblInvoiceXml(buildInput(code)), schema.path);
  if (result.valid) {
    process.stdout.write(`  type ${code} : valide (${schema.path.split('/').pop() ?? ''})\n`);
  } else {
    failures += 1;
    process.stdout.write(`  type ${code} : INVALIDE\n${result.output}\n`);
  }
}
// Documents complets : débours (catégorie O), droit de timbre (AllowanceCharge), PIH/ICV (AdditionalDocumentReference), retenue de garantie (Invoice).
for (const code of TYPE_CODES) {
  const schema = resolveSchema(KIND_BY_TYPE[code], '2.1');
  const result = validateWithXmllint(generateUblInvoiceXml(buildFullInput(code)), schema.path);
  if (result.valid) {
    process.stdout.write(`  type ${code} complet (débours + timbre + PIH/ICV${code === '381' ? '' : ' + retenue'}) : valide\n`);
  } else {
    failures += 1;
    process.stdout.write(`  type ${code} complet : INVALIDE\n${result.output}\n`);
  }
}
if (failures > 0) {
  process.stdout.write(`${failures} document(s) invalide(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('10 documents valides (5 simples, 5 complets)\n');
}
