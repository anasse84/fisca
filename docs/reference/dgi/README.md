# Schémas et cahiers des charges officiels

Ce dossier reçoit les fichiers officiels, tels que publiés, sans aucune modification. Il peut rester vide : **aucun ticket n'attend ces fichiers** (`docs/specs/ERRATA.md`, B-13 révisé).

## État au 2026-11-13

| Sujet | Publié officiellement ? | Ce que fait Fisca en attendant |
|---|---|---|
| Décret d'application de l'article 145-IX du CGI (facturation électronique) | Non. Avant-projet transmis au Secrétariat général du gouvernement au printemps 2026 ; rien au Bulletin officiel. | Aucune date ni aucun seuil codés : lignes datées des tables D1, vides. |
| Spécifications techniques de la plateforme de la DGI réalisée par xHub (profil UBL marocain, XSD, Schematron, API) | Non. Annoncées par la DGI en avril 2026, non publiées. | Profil provisoire `cius-ma-provisional` au-dessus des XSD OASIS UBL 2.1 et des règles EN 16931 ; passerelle `ClearanceGateway` en pilote `simulated`. |
| XSD et cahiers des charges des télédéclarations SIMPL (TVA, IS, IR, RAS, délais de paiement) | Oui, par la DGI, sur `tax.gov.ma`, que le bac à sable ne peut pas atteindre. | S'ils sont déposés ici : utilisés tels quels. Sinon : XSD provisoires dérivés de Doc_07 § 08 à § 10. |
| OASIS UBL 2.1, ISO 20022 (`pain.001.001.03`, `camt.053`) | Oui, publics. | Téléchargés par la session depuis leur source officielle (`docs.oasis-open.org` est accessible). |

Sources du constat : presse et cabinets marocains datés de septembre et octobre 2026 (Médias24, Challenge, Le360, Le Matin, relayés par plusieurs éditeurs). À revérifier avant toute mise en production : Bulletin officiel sur `sgg.gov.ma`, et portail de la DGI.

## Fichiers attendus quand ils existeront

| Fichier | Sert à | Emplacement de dépôt |
|---|---|---|
| Profil UBL de la facture électronique marocaine (XSD, Schematron, guide) et spécification de l'API de la plateforme | P2-A, `packages/ubl-xades` | `docs/reference/dgi/e-facture/` |
| SIMPL-TVA : XSD du relevé de déductions et cahier des charges | P3-A, `packages/edi-simpl` | `docs/reference/dgi/simpl-tva/` |
| RAS-TVA, délais de paiement (modèle ADC500B-23I) | P3-A | `docs/reference/dgi/simpl-tva/` |
| SIMPL-IS : liasse, état des ventes, DRVT | P3-A | `docs/reference/dgi/simpl-is/` |
| SIMPL-IR : état 9421 | P3-A | `docs/reference/dgi/simpl-ir/` |

## Remplacer un schéma provisoire par l'officiel

1. Déposer le fichier officiel ici, sans le modifier, avec à côté un fichier `SOURCE.md` : adresse de téléchargement, date, version, empreinte SHA-256. Pull Request `feat/official-schema-<nom>`, fusionnée par Fisca-Lead-Orchestrator.
2. L'orchestrateur ajoute au backlog un ticket `fix/official-schema-<nom>` pour la session propriétaire du paquet : faire pointer `resolveSchema` sur le fichier officiel, relancer `pnpm test:xsd`, corriger les générateurs là où le schéma officiel diffère du provisoire, mettre à jour les vecteurs.
3. À la barrière suivante, l'auditeur vérifie la validation contre le fichier officiel ; le contrat passe de `PROVISIONAL` à `LOCKED` dans `fisca_contracts_registry` et le schéma provisoire est supprimé.
4. Pour la facture électronique, le pilote `live` de `ClearanceGateway` ne s'écrit qu'à partir de la spécification d'API publiée, dans un ticket distinct.
