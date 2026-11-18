---
id_source: cmwf7t3xo00mv07adls2vap6w
category: project_context
importance: 4
tags: ["fisca", "rib", "iban", "modulo97", "shared-types", "decision-proprietaire"]
whenToUse: "Projet Fisca : validation de RIB ou d'IBAN marocain, alerte RIB FactorFlow, double visa DAF, virement pain.001, ou tout ticket citant le Modulo 97 du RIB."
date_creation: 2026-11-13T16:52:32Z
titre: "RIB marocain 24 chiffres, Modulo 97 (décision propriétaire, version A)"
---
# RIB marocain 24 chiffres, Modulo 97 (décision propriétaire, version A)

## Contenu intégral (inchangé)

Projet Fisca — décision du propriétaire sur le RIB marocain (24 chiffres), qui tranche le flou de Doc_04 § 03. Structure : positions 1-3 code banque (≠ 000), 4-6 code localité, 7-22 compte sur 16 chiffres (≠ seize zéros), 23-24 clé de 01 à 97 (00, 98 et 99 invalides). Clé = 97 − ((base22 × 100) mod 97), calculée en BigInt. C'est équivalent à N24 mod 97 = 0 avec 1 ≤ clé ≤ 97. L'IBAN marocain valide est toujours MA64 + RIB (28 caractères). Les vecteurs BAM fournis sont 001810007800020110620221 (clé 21) et 001810007800020110620318 (clé 18). Statut : recoupé arithmétiquement, NON RECOUPÉ auprès de Bank Al-Maghrib. Le validateur vit dans packages/shared-types et doit être livré avant le gel de ce paquet.
