export interface LtrIsolated {
  readonly dir: 'ltr';
  readonly class: string;
  readonly text: string;
}

/** Classe utilitaire : chiffres tabulaires pour montants, ICE, RIB (Doc_08 S03). */
export function fiscaNumClass(): string {
  return 'fisca-tabular-num';
}

/** Montants, ICE, RIB : isolés en dir="ltr" même dans une page rtl (Doc_08 S08). */
export function wrapLtrIsolated(text: string): LtrIsolated {
  return { dir: 'ltr', class: fiscaNumClass(), text };
}
