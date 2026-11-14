/**
 * Profil marocain PROVISOIRE (ERRATA B-13) : règles dérivées de Doc_07, non publiées par la DGI,
 * conformité officielle non vérifiée. Miroir de `profiles/cius-ma-provisional/profile.json`
 * (un test vérifie l'égalité). Les identifiants ci-dessous sont des HYPOTHÈSES de travail :
 * aucun identifiant publié par xHub n'existe, aucun n'est inventé ici.
 */
export const CIUS_MA_PROVISIONAL = {
  name: 'cius-ma-provisional',
  customizationId: 'ma:cius-ma-provisional:1.0',
  profileId: 'ma:cius-ma-provisional:1.0',
  ublVersionId: '2.1',
  statusNotice: 'PROVISOIRE — non publié par la DGI, conformité officielle non vérifiée',
} as const;

/** schemeID des identifiants légaux marocains (Doc_07 « Section 07 ») ; RC, TP et CNSS : hypothèses de nommage. */
export const MA_SCHEME_IDS = {
  ice: 'MA:ICE',
  identifiantFiscal: 'MA:IF',
  rc: 'MA:RC',
  taxeProfessionnelle: 'MA:TP',
  cnss: 'MA:CNSS',
} as const;
