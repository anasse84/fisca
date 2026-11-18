# 04 — Ce qui manque de ta part avant de déclencher les vagues restantes

État au 2026-11-18. **Décisions que tu viens de donner** (à inscrire dans `docs/specs/ERRATA.md` D-25, source : propriétaire, RECOUPÉ) : jeu de **61 comptes** CGNC confirmé ; **une base D1 par société** confirmée (option par défaut : API REST de D1 derrière `createD1TenantDriver`, à mesurer par un spike avant le câblage de production).

Légende : 🔴 BLOCAGE DUR (rien d'utile ne démarre sans) · 🟠 REPLI (la voie continue avec un repli documenté) · 🟢 TOLÉRÉ jusqu'à l'échéance.

## A. À faire sur ta machine, avant de lancer quoi que ce soit (30 à 60 minutes)

| N° | Tâche | Niveau | Comment |
|---|---|---|---|
| A1 | Installer git, Node 24, pnpm, JDK 21, Maven, Docker, gh, tmux, jq, Python 3.12 | 🔴 | `01-installation.md` |
| A2 | `gh auth login` avec un jeton **fin-grained** sur `anasse84/fisca` : Contents, Pull requests, Metadata (lecture/écriture), **Workflows (lecture/écriture)** ; expiration à choisir à ≥ 2027-03 (l'ancien expire le 2026-12-12) | 🔴 pour P4-C (T-P4C-06/07) ; 🟢 avant | github.com → Settings → Developer settings |
| A3 | Installer `agy`, te connecter, noter les identifiants de modèles (`agy models`) et le forfait (`/usage`) | 🔴 | `08-modeles-quotas.md` |
| A4 | Protection de `main` : PR obligatoire, 0 approbation requise, force-push et suppression interdits (les agents agissent tous sous ton compte : GitHub interdit d'approuver sa propre PR, donc ne pas exiger d'approbation) | 🟢 | Settings → Rules |
| A5 | Cloner le dépôt, lancer `bash ops/antigravity/install.sh`, puis M0 à M8 | 🔴 | `03-prompts-migration.md` |
| A6 | Retirer l'ancien jeton GitHub des skills Hyperagent une fois la bascule terminée (hygiène) | 🟢 | Hyperagent → Skills |

## B. Fichiers et données à déposer dans le dépôt

| N° | Quoi | Niveau | Où | Repli si absent |
|---|---|---|---|---|
| B1 | **Cahiers des charges EDI de la DGI** : SIMPL-TVA, SIMPL-IS, 9421, DRVT, Loi 69-21 (annoncés le 2026-11-14, jamais reçus) | 🟠 | `docs/reference/dgi/<sujet>/` + `SOURCE.md` (origine, date, version) | XSD structurels provisoires (D-23), jamais « conforme DGI » |
| B2 | Table des **cellules SIMPL-IS** (cellule, `codeEdi`, règle, tableau) et les **5 opérateurs** du DSL | 🟠 | `docs/reference/dgi/simpl-is/cellules.csv` | Sous-ensemble cité par Doc_07 § 09 |
| B3 | Spécification du **SAF-T « CGNC v2.0 »** | 🟠 | `docs/reference/dgi/saft/` | Structure provisoire dérivée de l'OCDE v2.00 |
| B4 | **Poids de modèles** (TableFormer, OCR) avec empreintes SHA-256, ou autorisation de téléchargement ; choix du **fournisseur d'inférence** (Workers AI ou autre) | 🟠 | `models/README.md` (liens, SHA-256) ; poids hors dépôt | Chemin monté + faux poids dans les tests |
| B5 | **Liste des vues OData BI** | 🟠 | `docs/reference/odata-vues.md` | Vue de balance + vue de TVA, lecture seule |
| B6 | Spécification des routes **d'appairage POS** (`POST /api/v1/pos/terminals/pair`), **de création de dossier** (`POST /api/v1/companies`), **de mandat** (invitation, révocation), **SSO** (SAML, OIDC, SCIM), **payments/*** | 🟠 | `docs/specs/` (nouveau document ou addendum) | Ports, écrans sur doubles |
| B7 | Contenu du **Kit CNDP client** | 🟠 | `docs/reference/cndp/kit-client.md` | Mentions et durées de Doc_11 |
| B8 | Les **6 comptes cités sans fiche** : 4481, 6114, 6193, 6195, 6701, 8600 (libellé, classe, rôle TVA) | 🟠 | `docs/reference/cgnc/comptes-complementaires.csv` | Ils restent hors du jeu de 61 |
| B9 | Décision **`expected_closing_cash_cents`** (ne pas persister avant le dépôt du comptage, ou chiffrer) | 🟠 avant G4 | message à l'orchestrateur → D-26 | Réserve ouverte à G4 |
| B10 | Décision **`RETURN_REFUND`** (confirmer le libellé d'empreinte « RETURN_REFUND ») ou fournir un vecteur | 🟠 | idem | Hypothèse du serveur |
| B11 | **Autorisations** de J2 puis de la vague 3, et feu vert P4-D, J3, J4 | 🔴 | écrites dans le prompt de lancement (`10`) | rien ne démarre |

## C. Comptes, secrets et infrastructure (jamais dans le dépôt)

| N° | Quoi | Niveau | Où le mettre |
|---|---|---|---|
| C1 | **Cloudflare** : compte, jeton API (D1, R2, Queues, Vectorize, Secrets Store, Containers, Workers, Pages), zone `fisca.ma`, noms des ressources | 🟠 jusqu'à S5, 🔴 pour le déploiement | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` dans le gestionnaire de secrets de ta machine, exportés dans le shell de la voie P4-C |
| C2 | **Spike D1 par société** (mesurer création, latence, plafonds par compte) | 🟠 avant câblage de production | décision consignée en D-26 |
| C3 | **Serveur miroir au Maroc** (Casablanca ou Rabat), MinIO, GPU éventuel (mode souverain) | 🟠 | hébergeur à choisir ; accès SSH hors des agents |
| C4 | **ANRT** : DNS, DNSSEC, second fournisseur DNS | 🟢 jusqu'à S5 | — |
| C5 | **Barid eSign** : certificat qualifié, accès HSM (CSC v2.0), horodatage RFC 3161 | 🔴 pour S5 | secrets du déploiement |
| C6 | Comptes réels : **Infobip** (expéditeur FISCA, WhatsApp Business), **Amazon SES** (eu-west-3), **Payzone** + SIMT, **DirectInfo OMPIC**, **Google OAuth** | 🔴 pour S5 | secrets du déploiement |
| C7 | **DGI / xHub** : spécifications publiées et sandbox | 🟢 | la v1.0.0 sort en « Validation simulée » |
| C8 | **Clé de signature** du tag `v1.0.0` et du SBOM | 🟠 | tu signes localement le tag |
| C9 | Récépissés **CNDP** (F115, F211, F112, F118) et DPO | 🟢 | mentions « en cours d'enregistrement » |
| C10 | Tablette réelle pour le test d'autonomie de la caisse (10 tickets en mode avion) | 🔴 pour S5 | — |

## D. Validations humaines

| N° | Quoi | Niveau |
|---|---|---|
| D1 | **Expert-comptable** : relecture de `docs/orchestration/preparation-s5-release.md` § 4 | 🔴 pour la certification fiscale (T-S5-03) |
| D2 | **Relecteurs natifs** : `ar`, `ary`, `zgh-Latn`, `zgh-Tfng`, arrêtés en lettres FR et AR | 🟢 (marqueur « à relire ») |
| D3 | Message final `RELEASE S5 : OUI` | 🔴 pour S5 |

## E. Prompts à passer à Antigravity pour intégrer chaque dépôt de fichiers

**Après avoir déposé B1 à B8** (un seul prompt, orchestrateur) :
```text
J'ai déposé de nouveaux documents de référence dans docs/reference/ (liste : <à compléter>). Branche fix/refs-<date>. Pour chacun : (1) vérifie SOURCE.md (origine, date, version) ; si absent, demande-le et arrête-toi ; (2) compare avec les hypothèses de docs/specs/ERRATA.md D-23 et B-13 et liste les écarts ; (3) mets à jour ERRATA.md par une entrée D-<n> datée (source : propriétaire, RECOUPÉ ou NON RECOUPÉ) ; (4) crée les tickets de reprise (backlog.mjs, session_id, depends_on, branche fix/*) pour remplacer chaque XSD ou jeu de données provisoire ; (5) ne qualifie jamais le produit de « conforme DGI » tant que l'essai xHub officiel n'a pas eu lieu. Ouvre la PR et fusionne-la (commit de fusion) après verify:fast. Termine par la ligne ETAT PILOTE.
```
**Après avoir pris les décisions B9, B10, C2** :
```text
Décisions du propriétaire du <date> : (a) expected_closing_cash_cents : <choix> ; (b) RETURN_REFUND : <choix> ; (c) D1 par société : spike mesuré, option retenue <REST | autre>. Inscris-les dans docs/specs/ERRATA.md (D-26), docs/state section 01 (retire-les de « À trancher »), et ajuste les tickets concernés du backlog. PR fix/errata-owner-<date>, fusion par commit de fusion.
```
**Après avoir configuré les secrets C1, C5, C6** (rien n'est passé à l'agent en clair) :
```text
Les variables d'environnement suivantes sont définies dans ce shell : <NOMS SEULEMENT>. Vérifie leur présence sans jamais afficher leur valeur (test `[ -n "$NOM" ]`), puis débloque les tickets BLOCKED (MISSING_INPUT) correspondants dans le backlog et relance la voie concernée.
```
