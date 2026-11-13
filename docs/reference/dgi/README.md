# Schémas et cahiers des charges officiels de la DGI

Ce dossier reçoit les fichiers officiels, tels que publiés, sans modification. Aucun schéma n'est écrit de mémoire : sans le fichier officiel, le ticket concerné passe en `BLOCKED` (`MISSING_INPUT`). Voir `docs/specs/ERRATA.md`, B-13.

| À déposer | Pour | Avant |
|---|---|---|
| Profil UBL 2.1 CIUS-MA de xHub (XSD, Schematron, guide d'implémentation) | P2-A, `packages/ubl-xades/xsd/` | Vague 2 |
| SIMPL-TVA : XSD de l'annexe v4.0 (relevé de déductions) et cahier des charges | P3-A, `packages/edi-simpl/xsd/` | Vague 3 |
| RAS-TVA : XSD RDRS v1.0 et versement mensuel | P3-A | Vague 3 |
| Loi 69-21 : XSD du modèle ADC500B-23I v1.0 | P3-A | Vague 3 |
| SIMPL-IS : XSD de la liasse v2.0.3 (4 modèles), état des ventes, DRVT v2.0.3 | P3-A | Vague 3 |
| SIMPL-IR : XSD de l'état 9421 | P3-A | Vague 3 |
| ISO 20022 : `pain.001.001.03`, `camt.053` | P4-B | Vague 4 |

Les XSD OASIS UBL 2.1 se téléchargent depuis `docs.oasis-open.org`, accessible depuis le bac à sable. Le site `tax.gov.ma` ne l'est pas : les fichiers de la DGI doivent être déposés ici par une Pull Request.
