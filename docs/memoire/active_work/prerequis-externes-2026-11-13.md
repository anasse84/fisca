---
id_source: cmwegzmm002qo07addhyzf8oe
category: active_work
importance: 4
tags: ["fisca", "prealables", "xsd", "dgi", "github-token", "workflows"]
whenToUse: "Projet Fisca : avant de lancer S0, la vague 2, la vague 3 ou P4-C, et quand un ticket est bloqué faute de schéma officiel ou de permission GitHub."
date_creation: 2026-11-13T04:21:47Z
date_maj: 2026-11-13T06:41:13Z
titre: "Prérequis externes (état au 2026-11-13) : XSD DGI provisoires, jeton GitHub, protection main"
---
# Prérequis externes (état au 2026-11-13) : XSD DGI provisoires, jeton GitHub, protection main

> Remarque d'export : l'item (4) (accord npm fil par fil) est propre à Hyperagent, non applicable à Antigravity ; les items (1)-(3) et (5) restent à revérifier (état daté du 2026-11-13, antérieur à l'état du dépôt du 2026-11-15).

## Contenu intégral (inchangé)

Fisca — prérequis externes (état au 2026-11-13). (1) Facturation électronique : le décret d'application de l'art. 145-IX du CGI n'est pas paru au Bulletin officiel et ni la DGI ni xHub n'ont publié de spécification (profil UBL marocain, XSD, Schematron, API). Ce n'est PAS un blocage (ERRATA B-13 révisé) : validation contre les XSD OASIS UBL 2.1 + EN 16931 (PHIVE), règles marocaines dans le profil remplaçable `cius-ma-provisional`, XSD SIMPL provisoires dérivés de Doc_07 si les officiels ne sont pas dans `docs/reference/dgi/`, contrats au statut `PROVISIONAL`, passerelle `ClearanceGateway` en pilote `simulated`. Interdit : présenter un schéma provisoire comme officiel, écrire « conforme/homologué DGI », coder une date ou un seuil de la réforme. (2) Jeton GitHub : expire le 2026-12-12 et n'a pas la permission Workflows, exigée par P4-C (B-12). (3) `main` n'est pas encore protégée (PR obligatoire, 0 approbation, force-push et suppression bloqués) ; la vérification `ci-pr-gate` ne s'exige qu'après la fusion de P4-C. (4) npm : accord à donner fil par fil (pilote + 7 voies), depuis la boîte de réception. (5) `tax.gov.ma` est inaccessible depuis le bac à sable.
