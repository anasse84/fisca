import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateUblInvoiceXml, KNOWN_PHIVE_DEVIATION_RULE_IDS, signUblXades, type UblInvoiceInput } from '../src/index.ts';
import { createTestIdentity, createTestTimestampProvider } from './support/test-pki.ts';
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
/** Barrière G2 : CI posée OU FISCA_REQUIRE_PHIVE=1 → l'indisponibilité de PHIVE est un ÉCHEC, jamais un saut. */
const required = process.env['FISCA_REQUIRE_PHIVE'] === '1' || (process.env['CI'] ?? '') !== '';
const enabled = availability.available;
if (!enabled && !required) {
  process.stderr.write(`[ubl-xades] contrôle croisé PHIVE NON exécuté (${availability.reason}). FISCA_REQUIRE_PHIVE=1 le rend obligatoire.\n`);
}

if (required && !availability.available) {
  describe('contrôle croisé PHIVE obligatoire', () => {
    it('PHIVE doit être disponible (CI ou FISCA_REQUIRE_PHIVE=1)', () => {
      throw new Error(
        `Contrôle croisé PHIVE obligatoire (CI ou FISCA_REQUIRE_PHIVE=1) mais indisponible : ${availability.reason}. ` +
          'Construire le jar (cd containers/fiscal-java && mvn -q -B package -DskipTests) avec JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto.x86_64.',
      );
    });
  });
}

/**
 * Avertissements tolérés, listés explicitement (aucun n'est une erreur) :
 *  - UBL-CR-111 : l'ICV est porté par cbc:UUID d'une AdditionalDocumentReference (hypothèse non officielle, convention reprise de ZATCA) ;
 *  - UBL-CR-652 : schemeID MA:IF sur le CompanyID de PartyTaxScheme (mapping Doc_07) ;
 *  - UBL-CR-024 : avoir 381, cbc:UUID xHub dans BillingReference (obligatoire sur l’avoir, Doc_07).
 */
const TOLERATED_WARNINGS = ['UBL-CR-024', 'UBL-CR-111', 'UBL-CR-652'] as const;

/**
 * Avertissement propre à la présence d'UBLExtensions, constaté avec PHIVE (jamais une erreur) : UBL-CR-001 « un document UBL ne devrait pas
 * contenir d'extensions ». Il est inhérent au choix de Doc_07 § 07 (XAdES injecté dans UBLExtensions) ; toute autre règle nouvelle fait échouer.
 */
const SIGNED_DOCUMENT_EXTRA_WARNINGS: string[] = ['UBL-CR-001'];

function errorRules(report: PhiveReport): string[] {
  return [...new Set(report.issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.rule))].sort();
}

function warningRules(report: PhiveReport): string[] {
  return [...new Set(report.issues.filter((issue) => issue.severity === 'WARNING').map((issue) => issue.rule))].sort();
}

/** Facture standard : chaînage PIH/ICV présent (c'est lui qui produit BR-CL-24 : la liste connue est donc atteinte en entier). */
const standardInput = (code: (typeof TYPE_CODES)[number]): UblInvoiceInput => ({
  ...buildInput(code),
  pih: { icvCounter: 2, previousPiHash: PREVIOUS_HASH_HEX },
});

/**
 * Diagnostic uniquement (jamais une sortie du générateur) : neutralise les écarts du mapping Doc_07 pour prouver que
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
    server = await startPhiveServer(findFiscalJavaJar() as string);
  }, 90_000);

  afterAll(async () => {
    if (server !== undefined) await server.stop();
  });

  describe('facture standard : profil provisoire, écarts PHIVE connus seuls', () => {
    it.each(TYPE_CODES)('type %s : EXACTEMENT les écarts de KNOWN_PHIVE_DEVIATIONS (ni plus, ni moins)', async (code) => {
      const report = await server.validate(generateUblInvoiceXml(standardInput(code)));
      expect(report.ruleSet).toContain('EN 16931');
      expect(report.profile).toBe('cius-ma-provisional');
      expect(report.valid).toBe(false);
      expect(errorRules(report)).toEqual([...KNOWN_PHIVE_DEVIATION_RULE_IDS]);
      expect(warningRules(report).filter((rule) => !TOLERATED_WARNINGS.includes(rule as (typeof TOLERATED_WARNINGS)[number]))).toEqual([]);
      expect(warningRules(report)).toEqual(expect.arrayContaining(['UBL-CR-111', 'UBL-CR-652']));
    });

    it('type 383 émis en Invoice : aucune erreur de syntaxe (UBL-XSD) et aucune règle hors liste', async () => {
      const report = await server.validate(generateUblInvoiceXml(standardInput('383')));
      expect(errorRules(report)).not.toContain('UBL-XSD');
      expect(errorRules(report).filter((rule) => !KNOWN_PHIVE_DEVIATION_RULE_IDS.includes(rule))).toEqual([]);
    });

    it.each(['380', '381', '383', '386', '389'] as const)(
      'type %s sans PIH : la liste connue moins BR-CL-24 (celle-ci ne vient que du PIH)',
      async (code) => {
        const report = await server.validate(generateUblInvoiceXml(buildInput(code)));
        expect(errorRules(report)).toEqual(KNOWN_PHIVE_DEVIATION_RULE_IDS.filter((rule) => rule !== 'BR-CL-24'));
      },
    );

    it.each(['380', '381', '383', '386', '389'] as const)(
      'type %s : valide EN 16931 une fois les écarts connus neutralisés (diagnostic)',
      async (code) => {
        const report = await server.validate(neutraliseMappingForDiagnostic(generateUblInvoiceXml(buildInput(code))));
        expect(report.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
        expect(report.valid).toBe(true);
      },
    );

    it('PIH et ICV : la structure (ID, pièce jointe, nom de fichier) ne viole que BR-CL-24 une fois le mapping neutralisé', async () => {
      const report = await server.validate(neutraliseMappingForDiagnostic(generateUblInvoiceXml(standardInput('380'))));
      expect(errorRules(report)).toEqual(['BR-CL-24']);
    });
  });

  /**
   * Comportements connus du mélange débours/timbre/retenue : comportement RÉEL de PHIVE (EN 16931) consigné, jamais contourné.
   * XML neutralisé du mapping Doc_07 ; les règles restantes sont celles qui sortent du mapping marocain :
   *  - BR-O-02 / BR-O-04 : une ligne ou une charge « hors champ » (O) interdit l'identifiant TVA du vendeur ; le mapping Doc_07 place l'IF dans PartyTaxScheme ;
   *  - BR-O-11 / BR-O-12 : une facture avec un sous-total O ne peut contenir d'autre catégorie : mélanger débours (ou timbre) et lignes taxées est refusé ;
   *  - BR-CO-16 : la retenue réduit PayableAmount sans PrepaidAmount, ce que la formule d'EN 16931 n'admet pas ;
   *  - BR-CL-24 : le type MIME text/plain de l'empreinte PIH (écart connu).
   */
  describe('comportements connus du mélange débours/timbre/retenue', () => {
    const service = { descriptionFr: 'Travaux', quantityMilli: 1000, unitPriceCents: 100000, vatRateBps: 2000 } as const;
    const debours = { descriptionFr: 'Débours', quantityMilli: 1000, unitPriceCents: 50000, vatRateBps: 0, isDisbursementDebours: true } as const;
    const withoutSellerTaxScheme = (xml: string): string => xml.replace(/<cac:PartyTaxScheme>.*?<\/cac:PartyTaxScheme>/g, '');

    const scenarios: readonly (readonly [string, UblInvoiceInput, readonly string[]])[] = [
      ['débours seul', { ...buildInput('380'), lines: [debours] }, ['BR-O-02']],
      ['débours mêlés à des lignes taxées (BR-O-11)', { ...buildInput('380'), lines: [service, debours] }, ['BR-O-02', 'BR-O-11', 'BR-O-12']],
      ['retenue de garantie 7 %', { ...buildInput('380'), retention: retentionRule(700) }, ['BR-CO-16']],
      ['timbre espèces 25 bps', { ...buildInput('380'), stampDuty: stampDutyRule(10000) }, ['BR-O-04', 'BR-O-11', 'BR-O-12']],
      ['retenue de garantie 7 % sur 383 (racine Invoice)', { ...buildInput('383'), retention: retentionRule(700) }, ['BR-CO-16']],
      ['document complet 383 (Invoice, retenue, échéance)', buildFullInput('383'), ['BR-CL-24', 'BR-CO-16', 'BR-O-02', 'BR-O-04', 'BR-O-11', 'BR-O-12']],
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
  });

  /**
   * Document SIGNÉ (T-P2A-04) : la signature XAdES-Baseline-T injectée dans UBLExtensions ne doit introduire AUCUNE règle EN 16931
   * nouvelle : mêmes erreurs que le document non signé (KNOWN_PHIVE_DEVIATIONS inchangée). Les avertissements du document signé
   * sont comparés à ceux du non signé ; tout avertissement supplémentaire est listé ici explicitement.
   */
  describe('document signé (XAdES-Baseline-T dans UBLExtensions) : écarts connus inchangés', () => {
    it.each(TYPE_CODES)('type %s : mêmes règles en erreur que le document non signé, aucune règle nouvelle', async (code) => {
      const identity = await createTestIdentity('ecdsa-p256');
      const unsigned = generateUblInvoiceXml(standardInput(code));
      const signed = await signUblXades(unsigned, {
        certificateDer: identity.certificateDer,
        signer: identity.signer,
        timestampProvider: await createTestTimestampProvider(),
        signingTime: new Date(Date.UTC(2026, 10, 13, 12, 0, 0)),
      });
      const before = await server.validate(unsigned);
      const after = await server.validate(signed.xml);
      expect(errorRules(after)).toEqual([...KNOWN_PHIVE_DEVIATION_RULE_IDS]);
      expect(errorRules(after)).toEqual(errorRules(before));
      expect(errorRules(after)).not.toContain('UBL-XSD');
      const newWarnings = warningRules(after).filter((rule) => !warningRules(before).includes(rule));
      expect(newWarnings).toEqual(SIGNED_DOCUMENT_EXTRA_WARNINGS);
    }, 60_000);
  });

  it('couvre les cinq types', () => {
    expect(TYPE_CODES).toHaveLength(5);
  });
});
