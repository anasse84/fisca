import { describe, expect, it } from 'vitest';
import { applicationResponseSchemaPath, CdvParseError, parseCdvApplicationResponse, PROVISIONAL_CDV_RESPONSE_CODE_PROFILE } from '../src/index.ts';
import { buildCdvXml } from './support/cdv-fixtures.ts';
import { validateWithXmllint } from './support/xmllint.ts';

describe('parseCdvApplicationResponse', () => {
  it('analyse un ApplicationResponse valide', () => {
    expect(parseCdvApplicationResponse(buildCdvXml())).toEqual({
      responseId: 'CDV-0001',
      issueDate: '2026-11-13',
      responseCode: 'AP',
      status: 'APPROUVEE',
      invoiceReference: 'FAC-2026-000001',
    });
  });

  it.each(Object.entries(PROVISIONAL_CDV_RESPONSE_CODE_PROFILE))('code %s -> %s (profil provisoire)', (code, status) => {
    expect(parseCdvApplicationResponse(buildCdvXml({ responseCode: code })).status).toBe(status);
  });

  it('les fixtures valides passent le XSD OASIS ApplicationResponse (xmllint)', () => {
    for (const code of Object.keys(PROVISIONAL_CDV_RESPONSE_CODE_PROFILE)) {
      const result = validateWithXmllint(buildCdvXml({ responseCode: code }), applicationResponseSchemaPath());
      expect(result.valid, result.output).toBe(true);
    }
  });

  it('refuse un DOCTYPE (échec fermé, code constant)', () => {
    const xml = buildCdvXml({ extraPrologue: '<!DOCTYPE x [<!ENTITY e "boum">]>' });
    expect(() => parseCdvApplicationResponse(xml)).toThrow(CdvParseError);
    expect(() => parseCdvApplicationResponse(xml)).toThrow(/CDV_XML_DOCTYPE_FORBIDDEN/);
  });

  it('code de réponse inconnu -> échec fermé', () => {
    expect(() => parseCdvApplicationResponse(buildCdvXml({ responseCode: 'ZZ' }))).toThrow(/CDV_RESPONSE_CODE_UNKNOWN/);
    expect(() => parseCdvApplicationResponse(buildCdvXml({ responseCode: 'constructor' }))).toThrow(CdvParseError);
  });

  it('un profil de remplacement est pris en compte', () => {
    expect(parseCdvApplicationResponse(buildCdvXml({ responseCode: 'ZZ' }), { ZZ: 'REFUSEE' }).status).toBe('REFUSEE');
  });

  it('refuse document non ApplicationResponse, mal formé, champ manquant ou trop gros', () => {
    expect(() => parseCdvApplicationResponse('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>')).toThrow(/CDV_NOT_APPLICATION_RESPONSE/);
    expect(() => parseCdvApplicationResponse('<a><b></a>')).toThrow(/CDV_XML_MALFORMED/);
    expect(() => parseCdvApplicationResponse(buildCdvXml().replace(/<cac:DocumentReference>[\s\S]*<\/cac:DocumentReference>/, ''))).toThrow(/CDV_STRUCTURE_INVALID/);
    expect(() => parseCdvApplicationResponse(' '.repeat(262_145))).toThrow(/CDV_XML_TOO_LARGE/);
  });

  it('les erreurs ne contiennent aucune donnée du document', () => {
    const secret = 'ICE-000970000000097-NOM-CLIENT';
    for (const xml of [buildCdvXml({ responseCode: secret }), buildCdvXml({ invoiceNumber: `${secret} avec espace` }), `<a>${secret}`]) {
      const error = (() => {
        try {
          parseCdvApplicationResponse(xml);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(CdvParseError);
      expect(String((error as CdvParseError).message)).not.toContain(secret);
    }
  });
});
