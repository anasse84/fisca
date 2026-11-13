import { generateUblInvoiceXml, resolveSchema, type UblDocumentKind } from '../src/index.ts';
import { buildFullInput, buildInput, TYPE_CODES } from '../tests/support/fixtures.ts';
import { validateWithXmllint } from '../tests/support/xmllint.ts';

/** Valide un document généré par type (380, 381, 383, 386, 389) contre le XSD OASIS UBL 2.1 officiel, avec xmllint. */
const KIND_BY_TYPE: Readonly<Record<(typeof TYPE_CODES)[number], UblDocumentKind>> = {
  '380': 'invoice',
  '381': 'credit-note',
  '383': 'debit-note',
  '386': 'invoice',
  '389': 'invoice',
};

process.stdout.write(
  'Schéma utilisé : OASIS UBL 2.1 officiel (packages/ubl-xades/xsd) ; profil : cius-ma-provisional (PROVISOIRE, non publié par la DGI)\n',
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
    process.stdout.write(`  type ${code} complet (débours + timbre + PIH/ICV${code === '381' || code === '383' ? '' : ' + retenue'}) : valide\n`);
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
