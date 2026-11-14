import type { CopyLocale } from '../../i18n/copy-locale.ts';


/** Texte rédigé dans les 4 langues réellement écrites ; zgh-Latn et zgh-Tfng retombent sur le français (T-P2C-03). */
export interface L4<T = string> {
  readonly fr: T;
  readonly en: T;
  readonly ar: T;
  readonly ary: T;
}

export function pick<T>(text: L4<T>, locale: CopyLocale): T {
  return text[locale];
}

export type SiloId = 'clearance' | 'cgi-simpl' | 'metiers-pos' | 'regions';

export const SILO_ORDER: readonly SiloId[] = ['clearance', 'cgi-simpl', 'metiers-pos', 'regions'];

/** Nombre de routes canoniques attendues par silo (Doc_18 S05). Les hubs de silo sont en plus. */
export const SILO_ROUTE_COUNTS: Readonly<Record<SiloId, number>> = {
  clearance: 18,
  'cgi-simpl': 32,
  'metiers-pos': 16,
  regions: 12,
};

export interface CaseLine {
  readonly id: string;
  /** Montant en centimes entiers ; absent pour une ligne de texte (date, code, décompte). */
  readonly cents?: number;
  readonly text?: L4;
}

export interface CaseView {
  readonly id: string;
  /** Vecteurs d'or ou documents dont viennent les montants. */
  readonly basis: readonly string[];
  readonly lines: readonly CaseLine[];
  /** Identifiant de la ligne qui porte le résultat. */
  readonly resultLineId: string;
  /** Clés de `dated-values.ts` utilisées par le calcul. */
  readonly datedKeys: readonly string[];
}

export interface CaseCopy {
  readonly title: L4;
  readonly scenario: L4;
  readonly labels: Readonly<Record<string, L4>>;
  readonly note: L4;
}

export type SourceKind = 'law' | 'xsd' | 'standard' | 'internal';

export interface SourceRef {
  readonly id: string;
  readonly kind: SourceKind;
  readonly label: L4;
  /** Document des spécifications du dépôt qui nomme cette source (traçabilité, rien n'est cité hors spécifications). */
  readonly specRef: string;
}

export interface Fact {
  readonly id: string;
  readonly label: L4;
  readonly value: L4;
  readonly ref: string;
}

export interface FaqText {
  readonly q: L4;
  readonly a: L4;
}

export interface CtaTarget {
  readonly kind: 'trial' | 'pricing';
}

/** Spécification d'une route de silo : données propres à la page, indépendantes de la langue ou en 4 langues. */
export interface SiloPageSpec {
  readonly silo: SiloId;
  readonly slug: string;
  readonly title: L4;
  readonly verdict: L4;
  readonly caseId: string | null;
  readonly facts: readonly string[];
  /** Lignes de tableau propres à la page (régions) : s'ajoutent en tête des faits du glossaire. */
  readonly extraFacts?: readonly Fact[];
  readonly sources: readonly string[];
  readonly faq: FaqText;
  readonly cta: CtaTarget['kind'];
  readonly related: readonly string[];
  /** Étapes HowTo : id de ligne de cas à reprendre dans l'ordre (le HowTo se tire du cas chiffré). */
  readonly howTo: boolean;
}

