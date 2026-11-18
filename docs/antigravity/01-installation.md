# 01 — Installation pas à pas

Système : macOS, Linux ou Windows 11 sous **WSL2** (Ubuntu). Une machine allumée en continu (ou un petit serveur Linux) est préférable : les boucles de nuit et les voies tournent en tâche de fond.

## 1. Prérequis

| Outil | Version | Pourquoi |
|---|---|---|
| git | 2.40+ | worktrees |
| Node.js | 24 LTS | monorepo pnpm, scripts |
| pnpm | via `corepack enable` | monorepo |
| JDK + Maven | 21 / 3.9+ | `containers/fiscal-java`, `verify:gate` |
| Docker | récent | conteneurs, tests d'intégration |
| gh | récent, `gh auth login` | PR, fusion, workflows |
| tmux, jq | — | voies en arrière-plan |
| Python 3.12 | — | `containers/docling-python` |

## 2. Récupérer le dépôt et lancer l'installateur

```bash
mkdir -p ~/fisca-factory && cd ~/fisca-factory
gh auth login            # jeton avec Contents, Pull requests, Workflows (lecture/écriture)
git clone https://github.com/anasse84/fisca.git
cd fisca && git checkout main
bash ops/antigravity/install.sh
```

L'installateur vérifie chaque prérequis, installe `agy` (`curl -fsSL https://antigravity.google/cli/install.sh | bash`, binaire dans `~/.local/bin/agy`), crée `~/.fisca-runtime/`, copie `settings.example.json` vers `~/.gemini/antigravity-cli/settings.json` **sans écraser un fichier existant**, et lance `pnpm install --frozen-lockfile`.

## 3. Connexion à Antigravity

```bash
agy            # première fois : connexion Google (navigateur ; sur SSH, ouvrir l'URL affichée en local et coller le code)
/models        # ou : agy models   → noter les identifiants réels des modèles
/usage         # quotas restants
```
Mode « clé d'API » (serveur sans navigateur) : mettre `"modelProvider": "gemini"` dans `settings.json` et exporter `GEMINI_API_KEY` (clé créée sur aistudio.google.com/apikey). Ne jamais écrire la clé dans le dépôt.

## 4. Variables à connaître (`ops/antigravity/env.sh`)
`FISCA_HOME` (défaut `~/fisca-factory`), `FISCA_MODEL_PILOT`, `FISCA_MODEL_LANE`, `FISCA_MODEL_AUDIT` (identifiants de `agy models` ; l'auditeur doit avoir le modèle le plus fort), `FISCA_EFFORT` (défaut `high`), `AGY_FLAGS` (défaut `--sandbox`).

## 5. Vérification
```bash
cd ~/fisca-factory/fisca
agy -p "Réponds OK" --output-format json | jq 'keys'    # relever les clés réelles
pnpm verify:fast; echo "exit=$?"                         # attendu 0 (72 tâches)
node --test docs/orchestration/reference/pilot-status.test.mjs
```
Puis passer au prompt **M0** (`03-prompts-migration.md`).
