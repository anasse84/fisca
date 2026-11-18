---
id_source: cmwf9vdow015a06adj0gbkn5u
category: domain_knowledge
importance: 3
tags: ["fisca", "sage100", "nolock", "adr-11", "sql", "decision-proprietaire"]
whenToUse: "Projet Fisca : connecteur Sage 100, garde assertReadOnlySageSql, audit des requêtes SQL Server vers Sage."
date_creation: 2026-11-13T17:50:18Z
titre: "Garde SQL Sage 100 (ADR-11) : lecture seule, WITH (NOLOCK) par table"
---
# Garde SQL Sage 100 (ADR-11) : lecture seule, WITH (NOLOCK) par table

## Contenu intégral (inchangé)

Projet Fisca — décision du propriétaire (2026-11-13) sur le garde SQL Sage 100 (ADR-11). La requête doit être en lecture seule. On retire d'abord les commentaires et les littéraux. Sont refusés : écriture, DDL, EXEC, INTO et verrous exclusifs (UPDLOCK, XLOCK, HOLDLOCK, TABLOCKX). Chaque table physique placée après FROM ou JOIN doit porter sa propre clause WITH (NOLOCK), avec ou sans schéma, crochets ou alias. Les noms de CTE en sont exemptés, car SQL Server y interdit les indices. Le comptage global des NOLOCK est rejeté. La jointure implicite par virgule dans FROM reste refusée (règle du pilote, conservée).
