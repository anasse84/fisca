<!--
ID canonique : Doc_15_AGENTS_MD   |   Fichier : docs/specs/15-agents-md-constitution.md
Source : « Document 15 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_15_AGENTS_MD#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_15_AGENTS_MD »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 15 — Constitution AGENTS.md
Ce document définit la constitution opératoire AGENTS.md placée à la racine du dépôt GitHub privé fisca, gouvernant l'ensemble des boucles autonomes Hyperagent.com ainsi que vos sessions locales Claude Code et ZCode pour Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_15_AGENTS_MD).
## Section 01 — Rôle Constitutionnel & Compatibilité Multi-Harnais
Le fichier AGENTS.md agit comme le contrat d'exécution déterministe lu automatiquement au démarrage de chaque machine virtuelle Linux avant toute lecture ou écriture de code.
- Source unique de gouvernance : Il condense en règles impératives les arbitrages des Documents 01 à 14 afin qu'un agent comprenne ses limites en moins de 1 800 tokens dès le premier tour.
- Interopérabilité native cloud et terminal local : Lors de la Session S0, un fichier CLAUDE.md pointant vers AGENTS.md est créé à la racine afin que Hyperagent, Claude Code et ZCode appliquent exactement les mêmes lois.
- Immutabilité pendant les boucles de codage : Aucun agent constructeur n'a le droit d'éditer AGENTS.md, les linters ni les vecteurs fiscaux attendus ; seul Fisca-Lead-Orchestrator peut les réviser sur validation humaine.
- Priorité de la preuve console sur le prompt : En cas d'ambiguïté, l'agent interroge les tables partagées et exécute pnpm verify:fast plutôt que de deviner une signature ou un comportement métier.
## Section 02 — Hiérarchie de Lecture Contextuelle (Racine vs Sous-Dossiers)
Pour économiser les tokens d'attention de chaque session, la gouvernance applique un héritage à deux niveaux sans répétition inutile :

| Niveau d'Instruction | Emplacement dans le Dépôt | Taille Max | Quand l'Agent le Lit | Contenu Gouverné |
|---|---|---|---|---|
| Constitution Racine | AGENTS.md (et CLAUDE.md) | 160 lignes | Au démarrage de tout fil | Lois globales, commandes, sécurité |
| Garde Base & Fiscal | packages/db-schema/AGENTS.md | 45 lignes | Travail SQL, CGI ou CGNC | Triggers PAF, centimes, AST D1 |
| Garde XSD & ERP | containers/AGENTS.md | 45 lignes | Travail Java, Python, Sage, Odoo | PHIVE, xmllint, .PNM 108 car. |
| Garde UI, POS & i18n | apps/web-saas/AGENTS.md | 45 lignes | Travail Astro, React ou POS | Tokens Mercury, 6/3 langues, OPFS |

- Principe de non-contradiction : Un fichier AGENTS.md de sous-dossier précise les contraintes techniques locales de son périmètre mais ne peut jamais assouplir une interdiction de la constitution racine.
## Section 03 — Topologie Verrouillée du Monorepo & Isolation des Branches
Lors des vagues parallèles (Vagues 2, 3 et 4), trois sandboxes travaillent simultanément sur le dépôt fisca. L'absence totale de conflit Git repose sur le cloisonnement strict des répertoires ci-dessous :
- Couche Contrats & Socle Partagé (Épine Séquentielle S0–Vague 1) : packages/shared-types, packages/db-schema, packages/auth-rbac, packages/crypto-e2ee, packages/compliance-cndp et packages/qa-harness. Dès la fin de la Vague 1, ces dossiers passent en lecture seule pour les branches parallèles sauf ticket dédié d'orchestration.
- Couche Backend Edge, IA & Fintech : apps/api-hono, apps/standby-vps, packages/fiscal-ast, packages/ai-agents, packages/billing-metering, packages/factorflow et packages/pra-reversibility.
- Couche Clearance, EDI XSD & Connecteurs ERP : containers/fiscal-java, containers/docling-python, containers/camel-bridge, packages/ubl-xades, packages/vault-merkle, packages/edi-simpl, packages/fec-auditor, connectors/odoo-l10n-ma et connectors/sage100-dotnet.
- Couche Acquisition, SaaS, Mobile & Caisse POS : apps/marketing-astro, apps/web-saas, apps/pos-pwa, apps/mobile-capacitor, packages/ui-mercury et packages/i18n.
## Section 04 — Les 10 Lois Inviolables du Domaine Fisca
Tout code soumis par un agent qui enfreint l'une de ces dix lois est automatiquement rejeté par le harnais ou l'agent auditeur :
- Arithmétique entière exclusive (ADR-03) : Zéro flottant monétaire ; utiliser des centimes entiers (_cents), points de base (_bps), milli-unités (_milli), micro-unités BAM (_micro) et divisions entières BigInt.
- Zéro fiscalité codée en dur & LF 2026 (ADR-04) : Évaluer les règles du CGI via le moteur AST JSON en D1 ; n'accepter dès 2026 que les taux de TVA 2000, 1000 et 0 bps motivé (Art. 91/92).
- Inaltérabilité CGNC & Caisse 5161 (ADR-05) : Conserver les triggers SQLite interdisant UPDATE/DELETE sur statut POSTED, bloquer toute caisse 5161 négative et loger la TVA non réglée en 44558/34558.
- Isolation Database-per-Tenant & Auth 2FA (ADR-02, Doc 09) : Résoudre la base D1 uniquement côté serveur après authentification (Google OAuth ou Email/Password + 2FA) et contrôle RBAC / ABAC / SoD ; interdire tout argument tenant_id dans les outils IA/MCP.
- Cryptographie Loi 43-20, E2EE & Shamir (ADR-06 à 08) : Signer en WebCrypto pur via CSC API v2.0 Barid eSign (vérification OID == ICE), lier chaque champ _enc par AAD, indexer en HMAC-SHA256 128 bits, sceller 1 racine de Merkle par jour sur R2 UE et maintenir le séquestre de Shamir 2-sur-3.
- Gouvernance IA & 4 Règles AI Crafters (ADR-10, Doc 13) : Maintenir canMutateLedgerDirectly: false, router selon les 3 paliers FinOps, anonymiser les PII en RAM avant tout appel Niveau 2, ne jamais deviner un montant illisible, isoler tout lettrage ambigu en 3497/4497, ne jamais inventer la cause d'un écart et vérifier le dernier échange avant relance.
- Portabilité Souveraine & Continuité Légale (ADR-12, Doc 11 & 12) : Passer par FiscaInfrastructureAdapter, bloquer tout flux hors Maroc en mode STRICT_DGSSI_LAW_05_20_MOROCCO et laisser l'export décennal ISO 14641 ouvert même en impayé J+15.
- Design Mercury, CSS Logique & 6 vs 3 Langues (Doc 08) : Utiliser uniquement les variables CSS clair/sombre, les classes logiques RTL/LTR, tabular-nums en dir="ltr" sur les nombres, 6 langues sur Astro/PME/POS et strictement 3 langues (fr, ar, en) sur Fiduciaire et Corporate.
- Sécurité ERP & Intégrité Fisca POS (ADR-01, ADR-11) : Interdire toute écriture SQL directe dans Sage 100 (WITH (NOLOCK) en lecture, IPMEncoder ou .PNM 108 caractères en écriture) ; sur Fisca POS, signer chaque ticket hors-ligne par clé ECDSA P-256 non-extractible, masquer l'attendu au comptage aveugle et neutraliser l'assiette B2C lors d'une conversion QR post-Ticket Z.
- Frontières Légales SYNAPTIC SYSTEMS (Doc 01) : Zéro encaissement de factures pour compte de tiers ni crédit sur bilan propre (Loi 103-12 BAM), zéro visa relevant du monopole OEC (Loi 15-89) et zéro revente des PDF officiels OMPIC.
## Section 05 — Commandes Canoniques du Sandbox & Budgets Temps
Les agents utilisent exclusivement ce jeu standardisé de scripts pnpm définis à la racine du fichier package.json :

| Commande Terminal | Portée d'Exécution | Budget Temps | Quand l'Exécuter |
|---|---|---|---|
| bash scripts/bootstrap-sandbox.sh | Outils CLI sandbox Linux | 12,0 s (1 fois) | Ouverture d'un nouveau Thread |
| pnpm verify:fast | Constitution + Types + Lint + L2 | Inférieur à 5,0 s | Après chaque ticket avant commit |
| pnpm --filter <pkg> test | Tests Miniflare L3 du package | 4,0 à 12,0 s | Avant chaque git push |
| pnpm test:xsd | xmllint XSD DGI + Java PHIVE | 16,0 s | Toute modification XML / EDI |
| pnpm verify:gate | Harnais complet 520 tests (L1–L5) | 75,0 s | Barrières QA G1 à G4 et Release |

## Section 06 — Protocole d'Itération Autonome & Disjoncteur
Chaque agent constructeur opérant en mode Auto sur Hyperagent suit un cycle invariant en six pas :
- Synchronisation : Exécuter git fetch origin, vérifier la branche dédiée, lire @fisca_master_backlog, @fisca_contracts_registry et @FISCA_STATE_AND_HANDOFF.
- Verrouillage unitaire : Sélectionner un seul ticket TODO dont les prérequis sont DONE et passer son statut à IN_PROGRESS avant d'éditer un fichier.
- Consultation documentaire juste-à-temps : Ouvrir uniquement la section utile du document de spécification attaché et interroger les serveurs MCP Cloudflare Docs ou Context7 sur toute API externe.
- Développement piloté par les tests : Écrire le test unitaire ou fiscal en premier, implémenter le code complet sans raccourci, puis lancer pnpm verify:fast.
- Disjoncteur à 3 tentatives : Si la commande de validation échoue 3 fois consécutives sur le même ticket, exécuter git checkout -- . && git clean -fd, documenter l'erreur exacte dans 04_Circuit_Breaker_Blockers, marquer le ticket BLOCKED et passer au suivant.
- Publication et fraîcheur de contexte : Après 5 tickets poussés en IN_REVIEW, mettre à jour @FISCA_STATE_AND_HANDOFF et déclencher une Self-delegation vers une instance neuve de soi-même.
## Section 07 — Liste Noire Anti-Hallucination & Sécurité Git
Les actions suivantes constituent des fautes bloquantes vérifiées automatiquement avant chaque commit et chaque fusion :
- Code factice ou inachevé : Ajouter TODO, FIXME, HACK, PLACEHOLDER, retourner un tableau vide simulé en production ou désactiver un test avec .skip ou .only.
- Sabotage du harnais : Modifier la valeur numérique attendue d'un vecteur fiscal dans packages/qa-harness, ajouter @ts-ignore, @ts-expect-error, eslint-disable ou caster en any.
- Opérations Git destructives : Exécuter git push --force, git reset --hard sur une branche distante partagée, fusionner soi-même sur main sans l'approbation de Fisca-QA-Security-Auditor, ou commiter un fichier .env / clé secrète.
- Inventions d'API ou de schémas : Inventer une balise XML absente des schémas .xsd officiels de la DGI ou appeler un endpoint non inscrit dans @fisca_contracts_registry.
## Section 08 — Fichier Complet Prêt-à-Commiter : AGENTS.md Racine
Lors de la Session S0, Fisca-Lead-Orchestrator écrit intégralement le fichier AGENTS.md ci-dessous à la racine du dépôt fisca (et crée CLAUDE.md contenant @AGENTS.md) :

```markdown
# AGENTS.md — Constitution Technique & Métier du Monorepo Fisca (fisca.ma)

Éditeur légal : **SYNAPTIC SYSTEMS SARL AU** (Rabat, Maroc — Compétence : Tribunal de Commerce de Rabat).
Ce fichier gouverne obligatoirement tous les agents IA (Hyperagent.com, Claude Code, ZCode) opérant sur ce dépôt.

## 1. Commandes Obligatoires de Validation
- Initialisation sandbox (1 fois par thread) : `bash scripts/bootstrap-sandbox.sh`
- Vérification obligatoire avant CHAQUE commit (< 5s) : `pnpm verify:fast`
- Validation schémas XML DGI & OASIS UBL 2.1 : `pnpm test:xsd`
- Porte complète d'audit QA (520 tests, réservée Gate QA) : `pnpm verify:gate`

## 2. Les 10 Lois Inviolables de Fisca (Zéro Exception)
1. **ZÉRO FLOAT MONÉTAIRE (ADR-03)** : Stocke et calcule 100 % des montants en centimes entiers (`_cents`, ex: `100,00 MAD = 10000`), taux en points de base (`_bps`, ex: `20 % = 2000`), quantités en `_milli` et cours BAM en `_micro`. Utilise exclusivement l'arithmétique entière `BigInt` (`divRoundHalfUpBigInt`).
2. **ZÉRO RÈGLE FISCALE CODÉE EN DUR (ADR-04)** : Taux CGI, plafonds espèces (5 000 / 50 000 MAD TTC Art. 11-II), RAS-TVA (75 % / 100 % selon attestation < 6 mois Art. 117), Loi 69-21 (départ `service_delivery_date`, arrondi MAD supérieur) et cellules `SIMPL-IS` v2.0.3 proviennent des tables AST JSON en D1. Dès 2026, seuls les taux TVA `2000`, `1000` et `0` bps (motivé Art. 91/92) sont autorisés.
3. **GRAND LIVRE CGNC IMMUABLE (ADR-05)** : Ne contourne jamais les triggers SQLite PAF (`prevent_posted_entry_update` / `delete`). Une pièce `POSTED` ne se corrige que par contre-passation (`reversal_of_entry_id`). Le solde caisse `5161` ne peut jamais devenir négatif. La TVA sur encaissement transite par `44558` / `34558` jusqu'au lettrage effectif (`VAT_CLEARING`).
4. **ISOLATION HERMÉTIQUE D1 & AUTH 2FA (ADR-02, Doc 09)** : 1 base SQLite D1 dédiée par société dès le plan Solo. Résous `TENANT_DB` uniquement côté serveur via le middleware JWT/2FA et `tenant_key_grants`. INTERDICTION ABSOLUE d'accepter `tenantId` ou `companyId` dans un schéma d'outil LLM ou MCP. Respecte la séparation des tâches `SoD` (double visa sur changement de RIB 24 chiffres et signature `pain.001`).
5. **CRYPTO LOI 43-20, E2EE, MERKLE & SOUVERAINETÉ (Doc 10 & 11)** : Signe en WebCrypto pur via `CSC API v2.0` Barid eSign (vérifie `OID` certificat == ICE/IF émetteur). Applique `AAD` (`companyId|table|recordId|column`) sur tout champ `_enc`, Blind Index `HMAC-SHA256` 128 bits sur `_bidx`, séquestre Shamir 2-sur-3 sur `GF(256)`, 1 racine de Merkle quotidienne sur R2 (`jurisdiction = "eu"`), `EphemeralRamPiiScrubber` avant IA Niveau 2, et zéro-egress hors Maroc sur `STRICT_DGSSI_LAW_05_20_MOROCCO`.
6. **GOUVERNANCE IA NEURO-SYMBOLIQUE (ADR-10, Doc 13)** : `canMutateLedgerDirectly = false` partout. Route via Model Tiering (Niveau 0 code pur sur XML/relevés -> Niveau 1 Vision rapide -> Niveau 2 Escalade). Applique les 4 règles d'arrêt AI Crafters : (a) zéro montant deviné (`PIECE_A_CONTROLER`), (b) tout lettrage ambigu en `SUSPENS_AMBIGU_3497_4497`, (c) zéro cause de variation inventée, (d) vérifie le dernier email/WhatsApp avant relance.
7. **PORTABILITÉ INFRA & CONTINUITÉ ART. 211 (ADR-12, Doc 12)** : Passe par `FiscaInfrastructureAdapter` (`CLOUDFLARE_EDGE` + réplication `SignedReplicationDelta` vers `SOVEREIGN_MOROCCO_VPS`). L'export décennal ISO 14641 (`REVERSIBILITY_EXPORT_10Y`) reste ouvert même en impayé J+15 (`RESTRICTED_READ_ONLY`). Zéro migration perturbatrice du 15 au 21 du mois et du 15/02 au 31/03.
8. **DESIGN MERCURY, CSS LOGIQUE & 6 VS 3 LANGUES (Doc 08)** : Variables sémantiques `tokens.css` (clair `#FAF9F5` / sombre `#0B0E14`), classes logiques uniquement (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`), `tabular-nums` + `dir="ltr"` sur tous les montants/ICE/RIB. Active les 6 langues (`fr`, `ar`, `ary`, `zgh-Latn`, `zgh-Tfng`, `en`) sur Astro, PME et POS, et strictement 3 langues (`fr`, `ar`, `en`) sur Fiduciaire OEC et Corporate.
9. **NON-INTRUSION ERP & INTÉGRITÉ FISCA POS (ADR-01, ADR-11)** : Sur Sage 100, lecture `WITH (NOLOCK)` seule et écriture exclusive via `IPMEncoder` (`Objets100cLib`) ou fichier `.PNM` fixe de 108 caractères ASCII + `CRLF`. Sur Fisca POS, signature locale `ECDSA P-256` (`extractable: false`), comptage aveugle caissier et extourne B2C atomique lors d'une conversion QR B2C vers B2B après clôture Z (`UNIQUE(pos_ticket_id)`).
10. **ZÉRO STUB & PÉRIMÈTRE EXCLUSIF (Doc 14)** : Zéro `TODO`, `FIXME`, `PLACEHOLDER`, `any`, `@ts-ignore`, `eslint-disable` ou test `.skip`. Ne modifie AUCUN fichier hors de ton périmètre `FISCA_SCOPE_DIRS` ni aucun test existant de `packages/qa-harness`.

## 3. Protocole de Boucle & Disjoncteur à 3 Essais
- Écris toujours le test Vitest/XSD avant l'implémentation, puis lance `pnpm verify:fast`.
- Inscris toute nouvelle route Hono, table D1 ou binding dans `@fisca_contracts_registry` et régénère `openapi.json`.
- **Circuit Breaker** : Après 3 échecs consécutifs sur un même ticket, exécute `git checkout -- . && git clean -fd`, consigne la trace console dans `@FISCA_STATE_AND_HANDOFF` (`04_Circuit_Breaker_Blockers`), marque le ticket `BLOCKED` et passe au ticket indépendant suivant.
```

## Section 09 — Déclinaisons Locales par Sous-Système Critique
Trois fichiers satellites courts complètent la racine pour guider les agents spécialisés au moment précis où ils entrent dans un sous-dossier :
- Fichier packages/db-schema/AGENTS.md : Rappelle la compatibilité stricte SQLite D1 / PostgreSQL 16 (pas d'extensions non portables), l'obligation des UUIDv7 triables, la convention _enc + _bidx et le passage obligatoire par ensureTenantSchemaUpToDate avec somme de contrôle SHA-256.
- Fichier containers/AGENTS.md : Impose le positionnement exact des balises sensibles des parseurs DGI (<prorata> entre <tx> et <mp> en SIMPL-TVA v4.0 ; <numPPR/> entre <numCE/> et <numCNSS> et <listSalariesCFC/> dans la racine en État 9421 ; omission des codes 11501–11504 en SIMPL-IS v2.0.3 ; journal AN équilibré en tête du FEC-MA à 24 colonnes).
- Fichier apps/web-saas/AGENTS.md (partagé avec apps/pos-pwa) : Impose la double densité 44px / 28px sans saut visuel sous flux SSE (CLS == 0), le repli terminologique fiscal Darija vers Arabe DGI et Tamazight vers Français CGI / lexique IRCAM avec infobulle bilingue en Tifinagh, et les cibles tactiles minimales de 56x56px en caisse.
## Section 10 — Protection Automatique Pré-Commit & Intégrité Git
Pour qu'aucun agent ne puisse ignorer accidentellement AGENTS.md, la Session S0 câble un crochet Git local .githooks/pre-commit activé automatiquement par scripts/bootstrap-sandbox.sh (git config core.hooksPath .githooks) :
- Contrôle de périmètre (FISCA_SCOPE_DIRS) : Si la variable de session définit une liste de répertoires autorisés (ex. packages/ui-mercury,apps/web-saas/src/pme), le commit avorte instantanément si git diff --cached --name-only touche un seul fichier hors de ces dossiers.
- Protection anti-sabotage des gardiens : Interdit sur toute branche feat/* ou fix/* la modification de AGENTS.md, CLAUDE.md, scripts/harness-check.sh, scripts/enforce-constitution.ts et des suites de référence packages/qa-harness.
- Exécution forcée de pnpm verify:fast : Lance la vérification complète en 3,4 secondes avant d'accepter l'enregistrement du commit local.
## Section 11 — Code de Référence : Gardien Statique de la Constitution
Ce script TypeScript sans dépendance lourde ni type any (scripts/enforce-constitution.ts) est appelé en tête de pnpm verify:fast et dans la CI GitHub Actions pour bloquer matériellement toute violation de périmètre, de fenêtre fiscale ou d'intégrité du harnais :

```ts
import { execSync } from "node:child_process";

const PROTECTED_GOVERNANCE_PATHS: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  "scripts/harness-check.sh",
  "scripts/enforce-constitution.ts",
  "packages/qa-harness/src/fiscal-golden-suite.ts",
];

export interface ConstitutionCheckInput {
  readonly currentBranch: string;
  readonly changedFiles: readonly string[];
  readonly allowedScopeDirsCsv?: string; // Ex: "packages/edi-simpl,packages/fec-auditor"
  readonly commitMessage?: string;
  readonly nowIsoDate: string;           // YYYY-MM-DD
  readonly allowOrchestratorOverride: boolean;
}

export interface ConstitutionCheckResult {
  readonly passed: boolean;
  readonly violations: readonly string[];
}

/**
 * Vérifie si une date tombe dans une fenêtre d'échéance fiscale marocaine sanctuarisée (SLA Doc 12)
 */
export function isProtectedMoroccanTaxWindow(isoDate: string): boolean {
  const parts = isoDate.split("-");
  const month = Number.parseInt(parts[1] ?? "0", 10);
  const day = Number.parseInt(parts[2] ?? "0", 10);

  // 1. Du 15 au 21 de chaque mois (SIMPL-TVA, RAS-TVA & CNSS)
  if (day >= 15 && day <= 21) {
    return true;
  }
  // 2. Du 15 février au 31 mars (État 9421 Paie & Clôture annuelle SIMPL-IS / DRVT)
  if ((month === 2 && day >= 15) || month === 3) {
    return true;
  }
  return false;
}

export function verifyConstitutionalCompliance(
  input: ConstitutionCheckInput
): ConstitutionCheckResult {
  const violations: string[] = [];

  // 1. Interdiction aux branches constructeurs d'altérer AGENTS.md ou le harnais QA
  if (!input.allowOrchestratorOverride && input.currentBranch !== "main") {
    for (const file of input.changedFiles) {
      if (PROTECTED_GOVERNANCE_PATHS.includes(file)) {
        violations.push(`ERR_TAMPERED_QA: Modification interdite du fichier protégé [${file}] sur la branche [${input.currentBranch}].`);
      }
    }
  }

  // 2. Verrouillage strict des dossiers exclusifs lors des sessions parallèles
  if (input.allowedScopeDirsCsv && input.allowedScopeDirsCsv.trim().length > 0) {
    const allowedPrefixes = input.allowedScopeDirsCsv
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter((s) => s.length > 0);

    for (const file of input.changedFiles) {
      // Autorise la sauvegarde JSON de métadonnées backlog si prévue
      if (file.startsWith(".meta/")) {
        continue;
      }
      const inScope = allowedPrefixes.some(
        (prefix) => file === prefix || file.startsWith(`${prefix}/`)
      );
      if (!inScope) {
        violations.push(
          `ERR_OUT_OF_SCOPE: Le fichier [${file}] est hors du périmètre FISCA_SCOPE_DIRS (${allowedPrefixes.join(", ")}).`
        );
      }
    }
  }

  // 3. Sanctuarisation des fenêtres fiscales DGI contre les migrations SQL disruptives
  const touchesMigrations = input.changedFiles.some((f) => f.includes("migrations/"));
  const hasBreakingMarker = (input.commitMessage ?? "").includes("[BREAKING_MIGRATION]");
  if (touchesMigrations && hasBreakingMarker && isProtectedMoroccanTaxWindow(input.nowIsoDate)) {
    violations.push(
      `ERR_TAX_FREEZE_WINDOW: Migration disruptive bloquée en pleine échéance fiscale DGI (${input.nowIsoDate}).`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// Exécution directe en ligne de commande dans le sandbox Linux
if (process.argv[1]?.endsWith("enforce-constitution.ts")) {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
  const diffOut = execSync("git diff --cached --name-only", { encoding: "utf8" }).trim();
  const changedFiles = diffOut.length > 0 ? diffOut.split("\n") : [];

  const verdict = verifyConstitutionalCompliance({
    currentBranch: branch,
    changedFiles,
    allowedScopeDirsCsv: process.env["FISCA_SCOPE_DIRS"],
    commitMessage: process.env["FISCA_COMMIT_MSG"],
    nowIsoDate: new Date().toISOString().slice(0, 10),
    allowOrchestratorOverride: process.env["FISCA_ORCHESTRATOR_MODE"] === "1",
  });

  if (!verdict.passed) {
    console.error("VIOLATION CONSTITUTION AGENTS.MD :\n" + verdict.violations.join("\n"));
    process.exit(1);
  }
}
```

## Section 12 — Harnais de Vérification de Gouvernance (Session S0 & Barrières QA)
L'agent Fisca-QA-Security-Auditor vérifie le bon fonctionnement matériel de cette constitution via quatre contrôles automatisés dès la Session S0 :
- Test d'Existence et de Parité Racine : Vérifie la présence non vide de AGENTS.md, CLAUDE.md et des trois fichiers satellites de sous-dossiers, ainsi que l'activation effective de .githooks/pre-commit.
- Test de Rejet Hors-Périmètre Parallèle : Simule FISCA_SCOPE_DIRS="apps/marketing-astro" avec une modification dans packages/db-schema/index.ts et vérifie que verifyConstitutionalCompliance échoue avec ERR_OUT_OF_SCOPE.
- Test d'Auto-Défense du Harnais : Simule une branche feat/w2-ui-pme tentant de modifier AGENTS.md ou packages/qa-harness/src/fiscal-golden-suite.ts et vérifie le blocage immédiat ERR_TAMPERED_QA.
- Test du Verrou Calendaire Fiscal Marocain : Simule un commit portant [BREAKING_MIGRATION] aux dates 2026-11-19 (TVA du 20) et 2027-03-28 (clôture IS du 31 mars) et vérifie le rejet ERR_TAX_FREEZE_WINDOW.
