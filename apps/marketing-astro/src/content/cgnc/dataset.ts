/**
 * Jeu FISCA_CGNC_CORE_60_V1 : 60 comptes piliers du plan comptable marocain (CGNC), fourni par le propriétaire,
 * non recoupé avec le texte du CGNC. Le fichier JSON est une donnée : ce module le valide à l'exécution (aucun
 * transtypage) et ne le modifie jamais. Les montants sont des centimes entiers ; `simpl_is_code_edi` reste `null`
 * tant que le référentiel XSD SIMPL-IS de la DGI n'est pas importé (aucun codeEdi inventé).
 */
import rawDataset from '../cgnc-core-60-accounts.json';

export const NORMAL_BALANCES = ['DEBIT', 'CREDIT'] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const VAT_ENCAISSEMENT_RULES = [
  'BASE_HT_SUBJECT_TO_ENCASHMENT',
  'EXEMPT_OR_OUT_OF_SCOPE',
  'NONE',
  'RECOVERABLE_CHARGES_34551',
  'COLLECTED_DUE_44551',
  'RECOVERABLE_IMMOB_34552',
  'RECOVERABLE_PENDING_34558',
  'COLLECTED_PENDING_44558',
] as const;
export type VatEncaissementRule = (typeof VAT_ENCAISSEMENT_RULES)[number];

export const STATEMENT_RUBRICS = [
  'BILAN_ACTIF_A_IMMOB_NON_VALEUR',
  'BILAN_ACTIF_B_IMMOB_INCORPORELLES',
  'BILAN_ACTIF_C_AMORTISSEMENTS',
  'BILAN_ACTIF_C_IMMOB_CORPORELLES',
  'BILAN_ACTIF_D_IMMOB_FINANCIERES',
  'BILAN_ACTIF_F_STOCKS',
  'BILAN_ACTIF_G_CREANCES_CIRCULANT',
  'BILAN_ACTIF_I_TRESORERIE_ACTIF',
  'BILAN_PASSIF_A_CAPITAUX_PROPRES',
  'BILAN_PASSIF_C_DETTES_FINANCEMENT',
  'BILAN_PASSIF_D_PROVISIONS_DURABLES',
  'BILAN_PASSIF_F_DETTES_CIRCULANT',
  'BILAN_PASSIF_H_TRESORERIE_PASSIF',
  'CPC_EXPLOITATION_CHARGES_611',
  'CPC_EXPLOITATION_CHARGES_612',
  'CPC_EXPLOITATION_CHARGES_613_614',
  'CPC_EXPLOITATION_CHARGES_617',
  'CPC_EXPLOITATION_PRODUITS_711',
  'CPC_EXPLOITATION_PRODUITS_712',
  'CPC_FINANCIER_CHARGES_631',
  'CPC_FINANCIER_PRODUITS_738',
  'CPC_NON_COURANT_CHARGES_658',
  'ESG_RESULTAT_NET',
  'ESG_SOLDE_EXPLOITATION',
] as const;
export type StatementRubric = (typeof STATEMENT_RUBRICS)[number];

export type CgncClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const CGNC_CLASSES: readonly CgncClass[] = [1, 2, 3, 4, 5, 6, 7, 8];

export interface EntryLine {
  readonly account_number: string;
  readonly side: NormalBalance;
  readonly amount_cents: number;
}

export interface SampleEntry {
  readonly description_fr: string;
  readonly total_cents: number;
  readonly lines: readonly EntryLine[];
}

export interface CgncAccountRecord {
  readonly account_number: string;
  readonly cgnc_class: CgncClass;
  readonly label_fr: string;
  readonly label_ar: string;
  readonly label_en: string;
  readonly normal_balance: NormalBalance;
  readonly vat_encaissement_rule: VatEncaissementRule;
  readonly cgnc_statement_rubric: StatementRubric;
  readonly simpl_is_code_edi: null;
  readonly simpl_is_code_edi_status: string;
  readonly sample_entry: SampleEntry;
}

export interface CgncDataset {
  readonly dataset_id: string;
  readonly legal_source: string;
  readonly accounts_count: number;
  readonly locales: readonly string[];
  readonly indexed_urls_count: number;
  readonly simpl_is_code_edi_note: string;
  readonly accounts: readonly CgncAccountRecord[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expected: string): never {
  throw new TypeError(`Jeu CGNC invalide : ${path} (${expected})`);
}

function readString(obj: Readonly<Record<string, unknown>>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) return fail(`${path}.${key}`, 'chaîne non vide attendue');
  return v;
}

function readCents(obj: Readonly<Record<string, unknown>>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return fail(`${path}.${key}`, 'centimes entiers strictement positifs attendus');
  return v;
}

function readEnum<T extends string>(obj: Readonly<Record<string, unknown>>, key: string, path: string, allowed: readonly T[]): T {
  const v = obj[key];
  const found = allowed.find((a) => a === v);
  if (found === undefined) return fail(`${path}.${key}`, `valeur parmi ${allowed.join(', ')}`);
  return found;
}

function readClass(obj: Readonly<Record<string, unknown>>, path: string): CgncClass {
  const v = obj['cgnc_class'];
  const found = CGNC_CLASSES.find((c) => c === v);
  if (found === undefined) return fail(`${path}.cgnc_class`, 'classe entière de 1 à 8');
  return found;
}

function readLine(value: unknown, path: string): EntryLine {
  if (!isRecord(value)) return fail(path, 'objet attendu');
  const account = readString(value, 'account_number', path);
  if (!/^\d{4,5}$/.test(account)) return fail(`${path}.account_number`, '4 ou 5 chiffres');
  return { account_number: account, side: readEnum(value, 'side', path, NORMAL_BALANCES), amount_cents: readCents(value, 'amount_cents', path) };
}

function readEntry(value: unknown, path: string): SampleEntry {
  if (!isRecord(value)) return fail(path, 'objet attendu');
  const lines = value['lines'];
  if (!Array.isArray(lines) || lines.length < 2) return fail(`${path}.lines`, 'au moins 2 lignes');
  return {
    description_fr: readString(value, 'description_fr', path),
    total_cents: readCents(value, 'total_cents', path),
    lines: lines.map((l: unknown, i: number) => readLine(l, `${path}.lines[${String(i)}]`)),
  };
}

function readAccount(value: unknown, index: number): CgncAccountRecord {
  const path = `accounts[${String(index)}]`;
  if (!isRecord(value)) return fail(path, 'objet attendu');
  const number = readString(value, 'account_number', path);
  if (!/^\d{4,5}$/.test(number)) return fail(`${path}.account_number`, '4 ou 5 chiffres');
  if (value['simpl_is_code_edi'] !== null) {
    return fail(`${path}.simpl_is_code_edi`, 'null exigé tant que le XSD SIMPL-IS de la DGI n’est pas importé (aucun codeEdi inventé)');
  }
  return {
    account_number: number,
    cgnc_class: readClass(value, path),
    label_fr: readString(value, 'label_fr', path),
    label_ar: readString(value, 'label_ar', path),
    label_en: readString(value, 'label_en', path),
    normal_balance: readEnum(value, 'normal_balance', path, NORMAL_BALANCES),
    vat_encaissement_rule: readEnum(value, 'vat_encaissement_rule', path, VAT_ENCAISSEMENT_RULES),
    cgnc_statement_rubric: readEnum(value, 'cgnc_statement_rubric', path, STATEMENT_RUBRICS),
    simpl_is_code_edi: null,
    simpl_is_code_edi_status: readString(value, 'simpl_is_code_edi_status', path),
    sample_entry: readEntry(value['sample_entry'], `${path}.sample_entry`),
  };
}

/** Valide un jeu inconnu (JSON brut) et le retourne typé ; toute entorse lève une `TypeError` nommant le champ. */
export function parseCgncDataset(input: unknown): CgncDataset {
  if (!isRecord(input)) return fail('racine', 'objet attendu');
  const accounts = input['accounts'];
  if (!Array.isArray(accounts)) return fail('accounts', 'tableau attendu');
  const locales = input['locales'];
  if (!Array.isArray(locales) || !locales.every((l: unknown): l is string => typeof l === 'string')) return fail('locales', 'tableau de chaînes');
  const count = input['accounts_count'];
  const urls = input['indexed_urls_count'];
  if (typeof count !== 'number' || !Number.isSafeInteger(count)) return fail('accounts_count', 'entier attendu');
  if (typeof urls !== 'number' || !Number.isSafeInteger(urls)) return fail('indexed_urls_count', 'entier attendu');
  const parsed = accounts.map((a: unknown, i: number) => readAccount(a, i));
  if (parsed.length !== count) return fail('accounts_count', `annonce ${String(count)}, contient ${String(parsed.length)}`);
  return {
    dataset_id: readString(input, 'dataset_id', 'racine'),
    legal_source: readString(input, 'legal_source', 'racine'),
    accounts_count: count,
    locales,
    indexed_urls_count: urls,
    simpl_is_code_edi_note: readString(input, 'simpl_is_code_edi_note', 'racine'),
    accounts: parsed,
  };
}

export const CGNC_DATASET: CgncDataset = parseCgncDataset(rawDataset);
export const CGNC_ACCOUNTS: readonly CgncAccountRecord[] = CGNC_DATASET.accounts;

export function findCgncAccount(accountNumber: string, accounts: readonly CgncAccountRecord[] = CGNC_ACCOUNTS): CgncAccountRecord | undefined {
  return accounts.find((a) => a.account_number === accountNumber);
}

export interface EntryIntegrity {
  readonly debitCents: number;
  readonly creditCents: number;
  readonly balanced: boolean;
  readonly totalMatches: boolean;
}

/** Équilibre d'une écriture en centimes entiers : somme des débits = somme des crédits = `total_cents`. */
export function entryIntegrity(entry: SampleEntry): EntryIntegrity {
  let debit = 0;
  let credit = 0;
  for (const line of entry.lines) {
    if (line.side === 'DEBIT') debit += line.amount_cents;
    else credit += line.amount_cents;
  }
  return { debitCents: debit, creditCents: credit, balanced: debit === credit && debit > 0, totalMatches: debit === entry.total_cents };
}
