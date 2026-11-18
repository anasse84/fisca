# 08 — Modèles, quotas, coût

Les chiffres de forfait changent : relis `/usage` et la page des forfaits Antigravity avant de t'engager. Ce qui suit vient de la documentation consultée le 2026-11-18 (non garanti).

- **Choix du modèle** : `agy models` liste les identifiants. L'effort se règle par `--effort` (`low` à `max`) ou `/effort`. Le pilote et l'auditeur méritent le modèle le plus fort disponible ; les constructeurs un modèle fort à effort `high`.
- **Disponibilité par forfait** (selon la doc au moment de l'écriture) : Gemini 3.8 Flash partout ; Gemini 4 Argon et les modèles Claude 5.5 à partir de Pro/Ultra ; les modèles tiers (Claude, GPT-OSS) ont un plafond séparé de celui des modèles Gemini.
- **Quotas** : calculés sur le **travail effectué**, pas sur le nombre de prompts ; fenêtres de 5 heures et plafond hebdomadaire sur Pro/Ultra. Une usine à 7 voies consomme beaucoup : prévois un forfait **Ultra** ou le mode **clé d'API** (`"modelProvider": "gemini"` + `GEMINI_API_KEY`, facturation à l'usage) pour la période de construction intense.
- **Lancer moins de voies en parallèle quand le quota est serré** : fixe `FISCA_MAX_LANES` (le pilote en tient compte dans `tick.md` : n'ouvre jamais plus de voies que cette valeur ; défaut 4).
- **Quota épuisé** : le tour sort en code 3 avec une ligne `AGY_ERROR` ; `run-agent.sh` marque la voie `ERROR`/`INCOMPLETE` ; la boucle patiente puis reprend. Rien ne se perd : l'état est dans git, le backlog et la conversation.
- **Tâches planifiées du client bureau** : Gemini 3.5 Flash imposé.
- **Estimation du coût restant** (66 tickets, vagues 3 à S5) : voir le fil « HyperAgent Automated Coding Setup » ; elle ne s'applique pas telle quelle (autre grille de prix). Mesure réelle : lis `/usage` avant et après la première voie de la vague 3 (P3-A) et extrapole par ticket.
