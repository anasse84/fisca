---
name: fisca-rubrics
description: Méthode de notation des tickets et barrières QA du projet Fisca — noter un ticket, barrière QA, score /100, seuil 95. À charger avant tout audit (R1 conformité fiscale, R2 sécurité, R3 UI/i18n) ou toute évaluation de performance d'un agent de l'usine logicielle.
---

# fisca-rubrics — méthode de notation Fisca

Ce skill décrit comment noter un ticket ou une barrière QA du projet Fisca (SaaS marocain de facturation électronique, dépôt `anasse84/fisca`). Les rubriques exactes sont dans `resources/` : un fichier `.json` fidèle (source de vérité) et un `.md` lisible avec le guide de notation 1–5 de chaque critère.

## 1. Rubriques à utiliser

### Rubriques de barrière (v2, 5 critères, seuil 95/100)

| Rubrique | Fichier | Domaine | Barrières engagées |
|---|---|---|---|
| R1 v2 | `resources/r1-v2.md` / `.json` | Conformité fiscale CGI 2026, grand livre CGNC, flux XSD/EDI | pont S0, G1, G2, G3, G4, S5 |
| R2 v2 | `resources/r2-v2.md` / `.json` | Cybersécurité Zero-Trust, 2FA, E2EE, IA, CNDP, DGSSI | pont S0, G1, G3, G4, S5 |
| R3 v2 | `resources/r3-v2.md` / `.json` | Design Mercury, i18n 6/3 langues, caisse hors-ligne, site Astro | G2, G4, S5 |

Pondérations : R1 = 25/25/20/20/10 ; R2 = 25/20/25/15/15 ; R3 = 20/25/25/15/15.

### Rubriques de performance d'agent (4–5 critères, poids fractionnaires)

`orchestrateur`, `backend`, `edi-erp`, `frontend`, `auditeur`, `curateur` (voir `resources/`). Elles évaluent la qualité de travail d'un agent (briefs, périmètre, gouvernance Git, handoff) et non la conformité d'un ticket.

### Obsolètes — ne pas utiliser

`resources/_obsoletes/` : anciennes R1/R2/R3 à 3-4 critères (2026-11-12), remplacées par les v2. Conservées pour mémoire. (R2 v1 avait des poids bruts 5/4/5/4 non normalisés ; la palette de R3 v1 ne correspondait pas aux tokens du Document 08.)

## 2. Méthode de notation

1. **Charger le skill de domaine** correspondant au périmètre (grand livre, E2EE, caisse hors-ligne, etc.) et lire `docs/specs/ERRATA.md` (il prime sur les 18 spécifications ; le dépôt prime sur les skills).
2. **Délimiter le périmètre** du ticket ou de la barrière (fichiers du diff, tickets de la session, backlog `ops/state/backlog.json`).
3. **Pour chaque critère** de chaque rubrique engagée :
   - vérifier d'abord les **clauses éliminatoires** (début du guide, « CLAUSE ÉLIMINATOIRE ») ;
   - sinon attribuer une note **1, 3 ou 5** (ou 2/4 par interpolation) d'après le guide du critère ;
   - **exiger une preuve** observable : chemin:ligne, commande et sortie, test vert. Une affirmation du constructeur n'est jamais une preuve ; ce qui n'est pas vérifié est déclaré « non vérifié » et ne rapporte pas de points ;
   - si le périmètre ne touche pas le critère, **noter 5 et l'indiquer** explicitement (cas prévu dans les guides).
4. **Calculer le score du critère sur 100** : `note × 20`. (1 → 20, 3 → 60, 5 → 100.)
5. **Calculer le score de la rubrique** : somme pondérée `Σ (poids_critère × score_critère)`. Poids exprimés en fractions de 1 (ex. 0,25) ; si les poids sont bruts (R2 v1), diviser par leur somme.
6. **Clause éliminatoire déclenchée** : le critère est à 1 (20/100) au mieux et la barrière est DÉFAVORABLE ; pour R1-C1 la clause met **toute la rubrique à 0** (flottant monétaire, `parseFloat`, `Math.round((a*b)/c)`, TODO/FIXME/any/`.skip` dans le code livré).
7. **Seuil d'acceptation : 95/100 sur CHAQUE rubrique engagée** (R1, R2, R3 chacune ≥ 95), **et** tous les tests au vert (`pnpm verify:fast` exit 0 ; `scripts/harness-check.sh` exit 0 ; `pnpm verify:gate` aux barrières). Un score ≥ 95 avec un test rouge reste un refus.

## 3. Rôles et limites

- L'auditeur (`Fisca-QA-Security-Auditor`) est **en lecture seule** sur Git : il ne corrige rien, ne commit pas, n'ouvre pas de PR ; il n'écrit que `fisca_master_backlog` (champs permis) et `FISCA_STATE_AND_HANDOFF` (section 05, section par section — jamais `replace` d'une section partagée).
- La fusion sur `main` est réservée à `Fisca-Lead-Orchestrator`, par commit de fusion (jamais squash), après un verdict FAVORABLE ; pas de force-push, pas de suppression de dépôt.
- Refus d'audit : le ticket repart à `TODO` avec `review_notes` ; `retry_count` +1 par échec consécutif sur la même erreur ; circuit breaker à 3 (voir `ops/state/README.md`).
- Le rapport est rédigé **en français** ; en cas de refus, chaque manque est chiffré (delta exact pour atteindre 95) et actionnable sans question de retour.
- Modèle juge : à choisir explicitement à chaque évaluation (jamais « Same as thread »).
- Régime provisoire e-invoicing (ERRATA B-13 révisé) : l'absence de schéma officiel DGI/xHub n'est ni un refus ni une perte de points, mais le verdict porte la mention « conformité officielle non vérifiée » ; ne jamais écrire « conforme/homologué DGI ».

## 4. Format de sortie obligatoire

Le rapport d'audit se termine par **une ligne de verdict unique** :

```
VERDICT <barrière> : FAVORABLE
VERDICT <barrière> : DÉFAVORABLE
```

où `<barrière>` ∈ {`S0`, `G1`, `G2`, `G3`, `G4`, `S5`} (ou l'identifiant du ticket pour un audit de ticket). Elle est précédée du détail :

```
R1 = <score>/100 (C1 <n>, C2 <n>, C3 <n>, C4 <n>, C5 <n>)
R2 = <score>/100 (...)
R3 = <score>/100 (...)
Tests : verify:fast exit <0|n> · harness-check exit <0|n> · verify:gate exit <0|n>
Clauses éliminatoires déclenchées : <aucune | liste>
Non vérifié : <liste>
VERDICT G2 : FAVORABLE
```

`FAVORABLE` ⇔ chaque rubrique engagée ≥ 95, aucune clause éliminatoire, tous les tests verts. Sinon `DÉFAVORABLE`, avec pour chaque rubrique sous 95 la liste des écarts et le changement exact attendu.

## 5. Fichiers

- `resources/<rubrique>.json` : rubrique fidèle (id, nom, description, critères, poids, guides).
- `resources/<rubrique>.md` : version lisible, guide 1–5 par critère.
- `resources/_obsoletes/` : anciennes R1/R2/R3 (remplacées).
