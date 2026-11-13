import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateUblInvoiceXml } from '../src/index.ts';
import { buildInput, TYPE_CODES } from './support/fixtures.ts';
import { findFiscalJavaJar, phiveAvailability, type PhiveReport, type PhiveServer, startPhiveServer } from './support/phive.ts';

/**
 * Conformité croisée du mode de secours TypeScript (ADR-09) contre le validateur Java PHIVE du ticket T-P2A-01.
 *
 * Condition d'exécution EXPLICITE (loi 10 : aucun test ignoré par marqueur littéral) : le test s'exécute si le jar de containers/fiscal-java et
 * Java 21 sont disponibles. Sinon l'absence est journalisée sur stderr avec la raison, et la variable
 * FISCA_REQUIRE_PHIVE=1 (à positionner en CI et avant une barrière) transforme cette absence en échec avec message clair.
 */
const availability = phiveAvailability();
const required = process.env['FISCA_REQUIRE_PHIVE'] === '1';
const enabled = availability.available || required;
if (!enabled) {
  process.stderr.write(`[ubl-xades] contrôle croisé PHIVE NON exécuté (${availability.reason}). FISCA_REQUIRE_PHIVE=1 le rend obligatoire.\n`);
}

/** Règles EN 16931 que le mapping Doc_07 (schemeID MA:*, IF sans préfixe pays) viole légitimement. */
const MAPPING_RULES = ['BR-CL-10', 'BR-CL-11', 'BR-CO-09'] as const;

function errorRules(report: PhiveReport): string[] {
  return [...new Set(report.issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.rule))].sort();
}

/**
 * Diagnostic uniquement (jamais une sortie du générateur) : neutralise les trois écarts du mapping Doc_07 pour prouver que
 * le reste de la structure satisfait EN 16931 — schemeID MA:* retirés, IF préfixé du code pays.
 */
function neutraliseMappingForDiagnostic(xml: string): string {
  return xml
    .replace(/ schemeID="MA:[A-Z]+"/g, '')
    .replace(/(<cac:PartyTaxScheme><cbc:CompanyID>)(\d+)/g, '$1MA$2');
}

describe.runIf(enabled)('contrôle croisé PHIVE (EN 16931) du mode de secours TypeScript', { timeout: 60_000 }, () => {
  let server: PhiveServer;

  beforeAll(async () => {
    if (!availability.available) {
      throw new Error(`FISCA_REQUIRE_PHIVE=1 mais PHIVE est indisponible : ${availability.reason}`);
    }
    server = await startPhiveServer(findFiscalJavaJar() as string);
  }, 90_000);

  afterAll(async () => {
    if (server !== undefined) await server.stop();
  });

  it.each(['380', '381', '386', '389'] as const)(
    'type %s : seules les règles du mapping Doc_07 sont violées (comportement réel consigné)',
    async (code) => {
      const report = await server.validate(generateUblInvoiceXml(buildInput(code)));
      expect(report.ruleSet).toContain('EN 16931');
      expect(report.profile).toBe('cius-ma-provisional');
      expect(report.valid).toBe(false);
      expect(errorRules(report)).toEqual([...MAPPING_RULES]);
    },
  );

  it.each(['380', '381', '386', '389'] as const)(
    'type %s : valide EN 16931 une fois le mapping Doc_07 neutralisé (diagnostic)',
    async (code) => {
      const report = await server.validate(neutraliseMappingForDiagnostic(generateUblInvoiceXml(buildInput(code))));
      expect(report.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
      expect(report.valid).toBe(true);
    },
  );

  it('type 383 : EN 16931 n’a pas de syntaxe DebitNote, PHIVE rejette la racine (comportement réel consigné)', async () => {
    const report = await server.validate(generateUblInvoiceXml(buildInput('383')));
    expect(report.valid).toBe(false);
    expect(errorRules(report)).toEqual(['UBL-XSD']);
    expect(report.issues.map((issue) => issue.message).join(' ')).toContain("'DebitNote'");
  });

  it('couvre les cinq types', () => {
    expect(TYPE_CODES).toHaveLength(5);
  });
});
