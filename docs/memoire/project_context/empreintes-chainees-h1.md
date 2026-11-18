---
id_source: cmwfl16r4004b07adtwvjpwb3
category: project_context
importance: 5
tags: ["fisca", "hash", "sha256", "genese", "grand-livre", "pih", "pos", "decision-proprietaire"]
whenToUse: "Projet Fisca : grand livre CGNC, clôture d'exercice, PIH de facture (P2-A), chaînage POS et ticket Z, vecteurs d'or de hachage."
date_creation: 2026-11-13T23:02:44Z
titre: "Décision propriétaire H1 : empreintes chaînées SHA-256 (JSON.stringify, genèse)"
---
# Décision propriétaire H1 : empreintes chaînées SHA-256 (JSON.stringify, genèse)

## Contenu intégral (inchangé)

Projet Fisca — décision du propriétaire (2026-11-13, arbitrage H1) sur les empreintes chaînées. Toute empreinte (entry_hash FISCA_GL_ENTRY_V1, closing_hash FISCA_GL_CLOSE_V1, PIH facture FISCA_INV_PIH_V1, ticket POS FISCA_POS_TKT_V1, clôture Z FISCA_POS_Z_V1) = SHA-256 en 64 hexadécimaux minuscules de l'UTF-8 de JSON.stringify([...]) : tuple positionnel sans espace, undefined → null, -0 → 0, colonnes _enc exclues. Le séparateur | est abandonné. Lignes d'écriture triées par lineNumber, journaux de clôture triés par journalCode ASCII. Genèse unique : "GENESIS_HASH_" + "0".repeat(32), 45 caractères (Doc_06), sauf si une colonne DDL déjà livrée impose 64 hexadécimaux par CHECK. Empreinte d'or entry_hash de référence : 821ebcb40a0d4574e3c5ade8d72032d93b73f41bb99041d19fc29322f0c580c5.
