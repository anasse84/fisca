/**
 * Profil FEC-MA à 24 colonnes : source unique de l'ordre des colonnes, du séparateur, des fins de ligne et du nom de fichier
 * (Doc_07 S10 ; Doc_14 S05). Aucun autre module ne recopie un nom de colonne : tout part de cette constante.
 *
 * Les 6 extensions marocaines viennent de Doc_07 S10. Les 18 colonnes standard viennent du FEC publié (arrêté du
 * 29 juillet 2013, art. A47 A-1 du LPF) ; leur nom n'a pas été recoupé avec le texte marocain.
 */

// profil provisoire, noms des 18 colonnes standard NON RECOUPÉS avec le texte marocain, à confirmer par le propriétaire
export const FEC_MA_PROVISIONAL_PROFILE = {
  id: 'fec-ma-provisional',
  state: 'PROVISOIRE',
  asOf: '2026-11-13',
  columns: [
    'JournalCode',
    'JournalLib',
    'EcritureNum',
    'EcritureDate',
    'CompteNum',
    'CompteLib',
    'CompAuxNum',
    'CompAuxLib',
    'PieceRef',
    'PieceDate',
    'EcritureLib',
    'Debit',
    'Credit',
    'EcritureLet',
    'DateLet',
    'ValidDate',
    'Montantdevise',
    'Idevise',
    'TiersIF',
    'TiersICE',
    'ClearanceUUID',
    'ModePaiementDGI',
    'EntryHashSHA256',
    'PrevHashSHA256',
  ],
  standardColumnCount: 18,
  extensionColumnCount: 6,
  separator: '|',
  lineEnding: '\r\n',
  encoding: 'utf-8',
  openingJournalCode: 'AN',
  fileNamePattern: '{IF}FEC{YYYYMMDD}.txt',
  specRefs: ['Doc_07 S10', 'Doc_14 S05', 'arrêté du 29 juillet 2013, art. A47 A-1 du LPF (18 colonnes standard)'],
} as const;

export type FecColumnName = (typeof FEC_MA_PROVISIONAL_PROFILE.columns)[number];

/** Position (base 0) d'une colonne du profil ; lève une erreur si le nom n'est pas dans le profil. */
export function fecColumnIndex(name: FecColumnName): number {
  const index = FEC_MA_PROVISIONAL_PROFILE.columns.indexOf(name);
  if (index < 0) throw new RangeError(`Colonne absente du profil FEC-MA : ${name}`);
  return index;
}
