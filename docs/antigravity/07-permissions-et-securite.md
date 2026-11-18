# 07 — Permissions, autonomie et sécurité

Ta consigne Hyperagent : agents entièrement autonomes, sans approbation, mais **jamais de suppression de dépôt ni de force-push**, **fusion sur `main` par l'orchestrateur seul**, pas de push direct sur `main`.

## Traduction en règles `agy` (`~/.gemini/antigravity-cli/settings.json`)
Précédence : **deny > ask > allow**. Le fichier `ops/antigravity/settings.example.json` est prêt : il autorise `git`, `gh pr/run/api`, `pnpm`, `node`, `mvn`, `docker`, l'écriture dans `apps/ packages/ containers/ connectors/ docs/ ops/ scripts/ .agents/ .meta/`, et refuse `sudo`, `git push origin main`, `git push --force`, `gh repo delete`, l'écriture dans `.git/`.

Limite à connaître : **`agy` ne distingue pas quel agent fusionne**. La règle « seul le pilote fusionne » est donc portée par (1) la définition des agents (les constructeurs et l'auditeur n'ont pas `gh pr merge` dans leurs instructions, l'auditeur est en lecture seule), (2) la protection de branche GitHub de `main` (PR obligatoire, force-push interdit), et (3) l'audit du pilote à chaque barrière. Pour un verrou dur, ajoute dans `deny` : `command(gh pr merge)` aux sessions des voies via un fichier de réglages de worktree (`.agents/` du worktree) — le pilote, lui, tourne dans le clone principal avec `gh pr merge` autorisé.

## Modes
- `--sandbox` + `proceed-in-sandbox` : par défaut ; commandes dans le bac à sable du terminal.
- `--dangerously-skip-permissions` : **uniquement** dans un worktree jetable ou un conteneur ; il ne contourne ni les règles `deny`, ni la liste noire système.
- Les tours headless ne peuvent pas demander d'approbation : tout ce qui n'est pas en `allow` est refusé.

## Secrets
Jamais dans le dépôt, jamais dans un prompt. Variables d'environnement du shell (nom documenté dans `.agents/skills/<nom>/ENV.md`), `gh auth` pour GitHub, gestionnaire de secrets du système. Si un secret apparaît dans un fichier : le retirer, le **révoquer**, signaler dans « À trancher ». Test de hygiène avant chaque fusion : recherche de `ghp_`, `github_pat_`, `AIza`, `sk-`, `Bearer `, `-----BEGIN`.

## Serveur MCP GitHub (facultatif)
`.agents/mcp_config.json` : exemple dans `ops/antigravity/mcp_config.example.json` (le jeton est lu depuis l'environnement, jamais écrit). Le CLI `gh` suffit pour tout le flux de Fisca ; MCP n'est utile que si tu veux les mêmes noms d'actions qu'avant (`github__merge_pull_request`, etc.).

À vérifier au prompt M1 : la substitution `${GITHUB_TOKEN}` dans `mcp_config.json` et le nom du paquet du serveur MCP GitHub (agy : `agy mcp add github --type stdio -- <commande>`). Non testé depuis Hyperagent.
