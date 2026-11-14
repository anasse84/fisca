/**
 * Grille de coupures et pièces du comptage de caisse. La grille vient d'un PORT (jamais codée en dur dans l'application) :
 * la valeur de chaque coupure est un entier de centimes strictement positif. Totaux calculés en bigint, jamais en flottant.
 */

export type DenominationKind = 'banknote' | 'coin';

export interface Denomination {
  readonly id: string;
  readonly valueCents: number;
  readonly kind: DenominationKind;
}

export interface DenominationGridPort {
  listDenominations(): Promise<readonly Denomination[]>;
}

/** Quantité comptée par identifiant de coupure. */
export type CountMap = Readonly<Record<string, number>>;

export type DenominationErrorCode = 'GRID_EMPTY' | 'GRID_INVALID' | 'COUNT_INVALID' | 'COUNT_UNKNOWN_DENOMINATION' | 'TOTAL_OUT_OF_RANGE';

export class DenominationError extends Error {
  readonly code: DenominationErrorCode;
  constructor(code: DenominationErrorCode, message: string) {
    super(message);
    this.name = 'DenominationError';
    this.code = code;
  }
}

export function validateGrid(grid: readonly Denomination[]): void {
  if (grid.length === 0) throw new DenominationError('GRID_EMPTY', 'Grille de coupures vide.');
  const seen = new Set<string>();
  for (const d of grid) {
    if (!Number.isSafeInteger(d.valueCents) || d.valueCents <= 0) throw new DenominationError('GRID_INVALID', `Coupure « ${d.id} » : valeur entière strictement positive exigée (centimes).`);
    if (seen.has(d.id)) throw new DenominationError('GRID_INVALID', `Coupure « ${d.id} » en double.`);
    seen.add(d.id);
  }
}

/** Total compté en centimes entiers ; refuse quantité négative ou décimale, coupure inconnue, total hors entier sûr. */
export function totalCountedCents(grid: readonly Denomination[], counts: CountMap): number {
  const byId = new Map(grid.map((d) => [d.id, d] as const));
  let total = 0n;
  for (const [id, quantity] of Object.entries(counts)) {
    const denomination = byId.get(id);
    if (denomination === undefined) throw new DenominationError('COUNT_UNKNOWN_DENOMINATION', `Coupure inconnue : ${id}.`);
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new DenominationError('COUNT_INVALID', `Quantité de « ${id} » : entier positif ou nul exigé.`);
    total += BigInt(quantity) * BigInt(denomination.valueCents);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new DenominationError('TOTAL_OUT_OF_RANGE', 'Total compté au-delà de l’entier sûr.');
  return Number(total);
}
