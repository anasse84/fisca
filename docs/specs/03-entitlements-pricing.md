<!--
ID canonique : Doc_03_Entitlements_Pricing   |   Fichier : docs/specs/03-entitlements-pricing.md
Source : « Document 03 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_03_Entitlements_Pricing#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_03_Entitlements_Pricing »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 03 — Spécification des Entitlements & Pricing
Ce document fige l'architecture de monétisation, les règles de facturation au compteur par dossier fiduciaire, les licences Fisca POS, les droits fonctionnels (Feature Flags), les quotas techniques (Rate Limiting) et la gestion des impayés (Dunning) de Fisca (domaine fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Il comporte 12 sections nommées prêtes à être importées dans Hyperagent avec la portée Project (Doc_03_Entitlements_Pricing).
## Section 01 — Philosophie de Monétisation & Invariants Financiers
Le modèle économique de Fisca élimine tout compteur de crédits IA, tout devis préalable par clic et toute micro-facturation à la pièce comptable afin d'offrir une prévisibilité budgétaire totale.
- Arithmétique entière stricte : Tous les tarifs, remises, soldes de portefeuille et calculs de prorata temporis sont stockés et évalués en centimes entiers (Centimes, ex. 390,00 MAD = 39000) et en points de base (Bps, ex. TVA 20 % = 2000).
- Catalogue 100 % piloté par données : Aucun prix ni quota n'est écrit en dur dans le code React ou Hono ; toute la grille réside dans la base maîtresse CONTROL_PLANE_DB et est mise en cache dans Cloudflare KV.
- Protection des contrats actifs (Grandfathering) : Toute modification tarifaire dans le catalogue s'applique immédiatement aux nouveaux inscrits sans altérer le tarif verrouillé (locked_unit_price_cents) des abonnements annuels en cours jusqu'à leur échéance.
- Auto-conformité fiscale (Self-Dogfooding) : SYNAPTIC SYSTEMS SARL AU émet ses propres factures d'abonnement (soumises à la TVA marocaine au taux normal de 20 %) en format OASIS UBL 2.1 / Factur-X bilingue FR/AR signé Loi 43-20 et certifié sur xHub DGI.
- Autofacturation des rétrocommissions OEC : Les commissions récurrentes de 25 % reversées aux cabinets partenaires sont générées par autofacturation conforme (InvoiceTypeCode = 389 en UBL 2.1).
## Section 02 — Gamme Directe : Auto-Entrepreneurs, TPE & PME (6 Langues)
Les trois forfaits directs s'adressent aux entreprises gérant leur facturation et leur pré-comptabilité en autonomie (interface disponible dans les 6 langues), avec un essai gratuit de 14 jours en mode Sandbox et 2 mois offerts en paiement annuel (facturation sur 10 mois).

| Code Plan | Cible Métier | Mensuel HT | Annuel HT | Sièges & POS Inclus |
|---|---|---|---|---|
| SOLO_AE | Auto-Entrepreneurs | 129 MAD | 1 290 MAD | 1 + 1 Accès Comptable |
| ESSENTIEL_TPE | TPE & Libéraux | 390 MAD | 3 900 MAD | 5 + POS Bridge gratuit |
| CROISSANCE_PME | PME, Négoce & BTP | 890 MAD | 8 900 MAD | 15 + 1 POS Tactile inclus |

- SOLO_AE (154,80 MAD TTC/mois) : Base SQLite D1 dédiée, devis signés OTP, factures bilingues FR/AR hors TVA (Art. 91 CGI), suivi du plafond AE (200k/500k MAD), alerte seuil 80 000 MAD/client (RAS IR 30 %), bot WhatsApp et coffre WORM R2 10 ans.
- ESSENTIEL_TPE (468,00 MAD TTC/mois) : Inclut Solo, Clearance xHub DGI et signature Loi 43-20, E-Reporting B2C, scan OCR IA illimité, notes de frais + ordres de mission, lettrage bancaire, export ZIP SIMPL-TVA v4.0, Fisca POS Bridge et connecteurs Sage/Odoo.
- CROISSANCE_PME (1 068,00 MAD TTC/mois) : Inclut Essentiel, 1 terminal Fisca POS Tactile, Grand Livre CGNC immuable, décomptes BTP (retenue 7 %/10 %), débours, devises BAM, Radar Loi 69-21, RAS-TVA, Liasse SIMPL-IS v2.0.3, État 9421, DRVT et FEC-MA 24 colonnes.
- Sièges utilisateurs additionnels : Au-delà du quota inclus dans ESSENTIEL_TPE ou CROISSANCE_PME, chaque collaborateur supplémentaire est facturé 49 MAD HT/mois (4900 centimes) sans changement forcé de palier.
## Section 03 — Licences Fisca POS Tactile (SCE Art. 145 CGI) & POS Bridge
La monétisation du point de vente distingue l'interfaçage des caisses existantes (gratuit pour accélérer l'adoption comptable) et l'utilisation du logiciel de caisse tactile natif hors-ligne :

| Code Module POS | Périmètre Logiciel | Mensuel HT | Annuel HT | Condition Tarifaire |
|---|---|---|---|---|
| POS_BRIDGE | Connecteur caisses tierces | 0 MAD | 0 MAD | Inclus dès Essentiel / TPE |
| POS_TACTILE_INC | 1ère caisse tactile native | 0 MAD | 0 MAD | Incluse dans Croissance PME |
| POS_TACTILE_STD | Caisse tactile additionnelle | 149 MAD | 1 490 MAD | De 1 à 9 caisses actives |
| POS_TACTILE_FLEET | Tarif Flotte ou Partenaire OEC | 99 MAD | 990 MAD | Dès 10 caisses ou via Cabinet |

- Gratuité stratégique de POS_BRIDGE : L'importation automatisée des clôtures Ticket Z depuis Odoo POS, Foodics, iGoodar, Lightspeed ou Shopify ainsi que la ventilation des commissions TPE (CMI, Payzone, NAPS) et Glovo sont incluses sans surcoût.
- Périmètre d'un terminal POS_TACTILE : Chaque licence couvre un terminal d'encaissement physique identifié (device_fingerprint) avec caissiers illimités par rotation, mode hors-ligne SQLite WASM 72h, chaînage SHA-256 Art. 145 CGI, écran cuisine KDS associé, portail QR de conversion B2C vers B2B xHub et archivage WORM 10 ans des Tickets Z.
- Avantage revendeur pour les Fiduciaires : Tout cabinet comptable abonné bénéficie dès la première caisse du tarif partenaire OEC à 99 MAD HT/mois (9900 centimes) pour équiper ses clients commerçants ou restaurateurs.
## Section 04 — Modèle Fiduciaire au Compteur par Dossier Actif (3 Langues)
Inspiré du moteur open-source de facturation à l'usage Kill Bill, le modèle destiné aux experts-comptables (OEC) et fiduciaires associe un socle cabinet fixe à une facturation unitaire exacte par société cliente active :

| Code Compteur | Composante Facturée | Mensuel HT | Centimes D1 | Remise dès 100 Dossiers |
|---|---|---|---|---|
| CABINET_BASE | Socle Cabinet Marque Blanche | 490 MAD | 49000 | Fixe (non remisé) |
| DOSSIER_SIMPLIFIE | AE, SCI ou Société sans activité | 69 MAD | 6900 | 58,65 MAD (-15 %) |
| DOSSIER_TPE | Tenue CGNC, OCR IA, xHub & TVA | 149 MAD | 14900 | 126,65 MAD (-15 %) |
| DOSSIER_PME_COMPLET | 11 Agents, IS, 9421, DRVT, 69-21 | 249 MAD | 24900 | 211,65 MAD (-15 %) |

- Socle Cabinet (CABINET_BASE) : Inclut le sous-domaine SSL personnalisé en marque blanche via Cloudflare for SaaS, un nombre illimité de collaborateurs comptables, le workflow de visa à 3 niveaux, le serveur MCP cabinet et les connecteurs Sage 100 / Odoo.
- Facturation automatique à la création d'un client : Dès que le cabinet provisionne la base D1 isolée d'un nouveau client en cours de mois, le système calcule le prorata temporis journalier sur les jours restants du mois civil : Montant_Prorata = Arrondi((Tarif_Centimes * Jours_Actifs_Restants) / Total_Jours_Mois).
- Règles anti-abus de changement de profil ou d'archivage : La montée de gamme d'un dossier (DOSSIER_TPE → DOSSIER_PME_COMPLET) prend effet immédiatement au prorata de la différence ; la baisse de gamme prend effet le 1er du mois suivant. Tout dossier créé a une durée minimale de facturation d'un mois complet, et la réactivation d'un dossier archivé depuis moins de 90 jours rétablit son dernier palier actif afin d'empêcher l'activation éphémère d'une journée lors du dépôt annuel de la liasse SIMPL-IS.
- Remise volume automatique à 100 dossiers : Dès que la somme des dossiers actifs (DOSSIER_SIMPLIFIE + DOSSIER_TPE + DOSSIER_PME_COMPLET) atteint ou dépasse 100 au moment de la clôture mensuelle, une remise globale de 15 % (1500 bps) s'applique sur l'ensemble des lignes dossiers.
## Section 05 — Contrats Annuels Grands Comptes & Secteur Public (3 Langues)
Les entreprises réalisant un chiffre d'affaires supérieur à 200 millions MAD HT (ou détenues à plus de 25 % par un grand groupe) ne sont pas éligibles aux subventions Mowakaba et relèvent exclusivement de contrats annuels facturés d'avance par virement bancaire ou Payzone Corporate :

| Code Contrat | Cible Institutionnelle | Contrat Annuel HT | Filiales Incluses | Filiale Suppl. HT |
|---|---|---|---|---|
| ENT_CORPORATE | ETI, Holdings & Groupes privés | 58 000 MAD / an | Jusqu'à 5 ICE | 7 500 MAD / an |
| ENT_SOUVERAIN | Banques, Assurances, OIV, Public | 140 000 MAD / an | Jusqu'à 10 ICE | 10 000 MAD / an |

- ENT_CORPORATE : Utilisateurs illimités, connecteurs ERP Apache Camel et Cloudflare Hyperdrive (SAP, Sage X3, Oracle, Odoo), 3-Way Matching multi-BL (N-to-1), LLM Wiki Contrats BPU, bouclier anti-fraude RIB 24 chiffres + virements ISO 20022 pain.001, matrice SoD, SSO SAML/OIDC, 50 scorings KYB fournisseurs/an et place d'escompte FactorFlow.
- ENT_SOUVERAIN (Conformité Loi 05-20 DGSSI) : Inclut Corporate, chiffrement intégral Zero-Knowledge E2EE avec séquestre fiscal de Shamir 2-sur-3, hébergement base de données primaire/miroir, coffre WORM MinIO et inférence GPU localisés physiquement sur le territoire marocain, SLA garanti de 99,95 %, traces d'audit OpenTelemetry GenAI et 150 scorings KYB fournisseurs/an.
## Section 06 — Packs Subventionnés Mowakaba & Revenus Transactionnels Fintech
Pour accélérer la trésorerie initiale de SYNAPTIC SYSTEMS SARL AU tout en divisant jusqu'à dix fois le coût net pour les TPME et Fiduciaires éligibles (CA ≤ 200 M MAD HT), deux offres packagées clés en main respectent le formalisme des dossiers de remboursement Maroc PME et ADD (80 % à 90 % de prise en charge) :
- PACK_MOWAKABA_TPME (18 000 MAD HT — 21 600 MAD TTC) : Comprend le rapport d'audit IA de maturité numérique, l'assainissement complet de la base tiers ICE/IF, le paramétrage PCGE et Barid eSign Loi 43-20, la formation attestée des équipes et 12 mois d'abonnement CROISSANCE_PME prépayés (reste à charge réel client entre 1 800 et 3 600 MAD HT après subvention).
- PACK_MOWAKABA_CABINET (45 000 MAD HT — 54 000 MAD TTC) : Comprend l'audit du cabinet, la reprise des balances historiques Sage/JBS, le déploiement du portail marque blanche, la certification des collaborateurs, 12 mois de CABINET_BASE inclus et un portefeuille prépayé de 25 000 MAD HT de consommation de dossiers clients (reste à charge réel entre 4 500 et 9 000 MAD HT).
- Commission technologique FactorFlow (0,25 % = 25 bps HT) : Prélevée uniquement au dénouement effectif d'un financement 48h (escompte dynamique ou affacturage inversé bancaire) ; exemple : sur une facture certifiée de 120 000 MAD TTC financée en 48h, Fisca facture 300,00 MAD HT (360,00 MAD TTC) d'apport d'affaires technologique sans jamais détenir les fonds du principal (Loi 103-12 BAM).
- Portefeuille prépayé Scoring IA Fournisseur (KYB_WALLET) : Rechargeable par paliers de 500, 2 000 ou 5 000 MAD HT (sans date d'expiration), débité de 15 MAD HT (1500 centimes) par rapport propriétaire de solvabilité et d'authenticité documentaire fournisseur (0 MAD en cas de cache interne déjà vérifié par l'organisation sous 30 jours, et interdiction absolue de revendre les PDF officiels OMPIC).
La simulation financière ci-dessus illustre l'effet de levier de votre infrastructure Serverless Cloudflare combinée à l'horodatage par Arbre de Merkle quotidien (5,00 MAD/mois de coût marginal par société active), permettant de dégager 97,4 % de marge brute consolidée sur l'ensemble des sept lignes de revenus.
## Section 07 — Matrice Canonique des Feature Flags & Quotas Techniques
Chaque requête entrante sur l'API Hono vérifie les droits de l'organisation via une table normalisée de clés booléennes et numériques afin qu'aucune vérification du type if (plan === 'CROISSANCE') ne soit dispersée dans le code métier :

| Clé Entitlement | Solo / Simplifié | Essentiel / TPE | Croissance / PME | Corporate / Souverain |
|---|---|---|---|---|
| ui_locales_allowed | 6 langues (AE) / 3 (OEC) | 6 langues / 3 (OEC) | 6 langues / 3 (OEC) | 3 langues strictes |
| xhub_b2b_clearance | Factures AE Art. 91 | Illimité + Loi 43-20 | Illimité + BTP / Débours | Illimité Multi-ICE |
| ai_ocr_and_agents | Saisie guidée | OCR illimité + 2 Agents | OCR illimité + 11 Agents | 11 Agents + Wiki BPU |
| edi_simpl_exports | Déclaration CA AE | SIMPL-TVA v4.0 | TVA, IS, 9421, DRVT, FEC | Complet + Consolidation |
| api_rate_limit_rpm | 120 req / min | 300 req / min | 600 req / min | 2 500 req / min |

- Protection anti-abus sans plafond humain (Fair-Use Technique) : Les scans OCR IA et écritures comptables sont illimités pour tout usage professionnel réel, mais protégés au niveau Cloudflare WAF et Durable Object par une limite de lot concurrent (max_concurrent_upload_files : 25 sur Essentiel, 200 sur Croissance, 500 sur Fiduciaire et Corporate).
- Droits exclusifs Haut de Gamme : Les clés three_way_matching_n_bl, rib_fraud_dual_signoff, iso20022_pain001_batch, apache_camel_erp_bridge et sso_saml_oidc sont réservées aux contrats ENT_CORPORATE et ENT_SOUVERAIN ; la clé zero_knowledge_e2ee_strict est incluse dans ENT_SOUVERAIN et activable en option sur CABINET_BASE et ENT_CORPORATE.
## Section 08 — Essai Sandbox 14 Jours, Paiement Payzone & Virement SIMT
- Mode Essai Gratuit 14 Jours (TRIAL_SANDBOX_14D) : Ouvert sans carte bancaire dès la validation OTP Infobip. L'utilisateur teste l'interface, l'enrichisseur ICE, la caisse POS et l'OCR IA (plafonné à 25 pièces d'essai en Sandbox pour prévenir le spam automatisé). Tous les PDF générés portent le filigrane diagonal SPECIMEN SANDBOX — SANS VALEUR FISCALE et pointent exclusivement vers le bac à sable sandbox-xhub.
- Paiement récurrent par Carte Bancaire (Payzone) : Prise en charge des cartes nationales CMI, Visa et Mastercard Corporate avec authentification 3-D Secure v2 à l'enrôlement, génération d'un jeton marchand (payzone_card_token) sans jamais stocker de PAN sur les serveurs de Fisca (conformité PCI-DSS SAQ-A), et débit automatique mensuel ou annuel.
- Règlement par Virement Bancaire SIMT / Prélèvement : Proposé sur les abonnements annuels PME, les cabinets fiduciaires dépassant 2 500 MAD HT/mois et tous les contrats Grands Comptes. Chaque avis d'échéance génère une référence structurée unique (FISCA-SUB-{ORG_ID}-{YYYYMM}) permettant le lettrage automatique dès réception du relevé bancaire de SYNAPTIC SYSTEMS SARL AU.
## Section 09 — Politique de Dunning (Impayés) & Continuité Fiscale Garantie
Au Maroc, couper brutalement l'accès au Grand Livre ou au coffre fiscal d'une entreprise le 18 du mois (veille d'échéance SIMPL-TVA) l'exposerait à de lourdes pénalités DGI. La politique de recouvrement concilie fermeté commerciale et respect absolu de l'Article 211 du CGI :

| Échéance Impayé | État Abonnement | Action Automatique Payzone & Infobip | Droits Conservés par le Client |
|---|---|---|---|
| Jour J0 | PAST_DUE_GRACE_14D | Bannière discrète + Email Amazon SES | 100 % des modules restent actifs |
| Jours J+3 & J+7 | PAST_DUE_GRACE_14D | Re-tentative carte Payzone + WhatsApp | 100 % des modules restent actifs |
| Jour J+12 | PAST_DUE_GRACE_14D | Dernier essai Payzone + SMS FISCA | Préavis avant passage lecture seule |
| Jour J+15 | RESTRICTED_READ_ONLY | Suspension émission, POS & OCR IA | Lecture, réception xHub & Export 10 ans |

- Sanctuarisation des obligations légales à J+15 : En état RESTRICTED_READ_ONLY, l'entreprise ne peut plus émettre de nouvelles factures ni lancer les agents IA, mais continue de recevoir ses factures fournisseurs entrantes xHub (pour ne pas fausser ses délais Loi 69-21), consulte l'intégralité de sa comptabilité et conserve l'accès gratuit au bouton d'Export d'Archive Légale et de Réversibilité Complète (10 ans) (XML UBL, Factur-X, preuves Merkle et FEC-MA 24 colonnes).
- Réactivation instantanée : Dès la régularisation du solde sur Payzone ou validation du virement SIMT, le webhook restaure l'état ACTIVE_PAID en moins de 2 secondes et purge le cache KV des droits.
## Section 10 — Schéma SQL du Moteur d'Entitlements & Metering (CONTROL_PLANE_DB)
Ce DDL SQLite s'exécute exclusivement dans la base maîtresse CONTROL_PLANE_DB :

```sql
-- ============================================================================
-- 1. CATALOGUE DES PLANS & ADD-ONS DYNAMIQUES (CENTIMES ENTIERS & BPS)
-- ============================================================================
CREATE TABLE pricing_catalog (
    plan_code TEXT PRIMARY KEY,          -- 'SOLO_AE', 'ESSENTIEL_TPE', 'CROISSANCE_PME', 'CABINET_BASE', 'ENT_CORPORATE', 'ENT_SOUVERAIN'
    segment TEXT NOT NULL CHECK (segment IN ('DIRECT_PME', 'FIDUCIAIRE', 'ENTERPRISE', 'POS_ADDON', 'MOWAKABA_PACK')),
    billing_cadence TEXT NOT NULL CHECK (billing_cadence IN ('MONTHLY', 'ANNUAL', 'ONE_TIME')),
    unit_price_ht_cents INTEGER NOT NULL CHECK (unit_price_ht_cents >= 0),
    vat_rate_bps INTEGER NOT NULL DEFAULT 2000,
    included_users INTEGER NOT NULL DEFAULT 1,
    included_pos_terminals INTEGER NOT NULL DEFAULT 0,
    included_subsidiaries_ice INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

-- ============================================================================
-- 2. MATRICE DÉCLARATIVE DES FEATURE FLAGS & QUOTAS PAR PLAN
-- ============================================================================
CREATE TABLE plan_entitlements (
    plan_code TEXT NOT NULL REFERENCES pricing_catalog(plan_code),
    feature_key TEXT NOT NULL,           -- Ex: 'edi_simpl_is_liasse', 'three_way_matching_n_bl', 'api_rate_limit_rpm'
    bool_value INTEGER NOT NULL DEFAULT 0,
    numeric_limit INTEGER,               -- NULL = illimité, entier = plafond technique (ex: 600 rpm)
    PRIMARY KEY (plan_code, feature_key)
);

-- ============================================================================
-- 3. ABONNEMENTS DES ORGANISATIONS & SNAPSHOT TARIFAIRE (GRANDFATHERING)
-- ============================================================================
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL UNIQUE,
    plan_code TEXT NOT NULL REFERENCES pricing_catalog(plan_code),
    cadence TEXT NOT NULL CHECK (cadence IN ('MONTHLY', 'ANNUAL')),
    status TEXT NOT NULL CHECK (status IN (
        'TRIAL_SANDBOX_14D', 'ACTIVE_PAID', 'PAST_DUE_GRACE_14D', 'RESTRICTED_READ_ONLY', 'CANCELED_WORM_PRESERVED'
    )),
    locked_base_price_ht_cents INTEGER NOT NULL, -- Protège les contrats en cours contre une hausse catalogue
    trial_ends_at TEXT,
    current_period_start TEXT NOT NULL,  -- YYYY-MM-DD
    current_period_end TEXT NOT NULL,    -- YYYY-MM-DD
    grace_ends_at TEXT,
    payment_method TEXT NOT NULL DEFAULT 'PAYZONE_CARD' CHECK (payment_method IN ('PAYZONE_CARD', 'SIMT_WIRE')),
    payzone_customer_token TEXT,
    extra_seats_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 4. COMPTEUR UNITAIRE PAR DOSSIER CLIENT FIDUCIAIRE (LOGIQUE KILL BILL)
-- ============================================================================
CREATE TABLE fiduciary_dossier_meters (
    id TEXT PRIMARY KEY,
    cabinet_org_id TEXT NOT NULL,
    client_company_id TEXT NOT NULL UNIQUE,
    dossier_tier TEXT NOT NULL CHECK (dossier_tier IN ('DOSSIER_SIMPLIFIE', 'DOSSIER_TPE', 'DOSSIER_PME_COMPLET')),
    pending_next_month_tier TEXT CHECK (pending_next_month_tier IN ('DOSSIER_SIMPLIFIE', 'DOSSIER_TPE', 'DOSSIER_PME_COMPLET')),
    monthly_rate_ht_cents INTEGER NOT NULL, -- 6900, 14900 ou 24900
    activated_on_date TEXT NOT NULL,        -- YYYY-MM-DD (point de départ du prorata journalier)
    minimum_commitment_until TEXT NOT NULL, -- +1 mois minimum anti-abus
    archived_on_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

-- ============================================================================
-- 5. COMPTEUR DES TERMINAUX FISCA POS TACTILES & PORTEFEUILLE PRÉPAYÉ KYB
-- ============================================================================
CREATE TABLE pos_terminal_meters (
    terminal_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    device_fingerprint TEXT NOT NULL,
    is_included_free INTEGER NOT NULL DEFAULT 0, -- 1 pour la 1ère caisse de CROISSANCE_PME
    monthly_rate_ht_cents INTEGER NOT NULL,      -- 0, 9900 (Flotte 10+ / Partenaire OEC) ou 14900
    activated_on_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DECOMMISSIONED'))
);

CREATE TABLE prepaid_wallets (
    organization_id TEXT PRIMARY KEY,
    mowakaba_dossier_credit_ht_cents INTEGER NOT NULL DEFAULT 0, -- Crédit dossiers issu du Pack Mowakaba 45k MAD
    kyb_scoring_balance_ht_cents INTEGER NOT NULL DEFAULT 0,     -- Solde sans expiration (1500 centimes / score)
    updated_at TEXT NOT NULL
);
```

## Section 11 — Moteur TypeScript Déterministe de Metering & Garde Hono
Ce module de référence (packages/billing-metering/src/billing-engine.ts) exécute le calcul au centime près des factures mensuelles fiduciaires, des proratas journaliers et la vérification temps réel des droits :

```ts
import { z } from "zod";

export const DossierTierRatesCents = {
  DOSSIER_SIMPLIFIE: 6900,
  DOSSIER_TPE: 14900,
  DOSSIER_PME_COMPLET: 24900,
} as const;

export type DossierTier = keyof typeof DossierTierRatesCents;

export interface ActiveDossierMeter {
  readonly clientCompanyId: string;
  readonly tier: DossierTier;
  readonly activatedOnDayOfMonth?: number; // Renseigné uniquement si créé durant le mois facturé (1..31)
}

export interface CabinetMonthlyBillingInput {
  readonly cabinetBaseHtCents: number;     // Défaut : 49000 (490,00 MAD HT)
  readonly daysInBillingMonth: number;     // 28, 29, 30 ou 31
  readonly dossiers: readonly ActiveDossierMeter[];
  readonly activePaidPosTerminalsCount: number; // Facturés au tarif partenaire OEC : 9900 centimes
  readonly mowakabaCreditAvailableHtCents: number;
  readonly vatRateBps?: number;            // Défaut : 2000 (20 %)
}

export interface CabinetMonthlyInvoiceSummary {
  readonly activeDossiersCount: number;
  readonly volumeDiscountApplied: boolean;
  readonly baseFeeHtCents: number;
  readonly grossDossiersHtCents: number;
  readonly volumeDiscountHtCents: number;
  readonly netDossiersHtCents: number;
  readonly posTerminalsHtCents: number;
  readonly subtotalBeforeCreditHtCents: number;
  readonly mowakabaCreditConsumedHtCents: number;
  readonly netPayableHtCents: number;
  readonly vatAmountCents: number;
  readonly totalPayableTtcCents: number;
}

/**
 * Calcule le prorata temporis journalier en centimes entiers (Zéro float)
 */
export function computeDailyProrataCents(
  monthlyRateHtCents: number,
  startDayOfMonth: number,
  daysInMonth: number
): number {
  if (startDayOfMonth < 1 || startDayOfMonth > daysInMonth || daysInMonth < 28 || daysInMonth > 31) {
    throw new Error(`BILLING_INVALID_PRORATA_DATES: day=${startDayOfMonth}, daysInMonth=${daysInMonth}`);
  }
  const activeDays = daysInMonth - startDayOfMonth + 1;
  return Math.round((monthlyRateHtCents * activeDays) / daysInMonth);
}

/**
 * Génère la liquidation mensuelle exacte d'un Cabinet Fiduciaire (Remise -15% dès 100 dossiers + POS + Crédit Mowakaba)
 */
export function computeCabinetMonthlyInvoice(
  input: CabinetMonthlyBillingInput
): CabinetMonthlyInvoiceSummary {
  const vatBps = input.vatRateBps ?? 2000;
  let grossDossiersHtCents = 0;

  for (const d of input.dossiers) {
    const fullRate = DossierTierRatesCents[d.tier];
    const lineCents =
      d.activatedOnDayOfMonth !== undefined
        ? computeDailyProrataCents(fullRate, d.activatedOnDayOfMonth, input.daysInBillingMonth)
        : fullRate;
    grossDossiersHtCents += lineCents;
  }

  const activeDossiersCount = input.dossiers.length;
  const volumeDiscountApplied = activeDossiersCount >= 100;
  const volumeDiscountHtCents = volumeDiscountApplied
    ? Math.round((grossDossiersHtCents * 1500) / 10000)
    : 0;

  const netDossiersHtCents = grossDossiersHtCents - volumeDiscountHtCents;
  const posTerminalsHtCents = input.activePaidPosTerminalsCount * 9900;
  const subtotalBeforeCreditHtCents =
    input.cabinetBaseHtCents + netDossiersHtCents + posTerminalsHtCents;

  const mowakabaCreditConsumedHtCents = Math.min(
    input.mowakabaCreditAvailableHtCents,
    netDossiersHtCents
  );

  const netPayableHtCents = subtotalBeforeCreditHtCents - mowakabaCreditConsumedHtCents;
  const vatAmountCents = Math.round((netPayableHtCents * vatBps) / 10000);
  const totalPayableTtcCents = netPayableHtCents + vatAmountCents;

  return {
    activeDossiersCount,
    volumeDiscountApplied,
    baseFeeHtCents: input.cabinetBaseHtCents,
    grossDossiersHtCents,
    volumeDiscountHtCents,
    netDossiersHtCents,
    posTerminalsHtCents,
    subtotalBeforeCreditHtCents,
    mowakabaCreditConsumedHtCents,
    netPayableHtCents,
    vatAmountCents,
    totalPayableTtcCents,
  };
}

export const EntitlementSnapshotSchema = z.object({
  subscriptionStatus: z.enum([
    "TRIAL_SANDBOX_14D",
    "ACTIVE_PAID",
    "PAST_DUE_GRACE_14D",
    "RESTRICTED_READ_ONLY",
    "CANCELED_WORM_PRESERVED"
  ]),
  enabledFeatures: z.array(z.string()),
});

/**
 * Vérificateur déterministe pour le middleware Hono (bloque les écritures à J+15 tout en préservant l'export Art. 211 CGI)
 */
export function assertFeatureAuthorized(
  snapshot: z.infer<typeof EntitlementSnapshotSchema>,
  requiredFeatureKey: string,
  operationKind: "READ_OR_LEGAL_EXPORT" | "MUTATION_OR_AI"
): void {
  if (operationKind === "READ_OR_LEGAL_EXPORT") {
    return; // Garantie légale Art. 211 CGI : consultation et réversibilité 10 ans toujours ouvertes
  }

  if (
    snapshot.subscriptionStatus === "RESTRICTED_READ_ONLY" ||
    snapshot.subscriptionStatus === "CANCELED_WORM_PRESERVED"
  ) {
    throw new Error("ENTITLEMENT_READ_ONLY_MODE: Régularisez votre abonnement pour créer de nouvelles pièces.");
  }

  if (!snapshot.enabledFeatures.includes(requiredFeatureKey)) {
    throw new Error(`ENTITLEMENT_UPGRADE_REQUIRED: La fonctionnalité [${requiredFeatureKey}] requiert un forfait supérieur.`);
  }
}
```

## Section 12 — Vecteurs de Vérification Mathématique (Harnais Vitest)
Lors de la Session P4-B et de la Barrière QA G4, l'agent Fisca-QA-Security-Auditor doit exiger la réussite exacte de ces cinq vecteurs déterministes :
- Prorata mi-mois Dossier TPE & PME : Un dossier créé le 16 novembre 2026 (mois de 30 jours, soit 15 jours actifs inclusivement du 16 au 30) produit exactement 7450 centimes HT (74,50 MAD) en DOSSIER_TPE et 12450 centimes HT (124,50 MAD) en DOSSIER_PME_COMPLET.
- Facture Cabinet Moyen (60 dossiers + 2 caisses POS) : Pour 10 DOSSIER_SIMPLIFIE (69000), 35 DOSSIER_TPE (521500), 15 DOSSIER_PME_COMPLET (373500), 2 caisses POS partenaires (19800) et le socle CABINET_BASE (49000), la facture mensuelle ressort exactement à 1032800 centimes HT (10 328,00 MAD HT), 206560 centimes de TVA (2 065,60 MAD) et 1239360 centimes TTC (12 393,60 MAD TTC).
- Franchissement du seuil de 100 dossiers (-15 %) : Pour 20 DOSSIER_SIMPLIFIE, 50 DOSSIER_TPE et 30 DOSSIER_PME_COMPLET (100 dossiers, brut variable 1630000 centimes), la remise volume soustrait exactement 244500 centimes ; avec le socle de 49000 centimes, le net HT vaut 1434500 centimes (14 345,00 MAD HT) et le TTC 1721400 centimes (17 214,00 MAD TTC).
- Commission FactorFlow (25 bps) : Sur une facture certifiée de 120 000,00 MAD TTC (12000000 centimes) mobilisée en 48h, la commission technologique HT vaut exactement 30000 centimes (300,00 MAD HT), soit 36000 centimes TTC (360,00 MAD TTC).
- Sanctuarisation Art. 211 CGI à J+15 : Une organisation en statut RESTRICTED_READ_ONLY reçoit une erreur bloquante sur POST /api/v1/invoices, mais obtient un code HTTP 200 sur GET /api/v1/reversibility/export-10y et sur le webhook entrant de réception xHub.

## Annexe V — Code de vérification numérique

> Origine : fichier `code.docx` fourni par le propriétaire du projet le 2026-11-13. C'est le code Python qui a servi à calculer et à contrôler les chiffres de ce document, suivi de la sortie obtenue par l'auteur.
> Chaque bloc a été réexécuté le 2026-11-13 (Python 3.12) et sa sortie comparée à celle de l'auteur. Pour le refaire : `python3 docs/specs/verification/verify-annexes.py`.
> Statut : pièce justificative des chiffres, pas du code de production. Elle n'ajoute aucune exigence et ne se copie dans aucun paquet. En cas d'écart avec le corps du document, `ERRATA.md` tranche.

> Les montants attendus (7 450, 12 450, 244 500, 1 239 360, 30 000 centimes…) font foi. En production, tout prorata passe par `divRoundHalfUpBigInt` (ERRATA D-09).

### V.1 — Grille tarifaire, prorata journalier, remise fiduciaire et commission FactorFlow

<!-- verif:03-01:code -->
```python
# Verify all pricing figures, centimes, VAT 20%, annual (10 months = 2 months free), prorata examples, and Vitest vectors for Document 03

vat_bps = 2000 # 20%

def compute_ttc(ht_cents):
    vat_cents = round((ht_cents * vat_bps) / 10000)
    return ht_cents, vat_cents, ht_cents + vat_cents

# 1. Direct PME Plans
pme_plans = {
    "SOLO_AE": 12900,        # 129.00 MAD HT
    "ESSENTIEL_TPE": 39000,  # 390.00 MAD HT
    "CROISSANCE_PME": 89000, # 890.00 MAD HT
}

print("=== PME PLANS ===")
for k, ht in pme_plans.items():
    _, vat, ttc = compute_ttc(ht)
    ann_ht = ht * 10
    _, ann_vat, ann_ttc = compute_ttc(ann_ht)
    print(f"{k}: Monthly HT={ht}c ({ht/100:.2f} MAD), TTC={ttc/100:.2f} MAD | Annual HT={ann_ht}c ({ann_ht/100:.2f} MAD), TTC={ann_ttc/100:.2f} MAD")

# 2. POS Add-on
pos_std = 14900   # 149.00 MAD HT / caisse
pos_fleet = 9900  # 99.00 MAD HT / caisse (10+ caisses or Fiduciary partner rate)
print("\n=== POS ADD-ONS ===")
for label, ht in [("POS Standard", pos_std), ("POS Fleet 10+ / Partner OEC", pos_fleet)]:
    _, vat, ttc = compute_ttc(ht)
    print(f"{label}: Monthly HT={ht}c ({ht/100:.2f} MAD), TTC={ttc/100:.2f} MAD | Annual HT={ht*10/100:.2f} MAD")

# 3. Fiduciary Metering Test Vectors
# Vector 1: Mid-month addition on November 16, 2026 (30-day month, inclusive days from 16 to 30 = 15 days active out of 30)
# Wait: let's define exact convention: active_days = total_days_in_month - start_day + 1 (if added on day 1 -> 30/30 = 100%; if added on day 16 of 30-day month -> 30 - 16 + 1 = 15/30 = 50%)
days_in_nov = 30
start_day = 16
active_days = days_in_nov - start_day + 1 # 15 days
prorata_tpe_cents = round((14900 * active_days) / days_in_nov)
prorata_pme_cents = round((24900 * active_days) / days_in_nov)
print(f"\nProrata 15/30 days: TPE={prorata_tpe_cents}c ({prorata_tpe_cents/100:.2f} MAD), PME={prorata_pme_cents}c ({prorata_pme_cents/100:.2f} MAD)")

# Vector 2: Cabinet with 60 full-month dossiers (10 Simplifies @ 6900, 35 TPE @ 14900, 15 PME @ 24900) + 2 POS Partner terminals @ 9900 + Base 49000
cab60_base = 49000
cab60_var = 10 * 6900 + 35 * 14900 + 15 * 24900 # 69000 + 521500 + 373500 = 964000
cab60_pos = 2 * 9900 # 19800
cab60_ht = cab60_base + cab60_var + cab60_pos
_, cab60_vat, cab60_ttc = compute_ttc(cab60_ht)
print(f"Cabinet 60 + 2 POS: Base={cab60_base}c, Var={cab60_var}c, POS={cab60_pos}c -> HT={cab60_ht}c ({cab60_ht/100:.2f} MAD), TVA={cab60_vat}c ({cab60_vat/100:.2f} MAD), TTC={cab60_ttc}c ({cab60_ttc/100:.2f} MAD)")

# Vector 3: Cabinet crossing 100 dossiers -> 100 dossiers (20 Simplifies @ 6900, 50 TPE @ 14900, 30 PME @ 24900) -> 15% volume discount on variable dossiers
cab100_raw_var = 20 * 6900 + 50 * 14900 + 30 * 24900 # 138000 + 745000 + 747000 = 1630000
cab100_disc_cents = round((cab100_raw_var * 1500) / 10000) # 244500
cab100_net_var = cab100_raw_var - cab100_disc_cents # 1385500
cab100_ht = 49000 + cab100_net_var # 1434500
_, cab100_vat, cab100_ttc = compute_ttc(cab100_ht)
print(f"Cabinet 100 (-15%): RawVar={cab100_raw_var}c, Disc={cab100_disc_cents}c, NetVar={cab100_net_var}c, TotalHT={cab100_ht}c ({cab100_ht/100:.2f} MAD), TVA={cab100_vat}c, TTC={cab100_ttc}c ({cab100_ttc/100:.2f} MAD)")

# Vector 4: FactorFlow 0.25% (25 bps) tech commission on a 120,000.00 MAD TTC invoice (12,000,000 centimes)
inv_ttc = 12000000
ff_fee_ht = round((inv_ttc * 25) / 10000) # 30000 centimes = 300.00 MAD HT
_, ff_vat, ff_ttc = compute_ttc(ff_fee_ht)
print(f"FactorFlow 25 bps on 120,000 MAD: Fee HT={ff_fee_ht}c ({ff_fee_ht/100:.2f} MAD), TTC={ff_ttc}c ({ff_ttc/100:.2f} MAD)")
```

Résultat du code (réexécution : identique) :

<!-- verif:03-01:resultat -->
```text
=== PME PLANS ===
SOLO_AE: Monthly HT=12900c (129.00 MAD), TTC=154.80 MAD | Annual HT=129000c (1290.00 MAD), TTC=1548.00 MAD
ESSENTIEL_TPE: Monthly HT=39000c (390.00 MAD), TTC=468.00 MAD | Annual HT=390000c (3900.00 MAD), TTC=4680.00 MAD
CROISSANCE_PME: Monthly HT=89000c (890.00 MAD), TTC=1068.00 MAD | Annual HT=890000c (8900.00 MAD), TTC=10680.00 MAD

=== POS ADD-ONS ===
POS Standard: Monthly HT=14900c (149.00 MAD), TTC=178.80 MAD | Annual HT=1490.00 MAD
POS Fleet 10+ / Partner OEC: Monthly HT=9900c (99.00 MAD), TTC=118.80 MAD | Annual HT=990.00 MAD

Prorata 15/30 days: TPE=7450c (74.50 MAD), PME=12450c (124.50 MAD)
Cabinet 60 + 2 POS: Base=49000c, Var=964000c, POS=19800c -> HT=1032800c (10328.00 MAD), TVA=206560c (2065.60 MAD), TTC=1239360c (12393.60 MAD)
Cabinet 100 (-15%): RawVar=1630000c, Disc=244500c, NetVar=1385500c, TotalHT=1434500c (14345.00 MAD), TVA=286900c, TTC=1721400c (17214.00 MAD)
FactorFlow 25 bps on 120,000 MAD: Fee HT=30000c (300.00 MAD), TTC=36000c (360.00 MAD)
```

### V.2 — Portefeuille des 7 lignes de revenus (revenu, coût marginal, marge)

<!-- verif:03-02:code -->
```python
import json

# Let's compute a clean portfolio comparison across all 7 revenue lines of Fisca (per customer unit / monthly equivalent HT in MAD)
# Wait: let's check unit monthly revenue HT vs monthly infrastructure marginal cost vs gross margin per customer archetype:
# 1. Fisca Solo (AE): 129.00 MAD HT/mo, infra = 2.50 MAD/mo -> margin = 126.50 MAD (98.1%)
# 2. Fisca Essentiel (TPE): 390.00 MAD HT/mo, infra = 5.00 MAD/mo -> margin = 385.00 MAD (98.7%)
# 3. Fisca Croissance (PME + 1 POS inclus): 890.00 MAD HT/mo, infra = 8.00 MAD/mo -> margin = 882.00 MAD (99.1%)
# 4. Option POS Tactile (+1 Caisse): 149.00 MAD HT/mo, infra = 2.00 MAD/mo -> margin = 147.00 MAD (98.7%)
# 5. Cabinet Fiduciaire (60 dossiers + 2 POS): 10,328.00 MAD HT/mo, infra = 304.00 MAD/mo (60*5 + 2*2) -> margin = 10,024.00 MAD (97.1%)
# 6. Contrat Enterprise Corporate (5 ICE, 58k/an): 4,833.33 MAD/mo -> let's use Annual Contract Value or Monthly MRR! Wait: to avoid decimals on 58000/12, let's model a realistic target Year-1 Customer Mix (e.g., 100 Solo, 80 Essentiel, 40 Croissance, 50 POS add-ons, 10 Fiduciaires of 60 dossiers, 4 Enterprise Corporate, 1 Fisca Souverain) in Annual Recurring Revenue (ARR HT in MAD)!
# Let's check Annual HT figures — every single one is an EXACT integer in MAD!
# Note: Monthly subscribers paying monthly x 12 vs Annual contracts:
# Let's check standard 12-month ARR at monthly catalog rates vs annual contracts:
# - Solo AE (100 clients @ 129 MAD/mo * 12 = 1,548 MAD/yr): 154,800 MAD HT/an | Infra (5 MAD/mo * 12 = 60 MAD/yr * 100 = 6,000 MAD)
# Wait: in Source 29, marginal infrastructure cost is 5.00 MAD / PME / mois (60 MAD / an)! Using the exact 5.00 MAD / dossier / mois (60 MAD / an) from Source 29 keeps 100% alignment with our source documents!

portfolio = [
    {"tier": "Fisca Solo (AE)", "units": 100, "monthly_ht": 129.0, "annual_unit_ht": 1548.0, "annual_infra_unit": 60.0},
    {"tier": "Fisca Essentiel (TPE)", "units": 80, "monthly_ht": 390.0, "annual_unit_ht": 4680.0, "annual_infra_unit": 60.0},
    {"tier": "Fisca Croissance (PME)", "units": 40, "monthly_ht": 890.0, "annual_unit_ht": 10680.0, "annual_infra_unit": 60.0},
    {"tier": "Terminaux POS Tactiles", "units": 60, "monthly_ht": 149.0, "annual_unit_ht": 1788.0, "annual_infra_unit": 24.0},
    {"tier": "Cabinets OEC (x60 dossiers)", "units": 10, "monthly_ht": 10130.0, "annual_unit_ht": 121560.0, "annual_infra_unit": 3600.0},
    {"tier": "Enterprise Corporate (Annuel)", "units": 4, "monthly_ht": 4833.33, "annual_unit_ht": 58000.0, "annual_infra_unit": 1800.0},
    {"tier": "Fisca Souverain (Annuel)", "units": 1, "monthly_ht": 11666.67, "annual_unit_ht": 140000.0, "annual_infra_unit": 12000.0},
]

for p in portfolio:
    p["arr_ht_mad"] = p["units"] * p["annual_unit_ht"]
    p["infra_arr_mad"] = p["units"] * p["annual_infra_unit"]
    p["gross_profit_arr_mad"] = p["arr_ht_mad"] - p["infra_arr_mad"]

tot_arr = sum(p["arr_ht_mad"] for p in portfolio)
tot_infra = sum(p["infra_arr_mad"] for p in portfolio)
tot_gp = tot_arr - tot_infra
tot_gm_pct = round((tot_gp / tot_arr) * 100, 1)

print(json.dumps({"items": portfolio, "totals": {"arr_ht_mad": tot_arr, "mrr_equiv_mad": round(tot_arr/12, 2), "infra_arr_mad": tot_infra, "gross_profit_arr_mad": tot_gp, "gross_margin_pct": tot_gm_pct}}, indent=2, ensure_ascii=False))
```

Résultat du code (réexécution : identique) :

<!-- verif:03-02:resultat -->
```text
{
  "items": [
    {
      "tier": "Fisca Solo (AE)",
      "units": 100,
      "monthly_ht": 129.0,
      "annual_unit_ht": 1548.0,
      "annual_infra_unit": 60.0,
      "arr_ht_mad": 154800.0,
      "infra_arr_mad": 6000.0,
      "gross_profit_arr_mad": 148800.0
    },
    {
      "tier": "Fisca Essentiel (TPE)",
      "units": 80,
      "monthly_ht": 390.0,
      "annual_unit_ht": 4680.0,
      "annual_infra_unit": 60.0,
      "arr_ht_mad": 374400.0,
      "infra_arr_mad": 4800.0,
      "gross_profit_arr_mad": 369600.0
    },
    {
      "tier": "Fisca Croissance (PME)",
      "units": 40,
      "monthly_ht": 890.0,
      "annual_unit_ht": 10680.0,
      "annual_infra_unit": 60.0,
      "arr_ht_mad": 427200.0,
      "infra_arr_mad": 2400.0,
      "gross_profit_arr_mad": 424800.0
    },
    {
      "tier": "Terminaux POS Tactiles",
      "units": 60,
      "monthly_ht": 149.0,
      "annual_unit_ht": 1788.0,
      "annual_infra_unit": 24.0,
      "arr_ht_mad": 107280.0,
      "infra_arr_mad": 1440.0,
      "gross_profit_arr_mad": 105840.0
    },
    {
      "tier": "Cabinets OEC (x60 dossiers)",
      "units": 10,
      "monthly_ht": 10130.0,
      "annual_unit_ht": 121560.0,
      "annual_infra_unit": 3600.0,
      "arr_ht_mad": 1215600.0,
      "infra_arr_mad": 36000.0,
      "gross_profit_arr_mad": 1179600.0
    },
    {
      "tier": "Enterprise Corporate (Annuel)",
      "units": 4,
      "monthly_ht": 4833.33,
      "annual_unit_ht": 58000.0,
      "annual_infra_unit": 1800.0,
      "arr_ht_mad": 232000.0,
      "infra_arr_mad": 7200.0,
      "gross_profit_arr_mad": 224800.0
    },
    {
      "tier": "Fisca Souverain (Annuel)",
      "units": 1,
      "monthly_ht": 11666.67,
      "annual_unit_ht": 140000.0,
      "annual_infra_unit": 12000.0,
      "arr_ht_mad": 140000.0,
      "infra_arr_mad": 12000.0,
      "gross_profit_arr_mad": 128000.0
    }
  ],
  "totals": {
    "arr_ht_mad": 2651280.0,
    "mrr_equiv_mad": 220940.0,
    "infra_arr_mad": 69840.0,
    "gross_profit_arr_mad": 2581440.0,
    "gross_margin_pct": 97.4
  }
}
```
