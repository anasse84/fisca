import arAccounting from '../locales/ar/accounting_cgnc.json';
import arCommon from '../locales/ar/common.json';
import arEnterprise from '../locales/ar/enterprise.json';
import arInvoicing from '../locales/ar/invoicing_pos.json';
import arMarketing from '../locales/ar/marketing.json';
import arTax from '../locales/ar/tax_simpl.json';
import aryAccounting from '../locales/ary/accounting_cgnc.json';
import aryCommon from '../locales/ary/common.json';
import aryEnterprise from '../locales/ary/enterprise.json';
import aryInvoicing from '../locales/ary/invoicing_pos.json';
import aryMarketing from '../locales/ary/marketing.json';
import aryTax from '../locales/ary/tax_simpl.json';
import enAccounting from '../locales/en/accounting_cgnc.json';
import enCommon from '../locales/en/common.json';
import enEnterprise from '../locales/en/enterprise.json';
import enInvoicing from '../locales/en/invoicing_pos.json';
import enMarketing from '../locales/en/marketing.json';
import enTax from '../locales/en/tax_simpl.json';
import frAccounting from '../locales/fr/accounting_cgnc.json';
import frCommon from '../locales/fr/common.json';
import frEnterprise from '../locales/fr/enterprise.json';
import frInvoicing from '../locales/fr/invoicing_pos.json';
import frMarketing from '../locales/fr/marketing.json';
import frTax from '../locales/fr/tax_simpl.json';
import zlAccounting from '../locales/zgh-Latn/accounting_cgnc.json';
import zlCommon from '../locales/zgh-Latn/common.json';
import zlEnterprise from '../locales/zgh-Latn/enterprise.json';
import zlInvoicing from '../locales/zgh-Latn/invoicing_pos.json';
import zlMarketing from '../locales/zgh-Latn/marketing.json';
import zlTax from '../locales/zgh-Latn/tax_simpl.json';
import ztAccounting from '../locales/zgh-Tfng/accounting_cgnc.json';
import ztCommon from '../locales/zgh-Tfng/common.json';
import ztEnterprise from '../locales/zgh-Tfng/enterprise.json';
import ztInvoicing from '../locales/zgh-Tfng/invoicing_pos.json';
import ztMarketing from '../locales/zgh-Tfng/marketing.json';
import ztTax from '../locales/zgh-Tfng/tax_simpl.json';

export const PACKAGE_NAME = '@fisca/i18n' as const;

export const FISCA_LOCALES = ['fr', 'ar', 'ary', 'zgh-Latn', 'zgh-Tfng', 'en'] as const;
export type FiscaLocale = (typeof FISCA_LOCALES)[number];

export const FISCA_NAMESPACES = [
  'common',
  'marketing',
  'invoicing_pos',
  'accounting_cgnc',
  'tax_simpl',
  'enterprise',
] as const;
export type FiscaNamespace = (typeof FISCA_NAMESPACES)[number];

export type FiscaAppSurface =
  | 'MARKETING_ASTRO'
  | 'PME_SAAS'
  | 'POS_TACTILE'
  | 'FIDUCIAIRE_OEC'
  | 'ENTERPRISE_CORPORATE';

export type TextDirection = 'ltr' | 'rtl';

export interface DictionaryNode {
  readonly [key: string]: string | DictionaryNode;
}

export interface SafeLocaleResolution {
  readonly locale: FiscaLocale;
  readonly dir: TextDirection;
  readonly fallbackChain: readonly FiscaLocale[];
}

export const DEFAULT_LOCALE: FiscaLocale = 'fr';

const SIX_LOCALES: readonly FiscaLocale[] = FISCA_LOCALES;
const THREE_INSTITUTIONAL_LOCALES: readonly FiscaLocale[] = ['fr', 'ar', 'en'];

const DICTIONARIES: Readonly<Record<FiscaLocale, Readonly<Record<FiscaNamespace, DictionaryNode>>>> = {
  fr: { common: frCommon, marketing: frMarketing, invoicing_pos: frInvoicing, accounting_cgnc: frAccounting, tax_simpl: frTax, enterprise: frEnterprise },
  ar: { common: arCommon, marketing: arMarketing, invoicing_pos: arInvoicing, accounting_cgnc: arAccounting, tax_simpl: arTax, enterprise: arEnterprise },
  ary: { common: aryCommon, marketing: aryMarketing, invoicing_pos: aryInvoicing, accounting_cgnc: aryAccounting, tax_simpl: aryTax, enterprise: aryEnterprise },
  'zgh-Latn': { common: zlCommon, marketing: zlMarketing, invoicing_pos: zlInvoicing, accounting_cgnc: zlAccounting, tax_simpl: zlTax, enterprise: zlEnterprise },
  'zgh-Tfng': { common: ztCommon, marketing: ztMarketing, invoicing_pos: ztInvoicing, accounting_cgnc: ztAccounting, tax_simpl: ztTax, enterprise: ztEnterprise },
  en: { common: enCommon, marketing: enMarketing, invoicing_pos: enInvoicing, accounting_cgnc: enAccounting, tax_simpl: enTax, enterprise: enEnterprise },
};

export function getDictionary(locale: FiscaLocale, namespace: FiscaNamespace): DictionaryNode {
  return DICTIONARIES[locale][namespace];
}

/** Aplatit un dictionnaire en paires [chemin pointé, texte]. */
export function flattenKeys(node: DictionaryNode, prefix = ''): readonly (readonly [string, string])[] {
  const result: (readonly [string, string])[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      result.push([path, value]);
    } else {
      result.push(...flattenKeys(value, path));
    }
  }
  return result;
}

export function directionOf(locale: FiscaLocale): TextDirection {
  return locale === 'ar' || locale === 'ary' ? 'rtl' : 'ltr';
}

export function getAllowedLocalesForSurface(surface: FiscaAppSurface): readonly FiscaLocale[] {
  if (surface === 'FIDUCIAIRE_OEC' || surface === 'ENTERPRISE_CORPORATE') {
    return THREE_INSTITUTIONAL_LOCALES;
  }
  return SIX_LOCALES;
}

function terminologyChain(locale: FiscaLocale): readonly FiscaLocale[] {
  if (locale === 'fr') {
    return ['fr'];
  }
  if (locale === 'ary') {
    return ['ary', 'ar', 'fr'];
  }
  return [locale, 'fr'];
}

export function resolveSafeLocaleForSurface(requested: FiscaLocale, surface: FiscaAppSurface): SafeLocaleResolution {
  const allowed = getAllowedLocalesForSurface(surface);
  const active: FiscaLocale = allowed.includes(requested)
    ? requested
    : requested === 'ary'
      ? 'ar'
      : DEFAULT_LOCALE;
  return { locale: active, dir: directionOf(active), fallbackChain: terminologyChain(active) };
}

function lookup(node: DictionaryNode, key: string): string | undefined {
  let current: string | DictionaryNode = node;
  for (const part of key.split('.')) {
    if (typeof current === 'string') {
      return undefined;
    }
    const next: string | DictionaryNode | undefined = current[part];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return typeof current === 'string' ? current : undefined;
}

/** Traduit une clé en suivant la chaîne de repli ; renvoie la clé si elle est absente partout. */
export function translate(locale: FiscaLocale, namespace: FiscaNamespace, key: string): string {
  for (const candidate of terminologyChain(locale)) {
    const found = lookup(getDictionary(candidate, namespace), key);
    if (found !== undefined) {
      return found;
    }
  }
  return key;
}
