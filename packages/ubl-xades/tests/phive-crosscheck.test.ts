import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateUblInvoiceXml, type UblInvoiceInput } from '../src/index.ts';
import { buildFullInput, buildInput, PREVIOUS_HASH_HEX, retentionRule, stampDutyRule, TYPE_CODES } from './support/fixtures.ts';
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

  /**
   * Débours, retenue de garantie, timbre, PIH/ICV : comportement RÉEL de PHIVE (EN 16931) consigné, jamais contourné.
   * XML neutralisé du mapping Doc_07 (voir ci-dessus) ; les règles restantes sont celles qui sortent du mapping marocain :
   *  - BR-O-02 / BR-O-04 : une ligne ou une charge « hors champ » (O) interdit l'identifiant TVA du vendeur ; le mapping Doc_07 place l'IF dans PartyTaxScheme ;
   *  - BR-O-11 / BR-O-12 : une facture avec un sous-total O ne peut contenir d'autre catégorie : mélanger débours (ou timbre) et lignes taxées est refusé ;
   *  - BR-CO-16 : la retenue réduit PayableAmount sans PrepaidAmount, ce que la formule d'EN 16931 n'admet pas ;
   *  - BR-CL-24 : le type MIME text/plain de l'empreinte PIH n'est pas dans la liste MIMEMediaType d'EN 16931.
   */
  const service = { descriptionFr: 'Travaux', quantityMilli: 1000, unitPriceCents: 100000, vatRateBps: 2000 } as const;
  const debours = { descriptionFr: 'Débours', quantityMilli: 1000, unitPriceCents: 50000, vatRateBps: 0, isDisbursementDebours: true } as const;
  const withoutSellerTaxScheme = (xml: string): string => xml.replace(/<cac:PartyTaxScheme>.*?<\/cac:PartyTaxScheme>/g, '');

  const scenarios: readonly (readonly [string, UblInvoiceInput, readonly string[]])[] = [
    ['débours seul', { ...buildInput('380'), lines: [debours] }, ['BR-O-02']],
    ['débours mêlés à des lignes taxées (BR-O-11)', { ...buildInput('380'), lines: [service, debours] }, ['BR-O-02', 'BR-O-11', 'BR-O-12']],
    ['retenue de garantie 7 %', { ...buildInput('380'), retention: retentionRule(700) }, ['BR-CO-16']],
    ['timbre espèces 25 bps', { ...buildInput('380'), stampDuty: stampDutyRule(10000) }, ['BR-O-04', 'BR-O-11', 'BR-O-12']],
    ['PIH et ICV', { ...buildInput('380'), pih: { icvCounter: 2, previousPiHash: PREVIOUS_HASH_HEX } }, ['BR-CL-24']],
    ['document complet', buildFullInput('380'), ['BR-CL-24', 'BR-CO-16', 'BR-O-02', 'BR-O-04', 'BR-O-11', 'BR-O-12']],
  ];

  it.each(scenarios)('%s : règles EN 16931 réellement violées', async (_name, input, rules) => {
    const report = await server.validate(neutraliseMappingForDiagnostic(generateUblInvoiceXml(input)));
    expect(report.valid).toBe(false);
    expect(errorRules(report)).toEqual([...rules]);
  });

  it('débours seul : valide EN 16931 sans l’identifiant TVA du vendeur (BR-O-02 vient du mapping de l’IF)', async () => {
    const xml = withoutSellerTaxScheme(neutraliseMappingForDiagnostic(generateUblInvoiceXml({ ...buildInput('380'), lines: [debours] })));
    const report = await server.validate(xml);
    expect(report.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('débours mêlés à des lignes taxées : BR-O-11 et BR-O-12 persistent même sans identifiant TVA du vendeur', async () => {
    const xml = withoutSellerTaxScheme(neutraliseMappingForDiagnostic(generateUblInvoiceXml({ ...buildInput('380'), lines: [service, debours] })));
    const rules = errorRules(await server.validate(xml));
    expect(rules).toContain('BR-O-11');
    expect(rules).toContain('BR-O-12');
  });

  it('PIH et ICV : la structure (ID, pièce jointe, nom de fichier) ne viole que BR-CL-24', async () => {
    const report = await server.validate(neutraliseMappingForDiagnostic(generateUblInvoiceXml({ ...buildInput('380'), pih: { icvCounter: 2, previousPiHash: PREVIOUS_HASH_HEX } })));
    expect(report.issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.rule)).toEqual(['BR-CL-24']);
  });

  it('couvre les cinq types', () => {
    expect(TYPE_CODES).toHaveLength(5);
  });
});
