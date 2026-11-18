---
id_source: cmwdknhm002u907ad2nqe1zmh
category: project_context
importance: 4
tags: ["fisca", "github", "ruleset", "branch-protection", "main", "pull-request"]
whenToUse: "Lors de la configuration de la protection de branche ou d'un ruleset GitHub sur anasse84/fisca, ou quand une fusion de Pull Request Fisca est bloquée par une exigence d'approbation."
date_creation: 2026-11-12T13:16:33Z
titre: "Protection de main : PR avec 0 approbation, fusion réservée au pilote"
---
# Protection de main : PR avec 0 approbation, fusion réservée au pilote

## Contenu intégral (inchangé)

Projet Fisca : tous les agents de l'usine (orchestrateur, constructeurs, auditeur, curateur) agissent sur GitHub sous le même compte de l'utilisateur, `anasse84`. GitHub interdit d'approuver sa propre Pull Request. La protection de `main` doit donc exiger une Pull Request avec 0 approbation requise, avec force-push et suppression bloqués. La relecture humaine est remplacée par la barrière QA de l'auditeur (note ≥ 95/100), et la fusion est réservée à Fisca-Lead-Orchestrator.
