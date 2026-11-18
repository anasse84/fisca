---
id_source: cmwezabx0035m07adnhz6izda
category: domain_knowledge
importance: 3
tags: ["fisca", "rib", "modulo97", "sage100", "nolock"]
whenToUse: "Projet Fisca : tout code ou audit qui valide un RIB ou un IBAN marocain, ou qui écrit ou contrôle une requête SQL Sage 100 (FactorFlow, alerte RIB, double visa DAF, connecteur Sage)."
date_creation: 2026-11-13T12:53:59Z
titre: "RIB & Sage : validateur livré (rib.ts), garde NOLOCK (version B)"
---
# RIB & Sage : validateur livré (rib.ts), garde NOLOCK (version B)

## Contenu intégral (inchangé)

Projet Fisca : décision du propriétaire (document « RIB & SAGE », 2026-11-13). Le RIB marocain a 24 chiffres : banque 3 (≠ 000), localité 3, compte 16 (≠ zéros), clé 2 chiffres de 01 à 97 ; clé = 97 − ((base22 × 100) mod 97), équivalent à N24 mod 97 = 0 ; l'IBAN marocain MA64 + RIB est accepté (64 = 98 − (221000 mod 97), vérifié). Validateur livré dans packages/shared-types/src/rib.ts (main 604c658). Les deux RIB Bank Al-Maghrib cités (001810007800020110620221 et 001810007800020110620318) sont exacts arithmétiquement mais NON RECOUPÉS auprès de la banque. Le garde assertReadOnlySageSql exige WITH (NOLOCK) sur chaque table physique FROM/JOIN, exempte les CTE, refuse la virgule dans FROM.
