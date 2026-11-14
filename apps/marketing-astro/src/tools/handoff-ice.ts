import { auditAndRepairIce, normalizeIceCell } from './ice.ts';

/**
 * ICE à joindre au lien d'essai : 15 chiffres, après normalisation (espaces, points, chiffres arabes). Un ICE de 13 ou 14 chiffres
 * perdu par Excel est complété par la même règle que l'auditeur ; tout le reste est refusé (`null`). Le contrôle modulo 97
 * n'est pas exigé ici : c'est un contrôle de cohérence non recoupé (ERRATA E), qui ne doit pas empêcher une inscription.
 */
export function prepareHandoffIce(raw: string): string | null {
  const digits = normalizeIceCell(raw);
  if (/^\d{15}$/.test(digits)) return digits;
  const audited = auditAndRepairIce(raw);
  return audited.status === 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS' ? (audited.normalizedIce15 ?? null) : null;
}
