import { FISCA_LOCALES, flattenKeys, getDictionary } from '@fisca/i18n';
import type { FiscaLocale, FiscaNamespace } from '@fisca/i18n';
import type { B2bConversionState } from '../b2b/qr-conversion.ts';
import type { ReceiptLabelSet } from '../printing/receipt-layout.ts';
import type { ZLabelSet } from '../closing/z-layout.ts';
import type { SyncErrorCode } from '../sync/sync-types.ts';
import type { PrintErrorCode } from '../printing/print-queue.ts';

/** Résolveur de libellé : renvoie le texte ou lève `I18N_KEY_MISSING` (jamais la clé brute ni un repli). Motif copié de la couche partagée de l'espace PME. */
export type TranslateStrict = (locale: FiscaLocale, namespace: FiscaNamespace, key: string) => string;

const tables = new Map<string, ReadonlyMap<string, string>>();

function tableOf(locale: FiscaLocale, namespace: FiscaNamespace): ReadonlyMap<string, string> {
  const id = `${locale}/${namespace}`;
  let table = tables.get(id);
  if (table === undefined) {
    table = new Map(flattenKeys(getDictionary(locale, namespace)));
    tables.set(id, table);
  }
  return table;
}

/** Lit la clé dans le dictionnaire PROPRE de la langue : pas de chaîne de repli, pas de renvoi de la clé. */
export const translateStrict: TranslateStrict = (locale, namespace, key) => {
  const text = tableOf(locale, namespace).get(key);
  if (text === undefined || text.trim() === '') throw new Error(`I18N_KEY_MISSING: ${locale}/${namespace}/${key}`);
  return text;
};

/** Clés de l'espace `common`, sous `ui.pos.` : la liste fait foi pour le test de parité des 6 langues. */
export const POS_LABEL_KEYS = [
  'title',
  'region',
  'language.label',
  'language.fr',
  'language.ar',
  'language.ary',
  'language.zgh-Latn',
  'language.zgh-Tfng',
  'language.en',
  'theme.label',
  'theme.light',
  'theme.dark',
  'sale.catalog',
  'sale.catalogEmpty',
  'sale.addItem',
  'sale.cart',
  'sale.cartEmpty',
  'sale.itemCount',
  'sale.quantity',
  'sale.unitPrice',
  'sale.lineTotal',
  'sale.increase',
  'sale.decrease',
  'sale.remove',
  'sale.clear',
  'sale.totalHt',
  'sale.newSale',
  'sale.vatRate',
  'sale.totalTtc',
  'sale.pay',
  'sale.blocked',
  'pay.title',
  'pay.methods',
  'pay.cash',
  'pay.card',
  'pay.delivery',
  'pay.totalDue',
  'pay.cashShare',
  'pay.stamp',
  'pay.cashDue',
  'pay.tendered',
  'pay.change',
  'pay.remaining',
  'pay.short',
  'pay.amountFor',
  'pay.fillRemaining',
  'pay.keypad',
  'pay.key',
  'pay.backspace',
  'pay.clear',
  'pay.validate',
  'pay.backToCart',
  'pay.issuing',
  'net.online',
  'net.offlineWithin',
  'net.offlineExpired',
  'net.neverSynced',
  'net.clockAnomaly',
  'net.pending',
  'net.remaining',
  'net.status',
  'receipt.title',
  'receipt.number',
  'receipt.date',
  'receipt.totalHt',
  'receipt.vat',
  'receipt.totalTtc',
  'receipt.stamp',
  'receipt.cash',
  'receipt.card',
  'receipt.delivery',
  'receipt.change',
  'receipt.hash',
  'receipt.qrCaption',
  'receipt.thanks',
  'print.preview',
  'print.action',
  'print.drawer',
  'print.width',
  'print.width58',
  'print.width80',
  'print.queue',
  'print.printed',
  'print.error.absent',
  'print.error.paper',
  'print.error.timeout',
  'print.error.unsupported',
  'print.error.generic',
  'b2b.title',
  'b2b.instruction',
  'b2b.qrAlt',
  'b2b.stateLabel',
  'b2b.state.NONE',
  'b2b.state.CONVERTI_B2B_AVANT_Z',
  'b2b.state.CONVERTI_B2B_POST_Z_NEUTRALISE',
  'b2b.noDoubleTax',
  'b2b.alreadyConverted',
  'b2b.link',
  'err.sessionNotOpen',
  'err.terminalNotPaired',
  'err.stampRuleMissing',
  'err.generic',
  'count.title',
  'count.instruction',
  'count.blindNotice',
  'count.banknotes',
  'count.coins',
  'count.increase',
  'count.decrease',
  'count.quantity',
  'count.counted',
  'count.lock',
  'count.locking',
  'count.locked',
  'count.lockedWait',
  'count.error.invalid',
  'count.error.notActive',
  'count.error.generic',
  'count.emptyGrid',
  'variance.title',
  'variance.counted',
  'variance.expected',
  'variance.difference',
  'variance.shortage',
  'variance.overage',
  'variance.balanced',
  'variance.loading',
  'variance.error',
  'z.title',
  'z.preview',
  'z.closureNumber',
  'z.businessDate',
  'z.ticketCount',
  'z.ht',
  'z.vat',
  'z.stamp',
  'z.tpeGross',
  'z.hash',
  'z.prevHash',
  'z.thanks',
  'z.seal',
  'z.sealing',
  'z.sealed',
  'z.print',
  'z.printed',
  'z.noSale',
  'z.error.notReady',
  'z.error.generic',
  'z.loading',
  'sync.status',
  'sync.state.pending',
  'sync.state.syncing',
  'sync.state.error',
  'sync.state.synced',
  'sync.pendingTickets',
  'sync.pendingClosures',
  'sync.blocked',
  'sync.retry',
  'sync.retryIn',
  'sync.cause.NETWORK',
  'sync.cause.SERVER',
  'sync.cause.REJECTED',
  'closing.open',
  'closing.back',
] as const;

export type PosLabelKey = (typeof POS_LABEL_KEYS)[number];

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{([A-Za-z]+)\}/gu, (_m, name: string) => values[name] ?? `{${name}}`);

export interface PosLabels {
  readonly title: string;
  readonly region: string;
  readonly language: { readonly label: string; readonly names: Readonly<Record<FiscaLocale, string>> };
  readonly theme: { readonly label: string; readonly light: string; readonly dark: string };
  readonly sale: {
    readonly catalog: string;
    readonly catalogEmpty: string;
    readonly addItem: (name: string) => string;
    readonly cart: string;
    readonly cartEmpty: string;
    readonly itemCount: (count: number) => string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly lineTotal: string;
    readonly increase: (name: string) => string;
    readonly decrease: (name: string) => string;
    readonly remove: (name: string) => string;
    readonly clear: string;
    readonly totalHt: string;
    readonly newSale: string;
    readonly vatRate: (rate: string) => string;
    readonly totalTtc: string;
    readonly pay: string;
    readonly blocked: string;
  };
  readonly pay: {
    readonly title: string;
    readonly methods: string;
    readonly cash: string;
    readonly card: string;
    readonly delivery: string;
    readonly totalDue: string;
    readonly cashShare: string;
    readonly stamp: string;
    readonly cashDue: string;
    readonly tendered: string;
    readonly change: string;
    readonly remaining: string;
    readonly short: string;
    readonly amountFor: (method: string) => string;
    readonly fillRemaining: string;
    readonly keypad: string;
    readonly key: (digit: string) => string;
    readonly backspace: string;
    readonly clear: string;
    readonly validate: string;
    readonly backToCart: string;
    readonly issuing: string;
  };
  readonly net: {
    readonly status: string;
    readonly online: string;
    readonly offlineWithin: string;
    readonly offlineExpired: string;
    readonly neverSynced: string;
    readonly clockAnomaly: string;
    readonly pending: (count: number) => string;
    readonly remaining: (hours: number, minutes: number) => string;
  };
  readonly receipt: { readonly title: string };
  readonly print: {
    readonly preview: string;
    readonly action: string;
    readonly drawer: string;
    readonly width: string;
    readonly width58: string;
    readonly width80: string;
    readonly queue: (count: number) => string;
    readonly printed: string;
    readonly error: Readonly<Record<PrintErrorCode | 'GENERIC', string>>;
  };
  readonly b2b: {
    readonly title: string;
    readonly instruction: string;
    readonly qrAlt: string;
    readonly stateLabel: string;
    readonly state: Readonly<Record<B2bConversionState, string>>;
    readonly noDoubleTax: string;
    readonly alreadyConverted: string;
    readonly link: string;
  };
  readonly err: { readonly sessionNotOpen: string; readonly terminalNotPaired: string; readonly stampRuleMissing: string; readonly generic: string };
  readonly count: {
    readonly title: string;
    readonly instruction: string;
    readonly blindNotice: string;
    readonly banknotes: string;
    readonly coins: string;
    readonly increase: (value: string) => string;
    readonly decrease: (value: string) => string;
    readonly quantity: (value: string) => string;
    readonly counted: string;
    readonly lock: string;
    readonly locking: string;
    readonly locked: string;
    readonly lockedWait: string;
    readonly error: { readonly invalid: string; readonly notActive: string; readonly generic: string };
    readonly emptyGrid: string;
  };
  readonly variance: {
    readonly title: string;
    readonly counted: string;
    readonly expected: string;
    readonly difference: string;
    readonly shortage: string;
    readonly overage: string;
    readonly balanced: string;
    readonly loading: string;
    readonly error: string;
  };
  readonly z: {
    readonly title: string;
    readonly preview: string;
    readonly closureNumber: (number: string) => string;
    readonly businessDate: string;
    readonly ticketCount: (count: string) => string;
    readonly ht: (rate: string) => string;
    readonly vat: (rate: string) => string;
    readonly stamp: string;
    readonly tpeGross: string;
    readonly hash: string;
    readonly prevHash: string;
    readonly seal: string;
    readonly sealing: string;
    readonly sealed: string;
    readonly print: string;
    readonly printed: string;
    readonly noSale: string;
    readonly loading: string;
    readonly error: { readonly notReady: string; readonly generic: string };
  };
  readonly sync: {
    readonly status: string;
    readonly state: Readonly<Record<'pending' | 'syncing' | 'error' | 'synced', string>>;
    readonly pendingTickets: (count: number) => string;
    readonly pendingClosures: (count: number) => string;
    readonly blocked: (hours: number) => string;
    readonly retry: string;
    readonly retryIn: (seconds: number) => string;
    readonly cause: Readonly<Record<SyncErrorCode, string>>;
  };
  readonly closing: { readonly open: string; readonly back: string };
}

export function resolvePosLabels(locale: FiscaLocale, t: TranslateStrict = translateStrict): PosLabels {
  const g = (key: PosLabelKey): string => t(locale, 'common', `ui.pos.${key}`);
  const names = Object.fromEntries(FISCA_LOCALES.map((l) => [l, t(locale, 'common', `ui.pos.language.${l}`)])) as Record<FiscaLocale, string>;
  return {
    title: g('title'),
    region: g('region'),
    language: { label: g('language.label'), names },
    theme: { label: g('theme.label'), light: g('theme.light'), dark: g('theme.dark') },
    sale: {
      catalog: g('sale.catalog'),
      catalogEmpty: g('sale.catalogEmpty'),
      addItem: (name) => fill(g('sale.addItem'), { name }),
      cart: g('sale.cart'),
      cartEmpty: g('sale.cartEmpty'),
      itemCount: (count) => fill(g('sale.itemCount'), { count: String(count) }),
      quantity: g('sale.quantity'),
      unitPrice: g('sale.unitPrice'),
      lineTotal: g('sale.lineTotal'),
      increase: (name) => fill(g('sale.increase'), { name }),
      decrease: (name) => fill(g('sale.decrease'), { name }),
      remove: (name) => fill(g('sale.remove'), { name }),
      clear: g('sale.clear'),
      totalHt: g('sale.totalHt'),
      newSale: g('sale.newSale'),
      vatRate: (rate) => fill(g('sale.vatRate'), { rate }),
      totalTtc: g('sale.totalTtc'),
      pay: g('sale.pay'),
      blocked: g('sale.blocked'),
    },
    pay: {
      title: g('pay.title'),
      methods: g('pay.methods'),
      cash: g('pay.cash'),
      card: g('pay.card'),
      delivery: g('pay.delivery'),
      totalDue: g('pay.totalDue'),
      cashShare: g('pay.cashShare'),
      stamp: g('pay.stamp'),
      cashDue: g('pay.cashDue'),
      tendered: g('pay.tendered'),
      change: g('pay.change'),
      remaining: g('pay.remaining'),
      short: g('pay.short'),
      amountFor: (method) => fill(g('pay.amountFor'), { method }),
      fillRemaining: g('pay.fillRemaining'),
      keypad: g('pay.keypad'),
      key: (digit) => fill(g('pay.key'), { digit }),
      backspace: g('pay.backspace'),
      clear: g('pay.clear'),
      validate: g('pay.validate'),
      backToCart: g('pay.backToCart'),
      issuing: g('pay.issuing'),
    },
    net: {
      status: g('net.status'),
      online: g('net.online'),
      offlineWithin: g('net.offlineWithin'),
      offlineExpired: g('net.offlineExpired'),
      neverSynced: g('net.neverSynced'),
      clockAnomaly: g('net.clockAnomaly'),
      pending: (count) => fill(g('net.pending'), { count: String(count) }),
      remaining: (hours, minutes) => fill(g('net.remaining'), { hours: String(hours), minutes: String(minutes) }),
    },
    receipt: { title: g('receipt.title') },
    print: {
      preview: g('print.preview'),
      action: g('print.action'),
      drawer: g('print.drawer'),
      width: g('print.width'),
      width58: g('print.width58'),
      width80: g('print.width80'),
      queue: (count) => fill(g('print.queue'), { count: String(count) }),
      printed: g('print.printed'),
      error: {
        PRINTER_ABSENT: g('print.error.absent'),
        PAPER_OUT: g('print.error.paper'),
        TIMEOUT: g('print.error.timeout'),
        UNSUPPORTED: g('print.error.unsupported'),
        TRANSPORT_FAILED: g('print.error.generic'),
        GENERIC: g('print.error.generic'),
      },
    },
    b2b: {
      title: g('b2b.title'),
      instruction: g('b2b.instruction'),
      qrAlt: g('b2b.qrAlt'),
      stateLabel: g('b2b.stateLabel'),
      state: {
        NONE: g('b2b.state.NONE'),
        CONVERTI_B2B_AVANT_Z: g('b2b.state.CONVERTI_B2B_AVANT_Z'),
        CONVERTI_B2B_POST_Z_NEUTRALISE: g('b2b.state.CONVERTI_B2B_POST_Z_NEUTRALISE'),
      },
      noDoubleTax: g('b2b.noDoubleTax'),
      alreadyConverted: g('b2b.alreadyConverted'),
      link: g('b2b.link'),
    },
    err: {
      sessionNotOpen: g('err.sessionNotOpen'),
      terminalNotPaired: g('err.terminalNotPaired'),
      stampRuleMissing: g('err.stampRuleMissing'),
      generic: g('err.generic'),
    },
    count: {
      title: g('count.title'),
      instruction: g('count.instruction'),
      blindNotice: g('count.blindNotice'),
      banknotes: g('count.banknotes'),
      coins: g('count.coins'),
      increase: (value) => fill(g('count.increase'), { value }),
      decrease: (value) => fill(g('count.decrease'), { value }),
      quantity: (value) => fill(g('count.quantity'), { value }),
      counted: g('count.counted'),
      lock: g('count.lock'),
      locking: g('count.locking'),
      locked: g('count.locked'),
      lockedWait: g('count.lockedWait'),
      error: { invalid: g('count.error.invalid'), notActive: g('count.error.notActive'), generic: g('count.error.generic') },
      emptyGrid: g('count.emptyGrid'),
    },
    variance: {
      title: g('variance.title'),
      counted: g('variance.counted'),
      expected: g('variance.expected'),
      difference: g('variance.difference'),
      shortage: g('variance.shortage'),
      overage: g('variance.overage'),
      balanced: g('variance.balanced'),
      loading: g('variance.loading'),
      error: g('variance.error'),
    },
    z: {
      title: g('z.title'),
      preview: g('z.preview'),
      closureNumber: (number) => fill(g('z.closureNumber'), { number }),
      businessDate: g('z.businessDate'),
      ticketCount: (count) => fill(g('z.ticketCount'), { count }),
      ht: (rate) => fill(g('z.ht'), { rate }),
      vat: (rate) => fill(g('z.vat'), { rate }),
      stamp: g('z.stamp'),
      tpeGross: g('z.tpeGross'),
      hash: g('z.hash'),
      prevHash: g('z.prevHash'),
      seal: g('z.seal'),
      sealing: g('z.sealing'),
      sealed: g('z.sealed'),
      print: g('z.print'),
      printed: g('z.printed'),
      noSale: g('z.noSale'),
      loading: g('z.loading'),
      error: { notReady: g('z.error.notReady'), generic: g('z.error.generic') },
    },
    sync: {
      status: g('sync.status'),
      state: { pending: g('sync.state.pending'), syncing: g('sync.state.syncing'), error: g('sync.state.error'), synced: g('sync.state.synced') },
      pendingTickets: (count) => fill(g('sync.pendingTickets'), { count: String(count) }),
      pendingClosures: (count) => fill(g('sync.pendingClosures'), { count: String(count) }),
      blocked: (hours) => fill(g('sync.blocked'), { hours: String(hours) }),
      retry: g('sync.retry'),
      retryIn: (seconds) => fill(g('sync.retryIn'), { seconds: String(seconds) }),
      cause: { NETWORK: g('sync.cause.NETWORK'), SERVER: g('sync.cause.SERVER'), REJECTED: g('sync.cause.REJECTED') },
    },
    closing: { open: g('closing.open'), back: g('closing.back') },
  };
}

/** Libellés du Ticket Z imprimé : bilingue français / arabe comme le ticket de vente, quelle que soit la langue de l'interface. */
export function zLabelSetOf(locale: FiscaLocale, t: TranslateStrict = translateStrict): ZLabelSet {
  const g = (key: string): string => t(locale, 'common', `ui.pos.z.${key}`);
  return {
    title: g('title'),
    closureNumber: (number) => fill(g('closureNumber'), { number }),
    businessDate: g('businessDate'),
    ticketCount: (count) => fill(g('ticketCount'), { count }),
    ht: (rate) => fill(g('ht'), { rate }),
    vat: (rate) => fill(g('vat'), { rate }),
    stamp: g('stamp'),
    tpeGross: g('tpeGross'),
    hash: g('hash'),
    prevHash: g('prevHash'),
    thanks: g('thanks'),
  };
}

/** Jeux de libellés du ticket imprimé : bilingue français / arabe (Doc_04 § 05, Doc_01 § 13), quelle que soit la langue de l'interface. */
export function receiptLabelSetOf(locale: FiscaLocale, t: TranslateStrict = translateStrict): ReceiptLabelSet {
  const g = (key: string): string => t(locale, 'common', `ui.pos.receipt.${key}`);
  return {
    title: g('title'),
    number: g('number'),
    date: g('date'),
    totalHt: g('totalHt'),
    vat: (rate) => fill(g('vat'), { rate }),
    totalTtc: g('totalTtc'),
    stamp: g('stamp'),
    cash: g('cash'),
    card: g('card'),
    delivery: g('delivery'),
    change: g('change'),
    hash: g('hash'),
    qrCaption: g('qrCaption'),
    thanks: g('thanks'),
  };
}

export function resolveReceiptLabels(t: TranslateStrict = translateStrict): { readonly primary: ReceiptLabelSet; readonly secondary: ReceiptLabelSet } {
  return { primary: receiptLabelSetOf('fr', t), secondary: receiptLabelSetOf('ar', t) };
}
