<!--
ID canonique : Doc_14_QA   |   Fichier : docs/specs/14-qa-harness.md
Source : « Document 14 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_14_QA#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_14_QA »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 14 — Stratégie de Test & Harnais QA Déterministe
Ce document spécifie l'architecture de vérification automatisée, le catalogue des vecteurs fiscaux marocains au centime près, les validateurs binaires XML/XSD de la DGI, les tests hors-ligne de Fisca POS et les scénarios E2E et Chaos de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_14_QA).
## Section 01 — Philosophie « Harness-First » & Pyramide à 5 Étages
Dans une usine logicielle pilotée par des boucles autonomes sur Hyperagent.com, le harnais de test remplace la relecture manuelle ligne par ligne par des capteurs mathématiques infalsifiables exécutés avant chaque commit Git.

| Étage du Harnais | Moteur d'Exécution | Nombre de Tests | Budget Temps | Déclenchement Bloquant |
|---|---|---|---|---|
| L1 — Porte Statique AST | TypeScript, ESLint, Grep | 45 règles | 0,8 s | Chaque ticket (pnpm verify:fast) |
| L2 — Unitaires & CGI | Vitest pur en mémoire | 260 tests | 2,6 s | Chaque ticket (pnpm verify:fast) |
| L3 — Intégration D1/OPFS | Miniflare, D1, DO, WebCrypto | 110 tests | 11,5 s | Avant chaque git push |
| L4 — Schémas XSD & PHIVE | xmllint, Java PHIVE, .NET | 65 suites | 16,0 s | Barrières QA G1 à G4 |
| L5 — E2E & Chaos PRA | Playwright + Simulateur PRA | 40 parcours | 44,1 s | Barrières QA & Release S5 |

- Boucle rapide inférieure à 5 secondes : Les étages L1 et L2 cumulent 305 vérifications en 3,4 secondes via la commande pnpm verify:fast, permettant aux agents constructeurs d'itérer à haute cadence sans dérive.
- Barrière complète en 75 secondes : La suite intégrale des 520 tests (pnpm verify:gate) s'exécute dans le bac à sable isolé de l'agent Fisca-QA-Security-Auditor avant toute fusion vers la branche principale.
- Interdiction absolue d'affaiblir un capteur : Aucun agent constructeur n'a la permission de modifier une valeur fiscale attendue, d'ajouter une exclusion de linter ou de désactiver un test pour forcer un passage au vert.
## Section 02 — Porte Statique Pré-Commit (L1 : Anti-Stub, Anti-Float & AST)
Avant même de lancer un test unitaire, le script scripts/harness-check.sh exécute en 0,8 seconde cinq analyseurs statiques qui rejettent les défauts récurrents des grands modèles de langage :
- Bannissement des implémentations partielles : Rejet immédiat si un fichier source contient un commentaire d'attente, une donnée factice codée en dur ou un test ignoré.
- Typage strict intégral : Compilation TypeScript Monorepo avec strict: true, noImplicitAny: true et noUncheckedIndexedAccess: true, interdisant toute directive contournant le compilateur.
- Règle AST Anti-Float Monétaire : Une règle ESLint dédiée inspecte l'arbre syntaxique et bloque l'opérateur de division standard ou parseFloat sur tout identifiant portant le suffixe _cents, Cents, _bps ou Bps, imposant l'usage des utilitaires entiers BigInt.
- Sécurité des outils IA & MCP : Vérifie statiquement que chaque outil déclaré sur le serveur MCP passe par FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema (zéro paramètre tenant_id exposé au LLM) et maintient canMutateLedgerDirectly à faux.
- Conformité CSS bidirectionnelle : Scanne les composants packages/ui-mercury, apps/web-saas, apps/pos-pwa et apps/marketing-astro pour interdire toute propriété physique gauche/droite au profit des classes logiques compatibles RTL/LTR.
## Section 03 — Catalogue des Vecteurs d'Or Fiscaux (L2 : CGI & LF 2026 au Centime)
Le fichier packages/qa-harness/src/fiscal-golden-suite.test.ts contient 120 vecteurs déterministes pré-calculés couvrant tous les cas particuliers du Code Général des Impôts et de la Loi de Finances 2026 :

| ID Vecteur | Règle Fiscale Testée | Entrée en Centimes / BPS | Sortie Exacte Attendue |
|---|---|---|---|
| VEC-CGI-01 | Espèces Art. 11-II (7 200 MAD TTC, TVA 20 %) | 720000 TTC (600000 HT) | 416667 HT déd., 183333 réintégré T3, 36667 TVA perdue |
| VEC-CGI-02 | Loi 69-21 (12 345 MAD TTC, 2 mois à 360 bps) | 1234500 TTC, 45j retard | Amende arrondie au MAD sup. : 44500 centimes (445 MAD) |
| VEC-CGI-03 | RAS-TVA Art. 117 (10 000 HT, TVA 2 000 MAD) | Attest. 4m vs 7m au paiement | Valide : RAS 150000 (75 %) ; Expirée : RAS 200000 (100 %) |
| VEC-CGI-04 | Seuil Auto-Entrepreneur 80 000 MAD / client | Cumul 7500000 + 1200000 | Surplus 700000 taxé RAS IR 30 % : 210000 centimes |
| VEC-CGI-05 | Réforme TVA 2026 vs Archive 2025 | Facture 2026 à 1400 bps | Rejet immédiat ADR_04_LF2026_VAT_VIOLATION en 2026 |
| VEC-CGI-06 | Décompte BTP (Retenue garantie 10 % + Débours) | 10000000 HT + 500000 déb. | Débours 0 TVA ; TVA sur retenue différée à libération |

- Couverture complémentaire des subtilités annuelles : Les vecteurs VEC-CGI-07 à VEC-CGI-120 vérifient la régularisation par cinquième du prorata de TVA (variation supérieure à 5 points, Art. 104 CGI), la forclusion de déduction à 12 mois après décaissement (Art. 204 bis CGI), le plafond d'amortissement de 400 000 MAD TTC des véhicules de tourisme, l'auto-liquidation TVA + RAS IS 10 % des prestations étrangères (Art. 15 & 115) et l'exclusion des comptes 713, 714 et 719 de la base de Cotisation Minimale (Art. 144).
## Section 04 — Harnais du Grand Livre CGNC Immuable & Cadrage TVA (L2 & L3)
Les tests d'intégration comptables exécutent les requêtes directement sur une instance locale Cloudflare D1 pour éprouver les contraintes et triggers SQLite définis au Document 06 :
- Preuve d'immuabilité matérielle (Art. 145-I CGI) : Tente un UPDATE d'un centime puis un DELETE sur une écriture au statut POSTED et exige l'interception exacte de l'erreur SQLite VIOLATION_PAF_CGI_ART_145, puis valide que seule une écriture inverse liée par reversal_of_entry_id rétablit le solde.
- Bouclier temps réel anti-caisse créditrice : Crée un solde débiteur de 200000 centimes sur le compte 5161 et soumet un décaissement espèces de 200001 centimes ; exige le rejet transactionnel CGNC_NEGATIVE_CASH_5161.
- Mécanique TVA sur encaissement & Effets LCN : Vérifie qu'une vente et un achat s'inscrivent initialement en 44558 et 34558, qu'un règlement par traite (42_EFFET_LCN) ne déclenche pas la TVA à la remise de l'effet mais uniquement à l'encaissement effectif à l'échéance, et qu'un encaissement partiel de 40 % sur une facture multi-taux (20 % et 10 %) ventile VAT_CLEARING au centime exact.
- Contrôle de pré-clôture d'exercice : Vérifie le refus de passer un exercice fiscal à CLOSED tant que les comptes d'attente 3497 / 4497 ne sont pas intégralement soldés à zéro ou qu'un écart subsiste au Cadrage de TVA entre chiffre d'affaires encaissé et bases déclarées.
## Section 05 — Validation Binaire des Flux XML/XSD DGI, PHIVE & FEC-MA (L4)
Aucun test par simple expression régulière n'est admis pour les livrables fiscaux ; la commande pnpm test:xsd invoque les validateurs officiels hors-ligne sur chaque générateur :
- Facturation Clearance UBL 2.1 & Factur-X Loi 43-20 : Passe les 5 types UBL (380, 381, 383, 386, 389) dans le moteur Java PHIVE (0 erreur XSD OASIS + 0 erreur Schematron EN 16931), contrôle la conformité PDF/A-3b et vérifie la signature XAdES-Baseline-T ainsi que le rejet d'un certificat X.509 dont l'OID diffère de l'ICE émetteur.
- Télédéclarations SIMPL-TVA v4.0, RAS-TVA & Loi 69-21 : Valide avec xmllint --noout --schema les fichiers extraits des archives .zip, en vérifiant spécifiquement que <prorata> précède <mp> et suit <tx>, et que les factures en litige avec preuve R2 sont isolées sans amende dans le modèle ADC500B-23I.
- Liasse SIMPL-IS v2.0.3, État des Ventes & DRVT v2.0.3 : Injecte une balance complète à 6 colonnes sur les Modèles Normal et Simplifié, vérifie Total Actif Net == Total Passif au centime près, l'omission des anciens codes obsolètes 11501 à 11504, la présence des totaux Tableaux 3/4/8, la concordance Ventes B2B + Ventes POS B2C == Classe 71 CPC et le bloc loyers TSC dans les 3 fichiers DRVT.
- État 9421 Annuel & Pack Contrôle Art. 211 CGI : Valide le fichier .xml non zippé de l'État 9421 (<numPPR/> placé entre <numCE/> et <numCNSS>, <listSalariesCFC/> dans la racine, paiements ES/CH/SIR), puis inspecte le fichier plat {IF}FEC{YYYYMMDD}.txt (exactement 24 colonnes séparées par |, fins de ligne CRLF, journal AN équilibré en première position et continuité des empreintes SHA-256).
## Section 06 — Harnais Fisca POS Offline-First & Conversion QR B2C vers B2B (L3 & L4)
Le module apps/pos-pwa subit une batterie dédiée simulant les conditions réelles d'un commerce ou café-restaurant marocain subissant une coupure réseau :
- Simulation de coupure 72 heures multi-tablettes : Trois instances SQLite WASM (POS-M01-C01, C02, C03) encaissent chacune 200 tickets hors-ligne (mix TVA 20 %, 10 %, 0 % + droit de timbre espèces 0,25 %) puis synchronisent simultanément sur /api/v1/pos/sync-batch ; le test exige zéro collision de séquence et une chaîne SHA-256 valide à 100 %.
- Détection de falsification locale OPFS : Altère directement un montant dans la base SQLite locale d'une caisse avant synchronisation et vérifie que le serveur rejette le lot suite à l'échec de la signature matérielle ECDSA P-256 (extractable: false).
- Preuve mathématique anti-double imposition sur conversion QR B2C vers B2B :
- Cas avant clôture Z : Un ticket de 1 200,00 MAD TTC est converti par scan QR avec ICE avant la fermeture de caisse ; il génère une facture B2B xHub et est exclu de l'assiette B2C du Ticket Z.
- Cas après clôture Z (J+5) : Le Ticket Z a déjà comptabilisé les 1 200,00 MAD TTC en revenus B2C ; le scan QR génère dans la même transaction atomique D1 la facture B2B xHub et une écriture négative de neutralisation B2C du jour, garantissant que le chiffre d'affaires cumulé sur SIMPL-TVA et le CPC demeure exactement égal à 1 200,00 MAD TTC, et qu'un second scan du même QR est rejeté par UNIQUE(pos_ticket_id).
- Ventilation TPE & Plateformes de livraison : Teste l'import d'un virement net CMI / Payzone / Glovo et vérifie l'éclatement exact entre vente brute client, commission HT (61473) et TVA récupérable à 10 % sur commission bancaire (34552).
## Section 07 — Harnais des 11 Agents IA, Mémoire Hindsight & Bouclier SAFE (L3)
Les agents neuro-symboliques sont testés contre un jeu de pièces adverses figées afin de prouver un déterminisme comportemental total :
- Vérification des 4 règles d'arrêt AI Crafters :
- Scan taché / total TTC masqué : L'agent place la pièce en PIECE_A_CONTROLER avec montant nul sans jamais calculer le TTC manquant par déduction hasardeuse.
- Doublon de montant bancaire : Deux factures fournisseurs non payées de 4 500,00 MAD face à un virement sans libellé atterrissent obligatoirement en SUSPENS_AMBIGU_3497_4497 sans lettrage automatique.
- Variation N/N-1 de +42 % sur le poste Transport : En l'absence de pièce justificative explicative dans le dossier, la fiche de clôture signale la variation chiffrée exacte mais n'invente aucune explication causale.
- Relance Loi 69-21 avec email récent : Un message entrant du client reçu la veille mentionnant un litige qualité bloque l'émission du brouillon de relance automatique.
- Boucle d'apprentissage Hindsight : Simule la correction par un collaborateur comptable d'une proposition 6125 vers 6142 sur un fournisseur précis et vérifie que reflectOnHumanCorrection met à jour evolving_opinions dans le Durable Object pour proposer 6142 dès la facture suivante de ce même ICE.
- Tests offensifs Prompt Injection & Zéro-Fuite PII : Réexécute les vecteurs Canary du Document 10 (facture PDF contenant des ordres cachés de modification de RIB et d'exfiltration) et vérifie que 0 octet de donnée personnelle marocaine (ICE, RIB, CIN, téléphone) ne franchit EphemeralRamPiiScrubber.
## Section 08 — Tests des Connecteurs ERP (Sage 100 C# .NET 8, Odoo & Camel)
- Harnais C# xUnit pour Sage100EdgeAgent (.NET 8) : Vérifie d'abord par analyseur statique que toutes les requêtes SQL Server portent WITH (NOLOCK) et qu'aucune instruction INSERT, UPDATE ou DELETE n'existe (ADR_11_SAGE100_CORRUPTION_GUARD). Valide ensuite le générateur de repli universel .PNM : chaque ligne générée doit mesurer exactement 108 caractères avant CRLF, sans caractère accentué cassant l'alignement des colonnes 85 à 104, et équilibrer Débit et Crédit par pièce.
- Harnais Python pytest pour l10n_ma_edi_clearance (Odoo v17–v20) : Vérifie la signature sortante X-SaaS-Signature (HMAC-SHA256 canonique), le non-rejeu par Idempotency-Key, le stockage de l'UUID xHub sur account.move et l'envoi automatique de l'événement de lettrage partiel account.partial.reconcile déclenchant VAT_CLEARING.
## Section 09 — Parcours E2E Playwright : Thème Mercury, Mobile & 6 vs 3 Langues (L5)
Cinq parcours complets tournent sous Playwright (navigateur Chromium sans tête interne au sandbox Hyperagent) sur trois résolutions (375x812 Mobile, 1024x768 Tablette POS, 1440x900 Bureau) en modes Clair et Sombre :
- Parcours E2E-01 (Onboarding & Auth 2FA) : Inscription Email/Mot de passe et liaison Google OAuth, activation du 2FA TOTP (vérifiant qu'un jeton intermédiaire mfa_challenge_token refuse tout appel métier avant saisie des 6 chiffres), saisie d'un ICE à 15 chiffres avec pré-remplissage en moins de 90 secondes et émission d'une facture bilingue Factur-X.
- Parcours E2E-02 (Fisca POS Comptoir -> Client B2B) : Ouverture de session caisse, encaissement hors-ligne, comptage aveugle caissier (vérifiant que le solde attendu est masqué), clôture Ticket Z, puis scan du QR Code par un client saisissant son ICE pour télécharger sa facture certifiée.
- Parcours E2E-03 (Cabinet Fiduciaire Marque Blanche) : Bascule entre dossiers en moins de 150 ms via Cmd+K, passage des grilles de 44px à 28px haute densité, injection SSE de 100 achats en vérifiant un Cumulative Layout Shift égal à 0, visa des 5 cycles comptables à 3 niveaux et génération d'une facture d'abonnement incluant le prorata d'un nouveau dossier ajouté le 16 du mois.
- Parcours E2E-04 (Grand Compte Corporate) : Rapprochement 3-Way Matching d'une facture récapitulative liée à 3 Bons de Livraison (N-to-1), tentative de modification d'un RIB fournisseur bloquée par la règle SoD-02 jusqu'à validation par un second utilisateur DAF, export pain.001 et mobilisation 48h FactorFlow.
- Parcours E2E-05 (Audit Strict des Langues & RTL) : Parcourt les 6 langues (fr, ar, ary, zgh-Latn, zgh-Tfng, en) sur fisca.ma, l'espace PME et Fisca POS, vérifie dir="rtl" sur ar et ary, vérifie que les montants négatifs et ICE restent alignés en dir="ltr" tabular-nums, puis confirme que /app/fiduciary et /app/enterprise ne proposent et n'acceptent que les 3 langues institutionnelles (fr, ar, en).
## Section 10 — Tests de Charge, Concurrence Durable Object & Chaos PRA (L5)
La validation finale avant publication du tag v1.0.0 soumet la plateforme à trois épreuves de stress extrême :
- Tir de concurrence atomique 50x sur InvoiceSequencerDO : Lance simultanément Promise.all de 50 certifications de factures pour la même société à la même milliseconde (dont 5 factures contenant une erreur métier xHub simulée) ; vérifie que les 45 factures valides reçoivent exactement une séquence continue sans aucun trou ni doublon et une chaîne PIH SHA-256 intacte.
- Stress d'ingestion documentaire par lot (500 pièces simultanées) : Dépose un lot fiduciaire de 500 factures mixtes (Factur-X natifs et scans) dans INVOICE_QUEUE et vérifie l'absence de dépassement mémoire Worker (plafond 128 Mo respecté grâce au streaming R2) et le routage exact des pièces illisibles vers la file de contrôle.
- Épreuve Chaos PRA (Failover -> Failback RPO=0 -> Réversibilité 2036) : Simule la perte totale du primaire Cloudflare, bascule sur le pilote SOVEREIGN_MOROCCO_VPS, enregistre des ventes, écritures POSTED et Tickets Z, exécute le pont HTTP de retour, vérifie readyForDnsCutover === true, puis exporte le paquet ZIP ISO 14641 et valide 100 % des preuves hors-ligne avec verify-archive-offline.mjs en coupant toute interface réseau.
## Section 11 — Code de Référence : Moteur d'Assertions Fiscales Entières & Validateur .PNM
Ce module TypeScript pur sans aucun nombre flottant ni type any (packages/qa-harness/src/fiscal-golden-suite.ts) sert de juge mathématique de référence dans Vitest pour le plafond d'espèces Art. 11-II, les amendes Loi 69-21, la RAS-TVA Art. 117 et le format .PNM Sage 100 :

```ts
/**
 * Division entière half-up sur BigInt garantissant zéro imprécision flottante IEEE-754 (ADR-03)
 */
export function divRoundHalfUpBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("QA_MATH_INVALID_DENOMINATOR");
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * 1. Référence Mathématique Art. 11-II CGI : Plafond Espèces (5 000 MAD TTC/jour & 50 000 MAD TTC/mois)
 */
export interface CashCeilingSplitInput {
  readonly invoiceHtCents: number;
  readonly invoiceVatCents: number;
  readonly vatRateBps: 2000 | 1000 | 0;
  readonly alreadyPaidCashTodayTtcCents: number;
  readonly alreadyPaidCashMonthTtcCents: number;
}

export interface CashCeilingSplitOutput {
  readonly deductibleHtCents: number;
  readonly recoverableVatCents: number;
  readonly reintegratedTable3HtCents: number;
  readonly nonRecoverableVatCents: number;
}

export function computeExpectedArt11CashSplit(input: CashCeilingSplitInput): CashCeilingSplitOutput {
  const DAILY_CAP_TTC_CENTS = 500000;   // 5 000,00 MAD TTC
  const MONTHLY_CAP_TTC_CENTS = 5000000; // 50 000,00 MAD TTC
  const totalTtcCents = input.invoiceHtCents + input.invoiceVatCents;

  const remDaily = Math.max(0, DAILY_CAP_TTC_CENTS - input.alreadyPaidCashTodayTtcCents);
  const remMonthly = Math.max(0, MONTHLY_CAP_TTC_CENTS - input.alreadyPaidCashMonthTtcCents);
  const allowedTtcCents = Math.min(totalTtcCents, remDaily, remMonthly);

  if (allowedTtcCents === totalTtcCents) {
    return {
      deductibleHtCents: input.invoiceHtCents,
      recoverableVatCents: input.invoiceVatCents,
      reintegratedTable3HtCents: 0,
      nonRecoverableVatCents: 0,
    };
  }

  const allowedTtcBig = BigInt(allowedTtcCents);
  const rateDivisorBig = BigInt(10000 + input.vatRateBps);
  const deductibleHtCents = Number(divRoundHalfUpBigInt(allowedTtcBig * 10000n, rateDivisorBig));
  const recoverableVatCents = allowedTtcCents - deductibleHtCents;

  return {
    deductibleHtCents,
    recoverableVatCents,
    reintegratedTable3HtCents: input.invoiceHtCents - deductibleHtCents,
    nonRecoverableVatCents: input.invoiceVatCents - recoverableVatCents,
  };
}

/**
 * 2. Référence Mathématique Loi 69-21 : Amende BAM + 0,85% par mois entamé arrondie au MAD supérieur
 */
export function computeExpectedLaw6921PenaltyCents(params: {
  readonly unpaidTtcCents: number;
  readonly startedMonthsOfDelay: number;
  readonly bamBaseRateBps: number;       // Ex: 275 bps (2,75 %) pour le 1er mois
  readonly monthlyIncrementBps?: number; // Défaut légal : 85 bps (0,85 %) par mois supplémentaire
  readonly hasDocumentedDisputeR2: boolean;
}): number {
  if (params.hasDocumentedDisputeR2 || params.startedMonthsOfDelay <= 0 || params.unpaidTtcCents <= 0) {
    return 0;
  }
  const incBps = params.monthlyIncrementBps ?? 85;
  const totalPenaltyBps = params.bamBaseRateBps + (params.startedMonthsOfDelay - 1) * incBps;

  // Arrondi entier au dirham supérieur sans aucun nombre flottant :
  // 1 MAD = 100 centimes et 100% = 10 000 bps -> diviseur = 1 000 000
  const productBig = BigInt(params.unpaidTtcCents) * BigInt(totalPenaltyBps);
  const ceilWholeDirhamsBig = (productBig + 999999n) / 1000000n;
  return Number(ceilWholeDirhamsBig * 100n);
}

/**
 * 3. Référence Mathématique Art. 117 CGI : RAS-TVA 75 % vs 100 % selon validité 6 mois de l'attestation
 */
export function computeExpectedRasTvaCents(params: {
  readonly invoiceTtcCents: number;
  readonly invoiceVatCents: number;
  readonly paymentDateIso: string;            // YYYY-MM-DD
  readonly taxClearanceIssuedDateIso?: string; // YYYY-MM-DD
}): { readonly rasRateBps: 0 | 7500 | 10000; readonly rasVatCents: number } {
  if (params.invoiceTtcCents < 500000 || params.invoiceVatCents === 0) {
    return { rasRateBps: 0, rasVatCents: 0 }; // Exonéré sous le seuil de 5 000 MAD TTC
  }

  let isAttestationValidUnder6Months = false;
  if (params.taxClearanceIssuedDateIso) {
    const issued = new Date(`${params.taxClearanceIssuedDateIso}T00:00:00Z`);
    const limit = new Date(issued.getTime());
    limit.setUTCMonth(limit.getUTCMonth() + 6);
    const paid = new Date(`${params.paymentDateIso}T00:00:00Z`);
    isAttestationValidUnder6Months = paid >= issued && paid <= limit;
  }

  const rasRateBps: 7500 | 10000 = isAttestationValidUnder6Months ? 7500 : 10000;
  const rasVatCents = Number(
    divRoundHalfUpBigInt(BigInt(params.invoiceVatCents) * BigInt(rasRateBps), 10000n)
  );
  return { rasRateBps, rasVatCents };
}

/**
 * 4. Validateur Binaire de Ligne Sage 100 (.PNM — Largeur fixe stricte 108 caractères ASCII + CRLF)
 */
export function assertValidSage100PnmBuffer(pnmContent: string): { readonly linesCount: number } {
  if (!pnmContent.endsWith("\r\n")) {
    throw new Error("PNM_MISSING_TRAILING_CRLF");
  }
  const rawLines = pnmContent.slice(0, -2).split("\r\n");
  if (rawLines.length === 0) {
    throw new Error("PNM_EMPTY_FILE");
  }

  rawLines.forEach((line, idx) => {
    if (line.length !== 108) {
      throw new Error(`PNM_INVALID_LINE_LENGTH: Ligne ${idx + 1} mesure ${line.length} car. (attendu: 108).`);
    }
    if (!/^[\x20-\x7E]{108}$/.test(line)) {
      throw new Error(`PNM_NON_ASCII_CHAR: Caractère hors plage ASCII imprimable à la ligne ${idx + 1}.`);
    }
    const senseChar = line.charAt(83); // Position 84 (index 0-based 83) = 'D' ou 'C'
    if (senseChar !== "D" && senseChar !== "C") {
      throw new Error(`PNM_INVALID_DEBIT_CREDIT_FLAG: Reçu '${senseChar}' à la ligne ${idx + 1}.`);
    }
  });

  return { linesCount: rawLines.length };
}
```

## Section 12 — Couplage au Protocole Maker-Checker & Disjoncteur Hyperagent
Ce harnais pilote mécaniquement la progression des tickets dans @fisca_master_backlog lors des Vagues 0 à 5 :
- Règle d'avancement d'un ticket constructeur : Un agent constructeur ne peut passer un ticket de IN_PROGRESS à IN_REVIEW que si la sortie console de pnpm verify:fast affiche 0 erreur de typage, 0 alerte ESLint et 100 % des tests unitaires/fiscaux verts en moins de 5 secondes.
- Disjoncteur strict à 3 échecs (Circuit Breaker) : Si un même ticket échoue 3 fois de suite sur pnpm verify:fast ou xmllint, l'agent exécute obligatoirement git checkout -- . && git clean -fd, inscrit la trace console complète dans la section 04_Circuit_Breaker_Blockers de @FISCA_STATE_AND_HANDOFF, passe le ticket à BLOCKED et passe au ticket indépendant suivant.
- Validation finale par l'Auditeur Indépendant : Aux barrières G1, G2, G3, G4 et lors de la session finale S5, Fisca-QA-Security-Auditor exécute pnpm verify:gate (les 520 tests) dans un sandbox vierge et soumet le résultat aux Rubrics R1, R2 et R3 (modèle juge croisé, score exigé supérieur ou égal à 95 sur 100) avant d'autoriser la fusion sur main.
