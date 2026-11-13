# @fisca/qa-harness

Juge mathématique des vecteurs d'or fiscaux et règle ESLint anti-flottant monétaire (ticket T-S0-06).

## Contenu

| Fichier | Rôle |
|---|---|
| `src/fiscal-golden-suite.ts` | Moteur d'assertions en centimes entiers : lecture et validation de `*.vectors.json`, calculateurs de référence (Art. 11-II, loi 69-21, Art. 117, seuil auto-entrepreneur, taux de TVA 2026, décompte BTP), comparaison exacte et rapport d'écarts au centime. Les primitives viennent de `@fisca/shared-types` (`divRoundHalfUpBigInt`, `applyBps`, `ensureSafeInteger`, `assertValidVatRateForIssueYear`). |
| `tests/golden/cgi.vectors.json` | VEC-CGI-01 à 06 (S0 ; VEC-CGI-05 inclut quatre dates illisibles). Chaque vecteur porte l'article de loi, la date de la règle, l'état `RECOUPÉ` / `NON RECOUPÉ` / `PROVISOIRE` (ERRATA section E), le calcul détaillé, l'entrée et la sortie exactes. VEC-CGI-07 à 120 : chaque session écrit les siens dans `<paquet>/tests/golden/*.vectors.json` (ERRATA B-09). |
| `tests/fiscal-golden-suite.test.ts` | Rejoue les vecteurs : l'attendu vient du JSON, le calculé du code. |
| `src/eslint-rule-no-float-money.ts` | Règle `fisca/no-float-money`, branchée dans `eslint.config.mjs` racine. |
| `src/adversarial/pont-s0.adversarial.test.ts` | Tests adverses du verdict du pont S0 (invariants de `shared-types`, dates illisibles, clés de locataire, export du validateur .PNM). |
| `tests/eslint-rule-no-float-money.test.ts` | Tests RuleTester (code fautif refusé, division par `divRoundHalfUpBigInt` acceptée). |

Règles de conception : plafonds, seuils, taux directeur et durées sont des **paramètres d'entrée** des calculateurs (lignes datées de D1, ADR-04), pas des constantes. Après la barrière, modifier une valeur attendue exige le mode orchestrateur.

## Exports de `src/fiscal-golden-suite.ts` (registre CTR-COD-11 : « Art. 11-II, Loi 69-21, RAS-TVA, validateur .PNM »)

| Famille du registre | Noms exportés exacts |
|---|---|
| Art. 11-II | `computeArt11CashSplit` (types `CashCeilingInput`, `CashCeilingOutput`) |
| Loi 69-21 | `computeLaw6921Penalty` (types `Law6921Input`, `Law6921Output`) |
| RAS-TVA (Art. 117) | `computeRasTva` (types `RasTvaInput`, `RasTvaOutput`), `addMonthsClamped` |
| Validateur .PNM | `assertValidSage100PnmBuffer(pnmContent: string \| Uint8Array): { linesCount }`, `PNM_LINE_WIDTH` (108) |
| Autres calculateurs | `computeAutoEntrepreneurSurplus`, `evaluateVatRate`, `assertReadableIssueDate`, `UnreadableIssueDateError` (code `ADR_04_UNREADABLE_ISSUE_DATE`), `computeBtpSettlement`, `computeGoldenCase` |
| Moteur de vecteurs | `loadGoldenVectorFile`, `parseGoldenVectorFile`, `replayGoldenVector`, `diffGolden`, `assertGoldenCase`, `formatDiscrepancyReport`, `GoldenMismatchError`, `GoldenVectorFormatError`, `GOLDEN_STATES`, `GOLDEN_KINDS` |

Validateur `.PNM` (Doc_14 § 11, Loi 9 ; layout Doc_07 § 04) : tampon non vide ; chaque ligne de 108 caractères ASCII imprimables (0x20 à 0x7E) ; fin de ligne CRLF après chaque ligne, dernière comprise ; aucune ligne vide. Layout (positions 1-based) : 1-3 code journal ; 4-9 date JJMMAA ; 10-11 type de pièce ; 12-24 compte général ; 25 type de compte (G ou X) ; 26-38 compte tiers ; 39-51 référence de pièce ; 52-76 libellé ; 77 mode de règlement ; 78-83 échéance JJMMAA ou espaces ; 84 sens `D` ou `C` ; 85-104 montant ; 105 `N` ; 106-108 espaces.

Contrôles et codes d'erreur, dans l'ordre d'évaluation de chaque ligne :

| Code | Contrôle |
|---|---|
| `PNM_EMPTY_FILE`, `PNM_MISSING_TRAILING_CRLF`, `PNM_EMPTY_LINE` | Tampon vide, CRLF final absent, ligne vide. |
| `PNM_NON_ASCII_CHAR` | Accent, octet ≥ 0x80, tabulation, LF ou CR isolé (un `Uint8Array` est lu en latin1). |
| `PNM_INVALID_LINE_LENGTH` | Ligne ≠ 108 caractères (un montant de 19 ou 21 caractères décale la ligne et tombe ici). |
| `PNM_INVALID_DEBIT_CREDIT_FLAG` | Position 84 ≠ `D` / `C`. |
| `PNM_INVALID_AMOUNT_FIELD` | Positions 85 à 104 : `^\s*\d+\.\d{2}$` cadré à droite sur 20 caractères (espaces à gauche seulement), strictement positif ; refus du négatif, du signe, de la virgule décimale, du séparateur de milliers, d'un nombre de décimales ≠ 2, du nul et des espaces à droite. |
| `PNM_INVALID_ENTRY_TYPE_FLAG` | Position 105 ≠ `N`. |
| `PNM_INVALID_RESERVED_ZONE` | Positions 106 à 108 ≠ 3 espaces. |
| `PNM_UNBALANCED_PIECE` | Après les contrôles de toutes les lignes : pour chaque pièce, groupée par (code journal 1-3, date 4-9, référence 39-51), somme des débits ≠ somme des crédits, ou somme nulle (pièce de seulement des débits ou des crédits). |

Les montants sont convertis en centimes entiers par la chaîne (`'1234.50'` devient `123450n`) et sommés en `BigInt` : aucun flottant, aucune dérive au-delà de 2^53. Écart d'un centime = refus. Ligne de référence conforme : `VTE131126FC34210000     XCLI0001      FAC2026000001FACTURE ATLAS SARL       V120127D             1234.50N   `. **Non vérifié** : la cohérence des dates (JJMMAA), des comptes, du type de pièce et du mode de règlement ; Doc_07 § 04 ne décrit pas les positions 106 à 108, leur contenu (3 espaces) vient de la décision du propriétaire.

## Règle `fisca/no-float-money`

Interdit `/`, `/=` et `parseFloat` / `Number.parseFloat` sur toute valeur reconnue comme monétaire, ainsi que `*`, `+`, `-`, `%` (et `*=`, `+=`, `-=`, `%=`) entre une telle valeur et un littéral numérique non entier (message `floatLiteral`, code `ADR_03_FLOAT_FORBIDDEN`). Sans règle typée, trois signaux :

1. **Le nom.** Dernier mot de l'identifiant ou du membre ∈ `cents`, `bps`, `milli`, `micro`, `centimes` (coupure sur `_` et camelCase, casse indifférente) : `totalCents`, `total_cents`, `vatRateBps`, `qty_milli`, `rateMicro`, `Centimes`, `total_centimes` sont visés ; `percents`, `bpsRate`, `milliseconds` ne le sont pas. L'analyse traverse parenthèses, produits, sommes, accès de membres, conversions TypeScript, `Number(...)`, `BigInt(...)`, `String(...)` et `Math.*`, quelle que soit la profondeur.
2. **Une déclaration lisible dans le même fichier**, liée par le gestionnaire de portées d'ESLint (une variable de même nom dans une autre portée n'est pas confondue) : `const ht = centimes(...)` (constructeurs `centimes`, `bps`, `milli`, `micro`), `ht: Centimes` (variable, paramètre), `x as Centimes`. Les propriétés d'interface, de type littéral ou de classe déclarées `: Centimes` (ou `Bps`, `Milli`, `Micro`) rendent monétaire tout accès `obj.<propriété>` du même fichier (suivi par nom de propriété, pas par objet).
3. **L'appel d'une fonction dont le nom porte l'unité** : `applyBps(a, b) / 3`, `centimes(x) / 3`.

`Math.round`, `Math.floor`, `Math.ceil`, `Math.trunc` appliqués directement à une telle division sont signalés une seule fois, par le message `floatRounding` (sur l'appel d'arrondi) ; sans signal monétaire, `Math.floor((lo + hi) / 2)` reste libre.

**Limites connues, sans fausse promesse** : la règle n'a pas accès aux types du compilateur. Elle ne détecte donc PAS : une valeur monétaire dont ni le nom ni la déclaration locale ne portent l'unité (`const ht = computeNet(...)`, résultat d'une fonction ou d'un `await`, propriété d'un objet importé d'un autre fichier, alias `const x = ht`, destructuration `const { ht } = row`, paramètre typé par un alias maison de `Centimes`) ; aucun suivi de flux ni de réaffectation (`let a = 0; a = centimes(1); a / 2` n'est pas vu) ; le suivi des propriétés se fait par nom dans le fichier, il peut sur-signaler une propriété homonyme non monétaire. Les types importés sous un autre nom (`import type { Centimes as C }`) ne sont pas reconnus. Un typage complet exigerait les règles typées de typescript-eslint, non utilisées dans ce dépôt ; en attendant, `tsc` (types marqués `Centimes`, `Bps`) et le scan `scripts/harness-check.sh` complètent la règle.

**Limite levée (réserve 1 du pont S0)** : `ht_cents * 0.2`, `totalCents * 1.2`, `0.2 * ht_cents`, `amountCents + 0.5`, `Number(ht_cents) * 0.2`, `amountBps / 0.5`, `amountCents *= 1.2` sont signalés. Un littéral est « non entier » s'il est écrit avec une virgule (`0.2`, `.5`, `1.0`) ou de valeur fractionnaire (`2.5e-1`) ; `2`, `1e3`, `0x10` restent admis. Le littéral peut être entre parenthèses, signé (`-0.2`) ou enveloppé d'une assertion TypeScript ; l'autre opérande suit les mêmes trois signaux monétaires que pour la division. Le scan `scripts/harness-check.sh` (contrôle 4, `ERR_ADR03_FLOAT`) porte le motif correspondant pour les identifiants à unité (`Cents`, `_cents`, `Centimes`, `Bps`, `_bps`, `Milli`, `_milli`, `Micro`, `_micro`) ; il exclut seulement `eslint-rule-no-float-money.test.ts`, où vivent les fixtures fautives.

**Limites restantes du littéral décimal** : (1) un opérande monétaire sans unité dans le nom ni déclaration locale lisible (`ht * 0.2` où `ht` vient d'un appel ou d'un import) n'est vu ni par la règle ni par le scan (le scan ne lit que les noms) ; (2) le littéral doit figurer en clair dans l'opération : une constante nommée (`const RATE = 0.2; ht_cents * RATE`) ou un littéral calculé (`Number("0.2")`) échappe à la règle et au scan ; (3) les comparaisons (`rate_bps > 0.5`) et les opérateurs `**`, `<<` ne sont pas visés ; (4) le scan est ligne à ligne : une expression coupée sur deux lignes lui échappe (la règle ESLint la voit) ; (5) `x_cents * 1.0` est signalé alors qu'il est numériquement entier : c'est voulu (notation flottante) ; (6) le motif du scan peut sur-signaler un identifiant à unité suivi d'un point décimal dans un commentaire non initial de ligne ou une chaîne.

`divRoundHalfUpBigInt` reste admis par construction : sa division interne lit `numerator`, `denominator`, `num`, `den`, sans unité dans le nom ni déclaration monétaire ; aucun `eslint-disable` n'est utilisé. `eslint .` à la racine reste vert.

Hors périmètre de ce paquet : les affichages `Math.trunc(x / 100)` admis par la Loi 1 (`FiscalPrimitives.tsx`) seront signalés par la règle quand `x` est reconnu monétaire ; la session qui écrit ce composant devra passer par une primitive d'affichage ou demander une dérogation de configuration à l'orchestrateur (aucun `eslint-disable`).

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
