import { assertValidVatRateForIssueYear } from '@fisca/shared-types';
import { dayNumber, parseIsoDate } from './calendar.ts';
import { FiscalAstError } from './errors.ts';
import { DYNAMIC_FISCAL_RULE_SCHEMA, type DynamicFiscalRuleAst, type RuleAstOfKind, type RuleKind } from './rule-ast.ts';

/** Statuts de dynamic_fiscal_rules (control-plane.ts, CHECK de la colonne `status`). */
export type RuleRowStatus = 'PENDING_ADMIN_APPROVAL' | 'SHADOW_OBSERVE' | 'ACTIVE' | 'SUPERSEDED';
export type RuleRowTargetScope = 'INVOICE_LINE' | 'INVOICE_GLOBAL' | 'JOURNAL_ENTRY' | 'FEC_AUDIT';

/** Ligne de dynamic_fiscal_rules, colonne par colonne (db-schema/src/control-plane.ts) ; le moteur ne dépend pas de db-schema. */
export interface RuleRow {
  readonly rule_id: string;
  readonly cgi_article_ref: string;
  /** AAAA-MM-JJ, premier jour en vigueur (inclus). */
  readonly effective_from: string;
  /** AAAA-MM-JJ, dernier jour en vigueur (inclus) ; null si la règle est encore en vigueur. */
  readonly effective_to: string | null;
  readonly target_scope: RuleRowTargetScope;
  readonly status: RuleRowStatus;
  readonly rule_ast_json: string;
  readonly wiki_source_slug: string;
  readonly created_at: string;
}

/** Port d'accès aux règles : l'adaptateur D1 réel est hors de ce paquet (ticket suivant). */
export interface FiscalRuleSource {
  listRuleRows(): Promise<readonly RuleRow[]>;
}

/** Identité d'une règle appliquée, rendue dans chaque résultat. */
export interface AppliedRuleRef {
  readonly ruleId: string;
  readonly ruleCode: string;
  readonly cgiArticleRef: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: RuleRowStatus;
  readonly wikiSourceSlug: string;
  /** Date à laquelle la règle a été sélectionnée. */
  readonly evaluatedOnIso: string;
}

export interface SelectedRule<K extends RuleKind> {
  readonly ref: AppliedRuleRef;
  readonly ast: RuleAstOfKind<K>;
}

interface CompiledRule {
  readonly row: RuleRow;
  readonly ast: DynamicFiscalRuleAst;
  readonly fromDay: number;
  readonly toDay: number | null;
}

/** Seules les lignes ACTIVE et SUPERSEDED sont opposables : une règle remplacée reste lisible pour les exercices antérieurs (Doc_02 § 10). */
function isOpposable(status: RuleRowStatus): boolean {
  return status === 'ACTIVE' || status === 'SUPERSEDED';
}

function compileRow(row: RuleRow): CompiledRule {
  const where = `règle ${row.rule_id}`;
  const fromDate = parseRowDate(row.effective_from, `${where} effective_from`);
  const toDay = row.effective_to === null ? null : parseRowDate(row.effective_to, `${where} effective_to`);
  if (toDay !== null && toDay < fromDate) {
    throw new FiscalAstError('RULE_ROW_INVALID', `${where} : effective_to précède effective_from.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(row.rule_ast_json);
  } catch (error) {
    throw new FiscalAstError('RULE_ROW_INVALID', `${where} : rule_ast_json n'est pas du JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
  const parsed = DYNAMIC_FISCAL_RULE_SCHEMA.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`).join(' ; ');
    throw new FiscalAstError('RULE_ROW_INVALID', `${where} : AST invalide — ${issues}`);
  }
  assertRuleCoherentWithItsDate(parsed.data, row, where);
  return { row, ast: parsed.data, fromDay: fromDate, toDay };
}

function parseRowDate(iso: string, label: string): number {
  try {
    return dayNumber(parseIsoDate(iso, label));
  } catch (error) {
    if (error instanceof FiscalAstError) {
      throw new FiscalAstError('RULE_ROW_INVALID', error.detail);
    }
    throw error;
  }
}

/** Une liste de taux de TVA ne peut pas contenir, à partir de 2026, un taux que la loi de finances supprime (D-04). */
function assertRuleCoherentWithItsDate(ast: DynamicFiscalRuleAst, row: RuleRow, where: string): void {
  if (ast.kind !== 'VAT_RATE_SET') {
    return;
  }
  for (const rate of ast.rates.allowed_rates_bps) {
    try {
      assertValidVatRateForIssueYear(rate, row.effective_from);
    } catch (error) {
      throw new FiscalAstError('RULE_ROW_INVALID', `${where} : le taux ${rate} bps est interdit à partir de 2026 (D-04) : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Index des règles opposables par code, avec sélection datée à échec fermé. */
export class FiscalRuleStore {
  private readonly byCode: ReadonlyMap<string, readonly CompiledRule[]>;

  constructor(rows: readonly RuleRow[]) {
    const index = new Map<string, CompiledRule[]>();
    const seenIds = new Set<string>();
    for (const row of rows) {
      if (!isOpposable(row.status)) {
        continue;
      }
      if (seenIds.has(row.rule_id)) {
        throw new FiscalAstError('RULE_ROW_INVALID', `rule_id dupliqué : ${row.rule_id}.`);
      }
      seenIds.add(row.rule_id);
      const compiled = compileRow(row);
      const bucket = index.get(compiled.ast.rule_code);
      if (bucket === undefined) {
        index.set(compiled.ast.rule_code, [compiled]);
      } else {
        bucket.push(compiled);
      }
    }
    this.byCode = index;
  }

  select<K extends RuleKind>(ruleCode: string, onDateIso: string, kind: K): SelectedRule<K> {
    const onDay = dayNumber(parseIsoDate(onDateIso, 'date de sélection de la règle'));
    const candidates = this.byCode.get(ruleCode);
    if (candidates === undefined || candidates.length === 0) {
      throw new FiscalAstError('RULE_NOT_FOUND', `aucune règle opposable pour le code « ${ruleCode} ».`);
    }
    const inForce = candidates.filter((rule) => rule.fromDay <= onDay && (rule.toDay === null || onDay <= rule.toDay));
    const [first, ...others] = inForce;
    if (first === undefined) {
      const hasBefore = candidates.some((rule) => rule.fromDay < onDay);
      const hasAfter = candidates.some((rule) => rule.fromDay > onDay);
      if (hasBefore && hasAfter) {
        throw new FiscalAstError('RULE_GAP', `trou de règle « ${ruleCode} » à la date ${onDateIso} : aucune ligne en vigueur entre deux lignes.`);
      }
      throw new FiscalAstError('RULE_NOT_IN_FORCE', `règle « ${ruleCode} » non en vigueur le ${onDateIso} (${hasAfter ? 'pas encore' : 'plus'}).`);
    }
    if (others.length > 0) {
      const ids = [first, ...others].map((rule) => rule.row.rule_id).join(', ');
      throw new FiscalAstError('RULE_OVERLAP', `chevauchement de règles « ${ruleCode} » le ${onDateIso} : ${ids}.`);
    }
    if (first.ast.kind !== kind) {
      throw new FiscalAstError('RULE_KIND_MISMATCH', `règle ${first.row.rule_id} (« ${ruleCode} ») est de genre ${first.ast.kind}, ${kind} attendu.`);
    }
    return {
      ref: {
        ruleId: first.row.rule_id,
        ruleCode,
        cgiArticleRef: first.row.cgi_article_ref,
        effectiveFrom: first.row.effective_from,
        effectiveTo: first.row.effective_to,
        status: first.row.status,
        wikiSourceSlug: first.row.wiki_source_slug,
        evaluatedOnIso: onDateIso,
      },
      ast: first.ast as RuleAstOfKind<K>,
    };
  }

  /** Vérifie toute la chronologie d'un code : aucun chevauchement, aucun trou (jours contigus). */
  validateTimeline(ruleCode: string): void {
    const candidates = this.byCode.get(ruleCode);
    if (candidates === undefined || candidates.length === 0) {
      throw new FiscalAstError('RULE_NOT_FOUND', `aucune règle opposable pour le code « ${ruleCode} ».`);
    }
    const sorted = [...candidates].sort((left, right) => left.fromDay - right.fromDay);
    sorted.forEach((rule, index) => {
      const next = sorted[index + 1];
      if (next === undefined) {
        return;
      }
      if (rule.toDay === null || next.fromDay <= rule.toDay) {
        throw new FiscalAstError('RULE_OVERLAP', `chevauchement de règles « ${ruleCode} » : ${rule.row.rule_id} et ${next.row.rule_id}.`);
      }
      if (next.fromDay > rule.toDay + 1) {
        throw new FiscalAstError('RULE_GAP', `trou de règle « ${ruleCode} » entre ${rule.row.rule_id} et ${next.row.rule_id}.`);
      }
    });
  }

  codes(): readonly string[] {
    return [...this.byCode.keys()];
  }
}
