/**
 * Ports injectables de l'espace PME (T-P2B-07).
 *
 * Aucune route du registre ne lit la trésorerie, la TVA prévisionnelle, les taux de TVA ni les règles du CGI,
 * et aucune route ne crée un brouillon de facture : l'écran prend donc ses données par ces ports typés.
 * Tous les montants sont des centimes entiers, les taux des points de base, les quantités des milli-unités :
 * jamais de flottant. Aucun taux, plafond, seuil ni date d'obligation n'est défini dans ce dossier : ils
 * arrivent de l'hôte (API / tables AST datées) par ces contrats.
 */

/** Date calendaire ISO `AAAA-MM-JJ`. */
export type IsoDate = string;

export interface TreasuryPoint {
  readonly date: IsoDate;
  /** Encaissements bancaires lettrés cumulés (trait plein), ou `null` quand la date est dans le futur. */
  readonly settledCents: number | null;
  /** Prévision (pointillés), ou `null` pour les dates passées. Calculée par le port, jamais ici. */
  readonly forecastCents: number | null;
  /** Provision de TVA due cumulée, calculée par le port (règles fiscales hors de ce dossier). */
  readonly vatProvisionCents: number | null;
}

export interface VatDueMarker {
  /** Échéance de déclaration fournie par le port (aucune date n'est supposée ici). */
  readonly dueDate: IsoDate;
  readonly amountCents: number;
}

export interface TreasuryForecast {
  readonly asOfDate: IsoDate;
  readonly horizonDays: number;
  readonly points: readonly TreasuryPoint[];
  readonly vatDue: readonly VatDueMarker[];
}

/** Lecture de la courbe de trésorerie et TVA. Route absente du registre : à spécifier (voir rapport T-P2B-07). */
export interface TreasuryForecastSource {
  loadForecast(horizonDays: number, signal?: AbortSignal): Promise<TreasuryForecast>;
}

export type FiscalRuleSeverity = 'info' | 'warning' | 'danger';

export type FiscalRuleParam =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'amountCents'; readonly value: number };

/** Règle datée issue des tables AST (plafond d'espèces, RAS-TVA expirée, seuil auto-entrepreneur…). */
export interface FiscalRule {
  readonly ruleCode: string;
  /** Clé i18n de l'espace `common` portant le message (gabarit avec `{paramètre}`). */
  readonly messageKey: string;
  readonly severity: FiscalRuleSeverity;
  /** Date d'effet de la règle (ISO), fournie par la table datée. */
  readonly effectiveDate: IsoDate;
  /** Référence d'article telle que fournie par la table (ex. « Art. 11-II »), jamais écrite ici. */
  readonly articleRef?: string | undefined;
  readonly params?: Readonly<Record<string, FiscalRuleParam>> | undefined;
}

export type FiscalRuleSurface = 'treasury' | 'invoice';

export interface FiscalRuleSource {
  loadActiveRules(surface: FiscalRuleSurface, signal?: AbortSignal): Promise<readonly FiscalRule[]>;
}

export interface VatRateOption {
  /** Taux en points de base (liste fournie par le port, jamais en dur). */
  readonly rateBps: number;
  /** Code du motif légal quand le taux est nul ou réduit, sinon `null`. */
  readonly legalReasonCode: string | null;
}

export interface VatRateCatalogSource {
  loadRates(onDate: IsoDate, signal?: AbortSignal): Promise<readonly VatRateOption[]>;
}

export interface InvoiceParty {
  readonly nameFr: string;
  readonly nameAr: string | null;
  readonly ice: string | null;
  readonly identifiantFiscal: string | null;
  readonly rcNumber: string | null;
  readonly rcTribunal: string | null;
  readonly legalForm: string | null;
  readonly shareCapitalCents: number | null;
  readonly addressAdc450: string | null;
}

export interface IssuerProfileSource {
  loadIssuer(signal?: AbortSignal): Promise<InvoiceParty>;
}

export interface InvoiceDraftLine {
  readonly designationFr: string;
  readonly designationAr: string;
  readonly quantityMilli: number;
  readonly unitPriceCents: number;
  readonly vatRateBps: number;
  readonly lineHtCents: number;
}

export interface InvoiceDraft {
  readonly invoiceDate: IsoDate;
  readonly customer: InvoiceParty;
  readonly lines: readonly InvoiceDraftLine[];
  readonly vatByRate: readonly { readonly rateBps: number; readonly baseHtCents: number; readonly vatCents: number }[];
  readonly totalHtCents: number;
  readonly totalVatCents: number;
  readonly totalTtcCents: number;
}

export type InvoiceDraftOutcome =
  | { readonly ok: true; readonly invoiceId: string }
  | { readonly ok: false; readonly reason: 'network' | 'rejected' };

/** Enregistrement d'un brouillon. Aucune route de création d'éditeur au registre : à spécifier (rapport T-P2B-07). */
export interface InvoiceDraftSink {
  saveDraft(draft: InvoiceDraft, signal?: AbortSignal): Promise<InvoiceDraftOutcome>;
}
