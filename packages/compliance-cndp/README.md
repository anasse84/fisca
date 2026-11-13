# @fisca/compliance-cndp

Conformité CNDP (Loi 09-08), DGSSI (Loi 05-20) et filtre d'injection de prompt. Code pur, sans accès base.

## Garde souveraine (`assertSovereignEgressAllowed`)

- Mode `STRICT_DGSSI_LAW_05_20_MOROCCO` : seul `MA` est admis, pour tout flux.
- Mode `STANDARD_CNDP_EU_ADEQUACY` : un flux portant des données personnelles ou fiscales exige un pays de
  `CNDP_ADEQUATE_ISO2` ou l'autorisation F118 (Art. 44, Loi 09-08).
- `CNDP_ADEQUATE_ISO2` : les 27 États membres de l'Union européenne + le Maroc (Doc_11 § 03). Tout code inconnu,
  minuscule ou mal formé est refusé (échec fermé).
- **NON RECOUPÉ avec le texte de la Délibération CNDP n° 236-2015.**

## Arbitre DSAR (`evaluateCndpErasureAgainstCgiArt211`)

- Conservation = date de clôture de l'exercice + 10 ans + 1 jour (Doc_11 § 06). Arithmétique entière année/mois/jour.
- `retentionEndDateIso` : dixième anniversaire de la clôture, encore dans la période de conservation (restreint).
  `scheduledCryptoShredDateIso` : lendemain, premier jour où la destruction est autorisée.
- Clôture le 29 février : l'échéance est le 28 février de l'année cible (jamais bissextile pour +10 ans), destruction le 1er mars.
- Date de clôture absente ou invalide : échec fermé, restriction sans échéance, jamais de suppression.
- Vecteurs d'or : `tests/golden/dsar-art211.vectors.json` (état NON RECOUPÉ avec le texte officiel de l'Art. 211 CGI).
