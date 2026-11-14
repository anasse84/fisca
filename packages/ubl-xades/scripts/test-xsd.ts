import { buildFacturXRequest, generateUblInvoiceXml, resolveSchema, schemaKindOfTypeCode, signUblXades, verifyUblXades, type UblDocumentKind } from '../src/index.ts';
import { applicationResponseSchemaPath, PROVISIONAL_CDV_RESPONSE_CODE_PROFILE } from '../src/clearance/index.ts';
import { buildCdvXml } from '../tests/support/cdv-fixtures.ts';
import { buildFullInput, buildInput, TYPE_CODES } from '../tests/support/fixtures.ts';
import { fromBase64 } from '../src/signature/bytes.ts';
import { createTestIdentity, createTestTimestampProvider, type KeyKind } from '../tests/support/test-pki.ts';
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
// XML tel qu'il sera embarqué dans le PDF/A-3b : octets de `xmlBase64` du corps de POST /facturx (T-P2A-06), validés contre le XSD OASIS.
process.stdout.write('XML embarqué (corps /facturx, PDF/A-3b avec facture UBL embarquée, profil provisoire) :\n');
let embeddedCount = 0;
for (const code of TYPE_CODES) {
  const input = buildFullInput(code);
  const request = buildFacturXRequest({
    input,
    xml: generateUblInvoiceXml(input),
    xhubUuid: '3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23',
    verificationBaseUrl: 'https://verif.exemple.test',
  });
  const schema = resolveSchema(KIND_BY_TYPE[code], '2.1');
  const result = validateWithXmllint(new TextDecoder().decode(fromBase64(request.xmlBase64)), schema.path);
  if (result.valid) {
    embeddedCount += 1;
    process.stdout.write(`  type ${code} embarqué : valide (base64 décodé, ${schema.path.split('/').pop() ?? ''})\n`);
  } else {
    failures += 1;
    process.stdout.write(`  type ${code} embarqué : INVALIDE\n${result.output}\n`);
  }
}
// Documents SIGNÉS (XAdES-Baseline-T dans UBLExtensions, clés éphémères de TEST, TSA de test non qualifiée) : toujours valides contre le XSD OASIS.
process.stdout.write('Documents signés : signature de TEST (clés éphémères WebCrypto, TSA de test non qualifiée), profil provisoire\n');
let signedCount = 0;
for (const kind of ['ecdsa-p256', 'rsa-2048'] as const satisfies readonly KeyKind[]) {
  const identity = await createTestIdentity(kind);
  const tsa = await createTestTimestampProvider();
  for (const code of TYPE_CODES) {
    const schema = resolveSchema(KIND_BY_TYPE[code], '2.1');
    const signed = await signUblXades(generateUblInvoiceXml(buildFullInput(code)), {
      certificateDer: identity.certificateDer,
      signer: identity.signer,
      timestampProvider: tsa,
      signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)),
    });
    const verified = await verifyUblXades(signed.xml);
    const result = validateWithXmllint(signed.xml, schema.path);
    if (result.valid && verified.valid) {
      signedCount += 1;
      process.stdout.write(`  type ${code} complet signé (${kind}) : valide, signature vérifiée\n`);
    } else {
      failures += 1;
      process.stdout.write(`  type ${code} complet signé (${kind}) : INVALIDE (${verified.failure ?? 'XSD'})\n${result.output}\n`);
    }
  }
}
// CDV (UBL 2.1 ApplicationResponse, profil de codes provisoire) : une fixture par code, validée contre le XSD OASIS vendorisé.
process.stdout.write('CDV ApplicationResponse (XSD OASIS UBL 2.1 ApplicationResponse ; table de codes provisoire, hypothèse B-13) :\n');
let cdvCount = 0;
for (const code of Object.keys(PROVISIONAL_CDV_RESPONSE_CODE_PROFILE)) {
  const result = validateWithXmllint(buildCdvXml({ responseCode: code }), applicationResponseSchemaPath());
  if (result.valid) {
    cdvCount += 1;
    process.stdout.write(`  CDV code ${code} : valide\n`);
  } else {
    failures += 1;
    process.stdout.write(`  CDV code ${code} : INVALIDE\n${result.output}\n`);
  }
}
if (failures > 0) {
  process.stdout.write(`${failures} document(s) invalide(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${10 + embeddedCount + signedCount + cdvCount} documents valides (5 simples, 5 complets, ${embeddedCount} embarqués, ${signedCount} signés, ${cdvCount} CDV)\n`);
}
