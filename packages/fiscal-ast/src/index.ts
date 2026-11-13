export const PACKAGE_NAME = '@fisca/fiscal-ast' as const;

export * from './errors.ts';
export * from './calendar.ts';
export * from './rule-ast.ts';
export * from './rule-store.ts';
export * from './dynamic-fiscal-ast-engine.ts';

/** Codes de règle recommandés (identifiants, pas des valeurs fiscales) : à porter par `rule_code` dans rule_ast_json. */
export const FISCAL_RULE_CODES = {
  VAT_RATES: 'VAT_RATES',
  CASH_CEILING: 'CASH_CEILING_ART_11_II',
  RAS_TVA: 'RAS_TVA_ART_117',
  AUTO_ENTREPRENEUR: 'AE_CLIENT_THRESHOLD',
  PAYMENT_DELAY: 'PAYMENT_DELAY_LAW_69_21',
} as const;
export * from './wiki-compiler-errors.ts';
export { canonicalJson, parseStrictJson, sha256Hex, type StrictJsonValue } from './wiki-json.ts';
export * from './wiki-to-ast-compiler.ts';
