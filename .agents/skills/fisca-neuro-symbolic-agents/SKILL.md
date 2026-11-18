---
name: fisca-neuro-symbolic-agents
description: Conception des 11 agents comptables proactifs neuro-symboliques Fisca, mémoire auto-apprenante Hindsight, règles d'arrêt AI Crafters, MCP et bot WhatsApp. À utiliser pour extraction OCR, rapprochement bancaire, agents nocturnes, copilote MCP, session P3-B.
---

# fisca-neuro-symbolic-agents

Méthode de conception des agents IA métiers de Fisca (agents comptables proactifs, bot WhatsApp, workflows nocturnes, rapprochement bancaire, copilote MCP).

## 1. Séparation Neuro-Symbolique

Utiliser Clairic, Docling, Nanonets-OCR-s et AtlasOCR pour extraire, Clef-flash pour qualifier/router, et du code TypeScript pur pour 100 % des calculs. Implémenter `check_answerable` avant de répondre à une question analytique.

## 2. Mémoire Hindsight & Observe-First

- Séparer la mémoire SQLite du Durable Object en `world_facts`, `experiences` et `evolving_opinions` (mise à jour via `reflectOnHumanCorrection` dès qu'un comptable corrige un compte).
- Exécuter les agents nocturnes en mode observe-first (dsh-superagent) sans jamais modifier un journal validé sans clic humain.
- Sur WhatsApp, désactiver le traitement vocal Tamazight et proposer en retour la prise de photo ou la saisie clavier.

## 3. Les 4 Règles d'Arrêt AI Crafters

1. Ne jamais deviner un montant illisible (`[pièce à contrôler]`).
2. Bloquer tout rapprochement bancaire multiple ou ambigu dans le Dossier des Suspens (3497/4497).
3. Ne jamais inventer la cause d'une variation dans le dossier de clôture.
4. Vérifier le dernier échange email/message avant toute relance d'impayé.



## Mise à jour du 2026-11-15 : préparation de la session P3-B (prime sur ce qui précède)

- **Rien n'est encore construit** : `packages/ai-agents` ne contient que son point d'entrée ; session P3-B (voie BACK-1, branche `feat/w3-ai-agents-mcp`), à lancer seulement sur autorisation du propriétaire. Lire `docs/orchestration/preparation-vague-3.md` § 4 avant de commencer.
- **Inférence** : le moteur réel passe par Workers AI (Doc_04 § 08) ; aucun accès ni clé dans le bac à sable : écrire un port d'inférence et un double déterministe, jamais un appel réel dans les tests. Poids TableFormer (docling) : provenance et empreintes non fournies ; poids par chemin monté, empreintes par fichier versionné.
- **À durcir avant ce travail (réserves de G1)** : `EphemeralRamPiiScrubber` (ICE collé à une lettre, retour à la ligne, tiret bas) et filtre d'injection (épellation).
- **Gouvernance** : `canMutateLedgerDirectly = false` ; aucun agent n'écrit dans le grand livre ; mémoire Hindsight : le Durable Object `AgentHindsightMemoryDO` est exporté ; paliers de coût et plafonds injectés, jamais de montant en dur.
- **MCP** : aucun outil n'accepte d'identifiant de société ; portée `mcp:draft` (`MCP_DRAFT_SCOPE`) ; `/.well-known/mcp.json` du site est publié sans portées OAuth et reste PROVISIONAL.
- **Flux SSE d'achats** (CTR-API-22) : le client `apps/web-saas/src/pme/sse-fetch.ts` consomme déjà un format provisoire de 4 événements (`ingestion.queued`, `ocr.fields_extracted`, `cgi.cash_split_alert`, `pcge.account_proposed`) ; le serveur adopte ce format ; permission d'ingestion : `LEDGER_SAVE_DRAFT`.
