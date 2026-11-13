# @fisca/qa-harness

Juge mathématique des vecteurs d'or fiscaux et règle ESLint anti-flottant monétaire (ticket T-S0-06).

## Contenu

| Fichier | Rôle |
|---|---|
| `src/fiscal-golden-suite.ts` | Moteur d'assertions en centimes entiers : lecture et validation de `*.vectors.json`, calculateurs de référence (Art. 11-II, loi 69-21, Art. 117, seuil auto-entrepreneur, taux de TVA 2026, décompte BTP), comparaison exacte et rapport d'écarts au centime. Les primitives viennent de `@fisca/shared-types` (`divRoundHalfUpBigInt`, `applyBps`, `ensureSafeInteger`, `assertValidVatRateForIssueYear`). |
| `tests/golden/cgi.vectors.json` | VEC-CGI-01 à 06 (S0). Chaque vecteur porte l'article de loi, la date de la règle, l'état `RECOUPÉ` / `NON RECOUPÉ` / `PROVISOIRE` (ERRATA section E), le calcul détaillé, l'entrée et la sortie exactes. VEC-CGI-07 à 120 : chaque session écrit les siens dans `<paquet>/tests/golden/*.vectors.json` (ERRATA B-09). |
| `tests/fiscal-golden-suite.test.ts` | Rejoue les vecteurs : l'attendu vient du JSON, le calculé du code. |
| `src/eslint-rule-no-float-money.ts` | Règle `fisca/no-float-money`, branchée dans `eslint.config.mjs` racine. |
| `tests/eslint-rule-no-float-money.test.ts` | Tests RuleTester (code fautif refusé, division par `divRoundHalfUpBigInt` acceptée). |

Règles de conception : plafonds, seuils, taux directeur et durées sont des **paramètres d'entrée** des calculateurs (lignes datées de D1, ADR-04), pas des constantes. Après la barrière, modifier une valeur attendue exige le mode orchestrateur.

## Règle `fisca/no-float-money`

Interdit `/`, `/=` et `parseFloat` / `Number.parseFloat` quand une opérande (ou l'argument) lit un identifiant dont le **dernier mot** est `cents`, `bps`, `milli` ou `micro`. Les mots se coupent sur `_` et sur les frontières camelCase ; la casse est indifférente : `totalCents`, `total_cents`, `TOTAL_CENTS`, `vatRateBps`, `qty_milli`, `rateMicro` sont visés ; `percents`, `bpsRate`, `milliseconds` ne le sont pas. L'analyse traverse les opérateurs, accès de membres, conversions TypeScript, `Number(...)`, `BigInt(...)`, `String(...)` et `Math.*` ; un appel à une autre fonction (par exemple `divRoundHalfUpBigInt(...)`) est opaque.

Aucune exception par nom de fonction n'a été nécessaire : la division interne de `divRoundHalfUpBigInt` lit `numerator`, `denominator`, `num`, `den`, qui ne portent pas d'unité. `eslint .` à la racine sur tout le dépôt reste vert.

Hors périmètre de ce paquet : les affichages `Math.trunc(x / 100)` admis par la Loi 1 (`FiscalPrimitives.tsx`) seront signalés par la règle ; la session qui écrit ce composant devra passer par une primitive d'affichage ou demander une dérogation de configuration à l'orchestrateur (aucun `eslint-disable`).

## Calibration de `pnpm verify:fast` (2026-11-13)

Sandbox : 2 vCPU, Node 24.22.3, pnpm 10.34.7, turbo 2.x, 18 workspaces (72 tâches turbo sur `typecheck lint test:unit`). Chaque ligne = 3 mesures, durée murale de `pnpm verify:fast` complet (exit 0).

| Cas | Mesures | Moyenne |
|---|---|---|
| À froid, cache turbo purgé (`rm -rf .turbo node_modules/.cache` et les `.turbo` de chaque workspace) | 41,2 s ; 41,0 s ; 41,3 s | **41,2 s** |
| À chaud, cache turbo plein | 2,63 s ; 2,64 s ; 2,67 s | **2,65 s** |
| Sans cache (`turbo run typecheck lint test:unit --force`, turbo seul) | 40,1 s ; 40,0 s ; 40,4 s | 40,1 s |

Décomposition à froid (turbo, une tâche à la fois, cache purgé avant chacune) : `typecheck` 14,3 s, `lint` 13,4 s, `test:unit` 11,8 s. Étapes hors turbo : `tsc -p scripts/tsconfig.json` 1,1 s, `eslint scripts` 0,85 s, `vitest run scripts` 0,8 s, `pnpm enforce` 0,37 s.

Lecture :

- **Cible de 5 s (B-08)** : tenue à chaud (2,65 s), **dépassée à froid** (41 s sur 2 vCPU). Un dépassement se note, il ne bloque pas. Le temps froid est dominé par le démarrage de 72 processus `tsc`, `eslint` et `vitest` sur 2 cœurs, pour des workspaces presque vides ; il croîtra avec leur contenu (hypothèse non mesurée).
- Aucun contrôle n'a été retiré ni affaibli pour gagner du temps.

### Gains sûrs proposés (non appliqués : `turbo.json` et `scripts` sont hors du périmètre de ce ticket)

1. **Correction de justesse du cache (priorité)** : déclarer dans `turbo.json` `"globalDependencies": ["eslint.config.mjs", "tsconfig.base.json", "packages/qa-harness/src/eslint-rule-no-float-money.ts"]`. Constaté : après ajout d'une ligne à `eslint.config.mjs`, `turbo run lint` rend 24 tâches sur 24 en cache (succès périmé). Une modification de la configuration ou de la règle locale ne relance donc pas le lint des autres workspaces : risque de faux vert, pas un gain de temps.
2. **Entrées de tâche** : `"inputs": ["$TURBO_DEFAULT$", "!README.md", "!**/*.md"]` pour que la documentation n'invalide pas le cache à chaud.
3. **Cache partagé entre sessions** : le cache turbo vit dans `node_modules/.cache/turbo` ; le conserver entre deux tours de boucle d'un même clone (ne pas purger `node_modules`) donne le régime « chaud » (2,65 s) sur les workspaces inchangés.
4. **Ordre des tâches** : turbo lance déjà `lint` et `test:unit` en parallèle ; seule `typecheck` dépend de `^typecheck`. Aucun réordonnancement sûr n'a été identifié ni mesuré.
5. **Chaîne `verify:fast` racine** : les quatre étapes hors turbo (≈ 3 s cumulées) tournent en série après turbo ; les lancer dans la même invocation turbo (workspace racine) les ferait participer au cache. Gain à chaud estimé : 1 à 2 s.
