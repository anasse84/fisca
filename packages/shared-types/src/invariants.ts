export type AdrId =
  | 'ADR-01' | 'ADR-02' | 'ADR-03' | 'ADR-04' | 'ADR-05' | 'ADR-06'
  | 'ADR-07' | 'ADR-08' | 'ADR-09' | 'ADR-10' | 'ADR-11' | 'ADR-12';

/**
 * DOC_05_SECTION_14 : fonction écrite telle quelle en Section 14 de Doc_05.
 * DERIVE_GARDE_FOU_ADR : Section 14 ne fournit aucun code pour cet ADR ; l'invariant est dérivé
 * du « Compromis & Garde-fous » explicite de l'ADR, à valider par le propriétaire.
 */
export type InvariantOrigin = 'DOC_05_SECTION_14' | 'DERIVE_GARDE_FOU_ADR';

export interface AdrInvariant {
  readonly id: string;
  readonly adr: AdrId;
  readonly statement: string;
  readonly origin: InvariantOrigin;
  readonly errorCode: string;
  /** Lève une Error dont le message commence par errorCode si l'entrée viole l'invariant. */
  readonly check: (input: unknown) => void;
  readonly conforming: readonly unknown[];
  readonly violating: readonly unknown[];
}

// ---------------------------------------------------------------- contrôles typés

export function assertSafeIntegerAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `ADR_03_FLOAT_FORBIDDEN: [${label}] doit être un entier exact en centimes/bps (reçu: ${value}).`,
    );
  }
  return value;
}

export function assertValidVatRateForIssueYear(vatRateBps: number, issueDateIso: string): void {
  const year = Number.parseInt(issueDateIso.slice(0, 4), 10);
  if (year >= 2026 && vatRateBps !== 2000 && vatRateBps !== 1000 && vatRateBps !== 0) {
    throw new Error(
      `ADR_04_LF2026_VAT_VIOLATION: Taux ${vatRateBps} bps interdit à partir de 2026 (seuls 2000, 1000 et 0 sont admis).`,
    );
  }
}

export function assertCertificateMatchesEmitter(certSubjectDn: string, emitterIce: string, emitterIf: string): void {
  const normalized = certSubjectDn.replace(/\s+/g, '').toUpperCase();
  const hasIce = emitterIce.length === 15 && normalized.includes(emitterIce);
  const hasIf = emitterIf.length >= 6 && normalized.includes(emitterIf);
  if (!hasIce && !hasIf) {
    throw new Error(
      `ADR_06_LOI4320_CERT_MISMATCH: Le SubjectDN du certificat qualifié ne correspond ni à l'ICE (${emitterIce}) ni à l'IF (${emitterIf}).`,
    );
  }
}

const FORBIDDEN_TOOL_KEYS: readonly string[] = ['tenantId', 'tenant_id', 'companyId', 'company_id', 'd1DatabaseId'];

export function assertSafeMcpToolSchema(toolName: string, parameterKeys: readonly string[]): void {
  for (const key of parameterKeys) {
    if (FORBIDDEN_TOOL_KEYS.includes(key)) {
      throw new Error(
        `ADR_02_10_TENANT_LEAK_RISK: L'outil IA [${toolName}] ne doit jamais accepter [${key}] depuis le modèle.`,
      );
    }
  }
}

export function assertReadOnlySageSql(sqlQuery: string): void {
  const upper = sqlQuery.toUpperCase();
  if (/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE)\b/.test(upper)) {
    throw new Error(
      "ADR_11_SAGE100_CORRUPTION_GUARD: Écriture SQL directe interdite sur Sage 100. Utilisez IPMEncoder ou l'export .PNM.",
    );
  }
}

// ---------------------------------------------------------------- invariants dérivés

export function assertUniquePosPrefixes(prefixes: readonly string[]): void {
  const seen = new Set<string>();
  for (const prefix of prefixes) {
    if (prefix.length === 0 || seen.has(prefix)) {
      throw new Error(
        `ADR_01_POS_PREFIX_COLLISION: préfixe matériel de caisse vide ou dupliqué [${prefix}] (risque de collision de numérotation hors-ligne).`,
      );
    }
    seen.add(prefix);
  }
}

export function assertCashAccountNotCreditor(accountCode: string, balanceCents: number): void {
  const balance = assertSafeIntegerAmount(balanceCents, 'balanceCents');
  if (accountCode === '5161' && balance < 0) {
    throw new Error('ADR_05_CASH_5161_CREDITOR: tout décaissement rendant la caisse 5161 créditrice est bloqué.');
  }
}

export function assertSingleDailyTimestamp(documentCount: number, tsaTokenCount: number): void {
  const expected = documentCount > 0 ? 1 : 0;
  if (tsaTokenCount !== expected) {
    throw new Error(
      `ADR_07_ONE_TSA_TOKEN_PER_DAY: ${documentCount} pièce(s) doivent partager ${expected} jeton RFC 3161 quotidien (reçu: ${tsaTokenCount}).`,
    );
  }
}

export function assertShamirTwoOfThree(threshold: number, shares: number): void {
  if (threshold !== 2 || shares !== 3) {
    throw new Error(
      `ADR_08_SHAMIR_2_OF_3: le séquestre fiscal est un partage 2-sur-3 (reçu: ${threshold}-sur-${shares}).`,
    );
  }
}

const ALLOWED_CONTAINER_SERVICES: readonly string[] = ['fiscal-java', 'docling-python', 'camel-bridge'];

export function assertContainerPlanHasNativeFallback(services: readonly string[], nativeFallbackBuilder: boolean): void {
  const unknown = services.find((service) => !ALLOWED_CONTAINER_SERVICES.includes(service));
  if (unknown !== undefined) {
    throw new Error(`ADR_09_CONTAINER_PLAN: service conteneur [${unknown}] hors de fiscal-java, docling-python, camel-bridge.`);
  }
  if (!nativeFallbackBuilder) {
    throw new Error('ADR_09_CONTAINER_PLAN: le constructeur UBL natif TypeScript de secours doit rester déclaré.');
  }
}

export function assertAiCannotMutateLedger(canMutateLedgerDirectly: boolean): void {
  if (canMutateLedgerDirectly !== false) {
    throw new Error('ADR_10_AI_LEDGER_MUTATION: canMutateLedgerDirectly doit rester false.');
  }
}

const ALLOWED_ADAPTER_DRIVERS: readonly string[] = ['CLOUDFLARE_EDGE', 'SOVEREIGN_MOROCCO_VPS'];

export function assertKnownInfrastructureDriver(driver: string): void {
  if (!ALLOWED_ADAPTER_DRIVERS.includes(driver)) {
    throw new Error(`ADR_12_UNKNOWN_DRIVER: pilote [${driver}] inconnu (CLOUDFLARE_EDGE ou SOVEREIGN_MOROCCO_VPS).`);
  }
}

export function assertPortableSql(sqlQuery: string): void {
  if (/\b(JSONB|ILIKE|SERIAL|PRAGMA|AUTOINCREMENT)\b/i.test(sqlQuery)) {
    throw new Error(
      'ADR_12_NON_PORTABLE_SQL: extension SQL propriétaire interdite dans le cœur métier (SQLite D1 et PostgreSQL 16 doivent rester interchangeables).',
    );
  }
}

// ---------------------------------------------------------------- adaptateurs unknown → typé

type Fields = Readonly<Record<string, unknown>>;

function fields(input: unknown, code: string): Fields {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${code}: entrée de forme inattendue (objet attendu).`);
  }
  return input as Fields;
}

function str(source: Fields, key: string, code: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`${code}: champ [${key}] de type string attendu.`);
  }
  return value;
}

function num(source: Fields, key: string, code: string): number {
  const value = source[key];
  if (typeof value !== 'number') {
    throw new Error(`${code}: champ [${key}] de type number attendu.`);
  }
  return value;
}

function strings(source: Fields, key: string, code: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`${code}: champ [${key}] de type string[] attendu.`);
  }
  return value;
}

function bool(source: Fields, key: string, code: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${code}: champ [${key}] de type boolean attendu.`);
  }
  return value;
}

function entry(spec: AdrInvariant): AdrInvariant {
  Object.freeze(spec.conforming);
  Object.freeze(spec.violating);
  return Object.freeze(spec);
}

const ICE_SAMPLE = '003976749000084';

/**
 * Les 12 ADR et leurs invariants exécutables. Chaque entrée porte une fonction de contrôle réelle
 * et des cas conformes/violants que la suite de tests rejoue.
 */
export const FISCA_ADR_INVARIANTS: readonly AdrInvariant[] = Object.freeze([
  entry({
    id: 'INV-ADR-01-01', adr: 'ADR-01', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_01_POS_PREFIX_COLLISION',
    statement: 'Chaque caisse POS porte un préfixe matériel unique et non vide, pour exclure toute collision de numérotation hors-ligne.',
    check: (input) => assertUniquePosPrefixes(strings(fields(input, 'ADR_01_POS_PREFIX_COLLISION'), 'prefixes', 'ADR_01_POS_PREFIX_COLLISION')),
    conforming: [{ prefixes: ['POS-A1', 'POS-B2'] }],
    violating: [{ prefixes: ['POS-A1', 'POS-A1'] }, { prefixes: [''] }],
  }),
  entry({
    id: 'INV-ADR-02-01', adr: 'ADR-02', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_02_10_TENANT_LEAK_RISK',
    statement: 'Aucun schéma d\'outil exposé au LLM ou à MCP n\'accepte tenantId, tenant_id, companyId, company_id ni d1DatabaseId.',
    check: (input) => {
      const code = 'ADR_02_10_TENANT_LEAK_RISK';
      const source = fields(input, code);
      assertSafeMcpToolSchema(str(source, 'toolName', code), strings(source, 'parameterKeys', code));
    },
    conforming: [{ toolName: 'listInvoices', parameterKeys: ['status', 'page'] }],
    violating: [{ toolName: 'listInvoices', parameterKeys: ['companyId'] }, { toolName: 'x', parameterKeys: ['d1DatabaseId'] }],
  }),
  entry({
    id: 'INV-ADR-03-01', adr: 'ADR-03', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_03_FLOAT_FORBIDDEN',
    statement: 'Tout montant en centimes et tout taux en bps est un entier sûr strict (aucun flottant, NaN ni dépassement).',
    check: (input) => {
      const code = 'ADR_03_FLOAT_FORBIDDEN';
      const source = fields(input, code);
      assertSafeIntegerAmount(num(source, 'value', code), str(source, 'label', code));
    },
    conforming: [{ value: 12450, label: 'montant' }, { value: -1, label: 'avoir' }],
    violating: [{ value: 12.5, label: 'montant' }, { value: Number.NaN, label: 'montant' }, { value: Number.MAX_SAFE_INTEGER + 1, label: 'montant' }],
  }),
  entry({
    id: 'INV-ADR-04-01', adr: 'ADR-04', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_04_LF2026_VAT_VIOLATION',
    statement: 'À partir de 2026 seuls les taux de TVA 2000, 1000 et 0 bps sont admis ; les millésimes antérieurs restent à la charge du moteur AST.',
    check: (input) => {
      const code = 'ADR_04_LF2026_VAT_VIOLATION';
      const source = fields(input, code);
      assertValidVatRateForIssueYear(num(source, 'vatRateBps', code), str(source, 'issueDateIso', code));
    },
    conforming: [{ vatRateBps: 2000, issueDateIso: '2026-02-01' }, { vatRateBps: 1400, issueDateIso: '2025-06-30' }],
    violating: [{ vatRateBps: 1400, issueDateIso: '2026-02-01' }, { vatRateBps: 700, issueDateIso: '2030-01-01' }],
  }),
  entry({
    id: 'INV-ADR-05-01', adr: 'ADR-05', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_05_CASH_5161_CREDITOR',
    statement: 'Un décaissement qui rend la caisse 5161 créditrice est bloqué.',
    check: (input) => {
      const code = 'ADR_05_CASH_5161_CREDITOR';
      const source = fields(input, code);
      assertCashAccountNotCreditor(str(source, 'accountCode', code), num(source, 'balanceCents', code));
    },
    conforming: [{ accountCode: '5161', balanceCents: 0 }, { accountCode: '5141', balanceCents: -500 }],
    violating: [{ accountCode: '5161', balanceCents: -1 }],
  }),
  entry({
    id: 'INV-ADR-06-01', adr: 'ADR-06', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_06_LOI4320_CERT_MISMATCH',
    statement: 'Le SubjectDN du certificat qualifié porte l\'ICE (15 chiffres) ou l\'IF de la société émettrice avant tout appel HSM.',
    check: (input) => {
      const code = 'ADR_06_LOI4320_CERT_MISMATCH';
      const source = fields(input, code);
      assertCertificateMatchesEmitter(str(source, 'certSubjectDn', code), str(source, 'emitterIce', code), str(source, 'emitterIf', code));
    },
    conforming: [{ certSubjectDn: `CN=Emetteur, 2.5.4.97=${ICE_SAMPLE}`, emitterIce: ICE_SAMPLE, emitterIf: '1234567' }],
    violating: [{ certSubjectDn: 'CN=Autre', emitterIce: ICE_SAMPLE, emitterIf: '1234567' }],
  }),
  entry({
    id: 'INV-ADR-07-01', adr: 'ADR-07', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_07_ONE_TSA_TOKEN_PER_DAY',
    statement: 'Toutes les pièces d\'une journée partagent un seul jeton RFC 3161 (racine de Merkle quotidienne), et aucun jeton sans pièce.',
    check: (input) => {
      const code = 'ADR_07_ONE_TSA_TOKEN_PER_DAY';
      const source = fields(input, code);
      assertSingleDailyTimestamp(num(source, 'documentCount', code), num(source, 'tsaTokenCount', code));
    },
    conforming: [{ documentCount: 50000, tsaTokenCount: 1 }, { documentCount: 0, tsaTokenCount: 0 }],
    violating: [{ documentCount: 3, tsaTokenCount: 3 }, { documentCount: 3, tsaTokenCount: 0 }, { documentCount: 0, tsaTokenCount: 1 }],
  }),
  entry({
    id: 'INV-ADR-08-01', adr: 'ADR-08', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_08_SHAMIR_2_OF_3',
    statement: 'Le séquestre fiscal est un partage de secret de Shamir 2-sur-3.',
    check: (input) => {
      const code = 'ADR_08_SHAMIR_2_OF_3';
      const source = fields(input, code);
      assertShamirTwoOfThree(num(source, 'threshold', code), num(source, 'shares', code));
    },
    conforming: [{ threshold: 2, shares: 3 }],
    violating: [{ threshold: 3, shares: 3 }, { threshold: 1, shares: 3 }, { threshold: 2, shares: 5 }],
  }),
  entry({
    id: 'INV-ADR-09-01', adr: 'ADR-09', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_09_CONTAINER_PLAN',
    statement: 'Seuls fiscal-java, docling-python et camel-bridge sont des conteneurs, et le constructeur UBL natif TypeScript de secours reste déclaré.',
    check: (input) => {
      const code = 'ADR_09_CONTAINER_PLAN';
      const source = fields(input, code);
      assertContainerPlanHasNativeFallback(strings(source, 'services', code), bool(source, 'nativeFallbackBuilder', code));
    },
    conforming: [{ services: ['fiscal-java', 'docling-python', 'camel-bridge'], nativeFallbackBuilder: true }],
    violating: [{ services: ['fiscal-java'], nativeFallbackBuilder: false }, { services: ['mystery-box'], nativeFallbackBuilder: true }],
  }),
  entry({
    id: 'INV-ADR-10-01', adr: 'ADR-10', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_10_AI_LEDGER_MUTATION',
    statement: 'Toute sortie IA reste une proposition : canMutateLedgerDirectly vaut false.',
    check: (input) => {
      const code = 'ADR_10_AI_LEDGER_MUTATION';
      assertAiCannotMutateLedger(bool(fields(input, code), 'canMutateLedgerDirectly', code));
    },
    conforming: [{ canMutateLedgerDirectly: false }],
    violating: [{ canMutateLedgerDirectly: true }],
  }),
  entry({
    id: 'INV-ADR-11-01', adr: 'ADR-11', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_11_SAGE100_CORRUPTION_GUARD',
    statement: 'Aucune requête SQL d\'écriture directe vers les tables internes de Sage 100 ; passage par IPMEncoder ou export .PNM.',
    check: (input) => {
      const code = 'ADR_11_SAGE100_CORRUPTION_GUARD';
      assertReadOnlySageSql(str(fields(input, code), 'sqlQuery', code));
    },
    conforming: [{ sqlQuery: 'SELECT cbMarq FROM F_ECRITUREC WITH (NOLOCK)' }],
    violating: [{ sqlQuery: 'INSERT INTO F_ECRITUREC VALUES (1)' }, { sqlQuery: 'delete from F_ECRITUREC' }],
  }),
  entry({
    id: 'INV-ADR-12-01', adr: 'ADR-12', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_12_UNKNOWN_DRIVER',
    statement: 'Le FiscaInfrastructureAdapter n\'admet que les pilotes CLOUDFLARE_EDGE et SOVEREIGN_MOROCCO_VPS.',
    check: (input) => {
      const code = 'ADR_12_UNKNOWN_DRIVER';
      assertKnownInfrastructureDriver(str(fields(input, code), 'driver', code));
    },
    conforming: [{ driver: 'CLOUDFLARE_EDGE' }, { driver: 'SOVEREIGN_MOROCCO_VPS' }],
    violating: [{ driver: 'AWS_LAMBDA' }],
  }),
  entry({
    id: 'INV-ADR-12-02', adr: 'ADR-12', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_12_NON_PORTABLE_SQL',
    statement: 'Le cœur métier n\'emploie aucune extension SQL propriétaire non portable entre SQLite D1 et PostgreSQL 16.',
    check: (input) => {
      const code = 'ADR_12_NON_PORTABLE_SQL';
      assertPortableSql(str(fields(input, code), 'sqlQuery', code));
    },
    conforming: [{ sqlQuery: 'SELECT id FROM invoices WHERE status = ?' }],
    violating: [{ sqlQuery: 'SELECT data::jsonb FROM t' }, { sqlQuery: 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)' }],
  }),
]);

/** Rejoue tous les cas embarqués ; retourne la liste des écarts (vide = harnais sain). */
export function runAdrInvariantSelfCheck(): readonly string[] {
  const failures: string[] = [];
  for (const invariant of FISCA_ADR_INVARIANTS) {
    for (const input of invariant.conforming) {
      try {
        invariant.check(input);
      } catch {
        failures.push(`${invariant.id}: un cas conforme est refusé`);
      }
    }
    for (const input of invariant.violating) {
      try {
        invariant.check(input);
        failures.push(`${invariant.id}: un cas violant est accepté`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith(invariant.errorCode)) {
          failures.push(`${invariant.id}: mauvais code d'erreur`);
        }
      }
    }
  }
  return failures;
}
