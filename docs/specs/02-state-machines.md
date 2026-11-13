<!--
ID canonique : Doc_02_State_Machines   |   Fichier : docs/specs/02-state-machines.md
Source : « Document 02 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_02_State_Machines#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_02_State_Machines »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 02 — Diagrammes de Flux & Machines à États (State Machines)
Ce document définit les 9 machines à états finis (FSM) et les protocoles de transition transactionnels de Fisca (fisca.ma, édité par SYNAPTIC SYSTEMS SARL AU). Chaque section nommée est prête à être importée dans Hyperagent avec la portée Project (@Doc_02_State_Machines) afin d'interdire toute transition d'état illégale dans le code.
## Section 01 — Principes d'Ingénierie des Machines à États
Toute mutation d'un objet métier critique dans Fisca est gouvernée par un automate déterministe vérifié côté serveur avant écriture dans Cloudflare D1 :
- Transition atomique par verrou optimiste : Toute mise à jour SQL inclut la clause WHERE id = ?1 AND current_state = ?2, rejetant immédiatement toute double soumission concurrente.
- Piste d'audit immuable des transitions : Chaque changement d'état insère dans la même transaction SQLite une ligne horodatée dans state_transition_audit (acteur, état source, état cible, preuve JSON et empreinte).
- Idempotence bout-en-bout : Toutes les routes de mutation et webhooks entrants exigent un en-tête Idempotency-Key conservé 72 heures pour empêcher tout doublon d'écriture ou de certificat.
- Frontière neuro-symbolique stricte : Les agents IA ne peuvent déclencher que des transitions préparatoires (IA_PROPOSITION, PIECE_A_CONTROLER, SUSPENS_AMBIGU) et jamais un état fiscal définitif.
## Section 02 — FSM 01 : Facture Émise, Clearance xHub DGI & Cycle CDV (8 Statuts)
Cette machine sépare la tentative technique de transmission de la séquence fiscale ininterrompue exigée par l'Article 145 du CGI :

```text
[BROUILLON] ──(Validation Gérant)──► [NUMEROTEE_VERROUILLEE (DO + Hash PIH)]
     │                                               │
 (Abandon)                               (Validation PHIVE + Signature)
     ▼                                               ▼
[ANNULEE_BROUILLON]                        [SIGNEE_LOI_43_20]
                                                     │
                                         ┌───────────┴───────────┐
                                   (UUID xHub OK)          (Erreur xHub)
                                         ▼                       ▼
                             [DEPOSEE_CERTIFIEE_DGI]     [REJETEE_XHUB]
                                         │               (Correction liée)
          ┌──────────────────────┬───────┴───────────┬───────────┐
          ▼                      ▼                   ▼           ▼
[MISE_A_DISPOSITION] ──► [PRISE_EN_CHARGE] ──► [APPROUVEE]  [EN_LITIGE_SUSPENDUE]
                                                     │
                                         (Lettrage / Webhook Payzone)
                                                     ▼
                                                [ENCAISSEE]
```

| État Source | État Cible | Garde Déterministe Obligatoire | Effet de Bord Atomique |
|---|---|---|---|
| BROUILLON | NUMEROTEE_VERROUILLEE | Taux 2026 (20, 10, 0 %), ICE Modulo 97 valide | Attribution numéro DO sans trou et chaînage PIH SHA-256 |
| NUMEROTEE_VERROUILLEE | SIGNEE_LOI_43_20 | Zéro erreur Schematron PHIVE et OID X.509 conforme | Signature WebCrypto CSC v2 + jeton RFC 3161 + PDF Factur-X |
| SIGNEE_LOI_43_20 | DEPOSEE_CERTIFIEE_DGI | Réception xhub_uuid valide via DgiClearanceWorkflow | Écriture POSTED journal VTE (TVA en 44558) + archive R2 |
| SIGNEE_LOI_43_20 | REJETEE_XHUB | Code rejet métier retourné par l'API nationale xHub | Conserve le numéro et le hash dans la chaîne ; ouvre brouillon correctif |
| DEPOSEE_CERTIFIEE_DGI | APPROUVEE | Message UBL ApplicationResponse positif de l'acheteur | Déverrouille l'éligibilité à l'escompte 48h FactorFlow |
| APPROUVEE | ENCAISSEE | Règlement intégral lettré en banque ou webhook Payzone | Génère VAT_CLEARING (44558 → 44551) et clôt Loi 69-21 |

- Gestion des pannes DGI : Tant que xHub renvoie une erreur réseau 5xx ou un timeout, la facture demeure en EN_ATTENTE_XHUB gérée par Cloudflare Workflows avec réessai exponentiel sans jamais consommer un nouveau numéro.
- Sous-états commerciaux CDV : Entre DEPOSEE_CERTIFIEE_DGI et ENCAISSEE, la facture traverse MISE_A_DISPOSITION, PRISE_EN_CHARGE, APPROUVEE_PARTIELLEMENT (qui prépare un brouillon d'avoir 381), EN_LITIGE_SUSPENDUE ou REFUSEE.
## Section 03 — FSM 02 : Ingestion IA d'Achats, 3-Way Matching & Anti-Fraude RIB
Chaque pièce entrante traverse un entonnoir de filtres déterministes avant de pouvoir entrer en comptabilité ou en chaîne de paiement :

```text
[RECU_BRUT_R2] ──► [EXTRACTION_EN_COURS] ──(Montant illisible)──► [PIECE_A_CONTROLER]
                             │
                    (JSON Zod complet)
                             ▼
                [CONTROLE_DETERMINISTE_CGI]
                             │
            ┌────────────────┴────────────────┐
      (PME Directe)                   (Grand Compte / ETI)
            │                                 ▼
            │                     [RAPPROCHEMENT_3WAY_N_BL] ──(Écart)──► [ECART_3WAY_BLOQUE]
            │                                 │
            └────────────────┬────────────────┘
                             ▼
                 [CONTROLE_ANTI_FRAUDE_RIB] ──(RIB modifié)──► [ALERTE_RIB_DOUBLE_VISA_DAF]
                             │
                      (RIB identique)
                             ▼
                 [BON_A_PAYER_APPROUVE] ──► [VIREMENT_ISO20022_PAIN001]
```

- Verrou forensique d'entrée (RECU_BRUT_R2) : Inspection immédiate de la table binaire xref des attestations et factures PDF ; tout document altéré par logiciel de retouche ou doublon SHA-256 est bloqué.
- Garde-fou d'extraction AI Crafters (PIECE_A_CONTROLER) : Si un total HT, TVA ou TTC est absent ou si l'équation en centimes HT + TVA - RAS + Timbre == TTC échoue, l'agent s'arrête sans jamais compléter le montant manquant.
- Ventilation automatique espèces (CONTROLE_DETERMINISTE_CGI) : Tout achat réglé en espèces dépassant 5 000 MAD TTC/jour ou 50 000 MAD TTC/mois par fournisseur active le drapeau de scission comptable Art. 11-II CGI.
- Rapprochement N-to-1 et Contrats BPU (ECART_3WAY_BLOQUE) : Compare la facture à N Bons de Livraison signés (lus par Nanonets-OCR-s) et aux tarifs du contrat compilé dans le LLM Wiki ; tout dépassement envoie une carte d'alerte Teams/WhatsApp.
- Bouclier Changement de RIB (ALERTE_RIB_DOUBLE_VISA_DAF) : Si le RIB 24 chiffres extrait diffère de rib_24_verified, la facture est exclue des lots de virement pain.001 jusqu'à double approbation distincte selon la matrice SoD.
## Section 04 — FSM 03 : Grand Livre CGNC Immuable, Visa Cabinet & Clôture d'Exercice
Le moteur comptable applique à la fois le workflow hiérarchique à 3 niveaux des cabinets marocains (OEC) et l'inaltérabilité de l'Article 145-I du CGI :

| Objet Comptable | Transition Autorisée | Acteur Habilité | Contrôle Bloquant d'Intégrité |
|---|---|---|---|
| Écriture Journal | IA_PROPOSITION → DRAFT | Aide-Comptable | Pièce R2 liée et équilibre centimes Débit égal Crédit |
| Écriture Journal | DRAFT → REVISEE_CYCLE | Chef de Mission | Contrôle du cycle (Trésorerie, Achats, Ventes, Paie, Fiscal) |
| Écriture Journal | REVISEE_CYCLE → POSTED | Expert-Comptable / Gérant | Caisse 5161 positive ou nulle + scellement entry_hash |
| Écriture Journal | POSTED → CONTRE_PASSEE | Expert-Comptable / Gérant | Triggers SQLite interdisant UPDATE/DELETE ; écriture inverse liée |
| Exercice Fiscal | OPEN → CLOSING | Chef de Mission | Génération brouillons Cut-Off (4417, 3491, Classe 2, change BAM) |
| Exercice Fiscal | CLOSING → CLOSED | Expert-Comptable Signataire | Suspens 3497/4497 soldés à zéro + 50 contrôles FEC verts |

- Apprentissage Hindsight sur transition IA_PROPOSITION → DRAFT : Si le collaborateur modifie le compte PCGE proposé par l'agent avant de passer en DRAFT, le hook déclenche reflectOnHumanCorrection pour ajuster evolving_opinions sur ce fournisseur.
- Automatisme post-clôture (CLOSED → OPEN N+1) : Le scellement de closing_hash génère immédiatement le journal d'ouverture AN équilibré en tête du nouvel exercice ainsi que l'extourne automatique des écarts de conversion 3701/4701 au 1er janvier.
## Section 05 — FSM 04 : Rapprochement Bancaire, TVA sur Encaissement & Forclusion
Au Maroc, le lettrage bancaire pilote directement le fait générateur de la déclaration SIMPL-TVA :

```text
[LIGNE_RELEVE_IMPORTEE]
          │
          ├──(0 ou >=2 factures candidates)──► [SUSPENS_3497_4497] ──(Relance WhatsApp 10 du mois)──┐
          │                                                                                         │
          ▼ (1 correspondance exacte ou lot validé)                                                 │
   [LETTREE_RAPPROCHEE] ◄───────────────────────────(Pièce déposée & confirmée par comptable)───────┘
          │
          ▼ (Déclencheur automatique TVA Encaissement — ou Échéance atteinte si Effet LCN 42)
[TVA_EN_ATTENTE (44558 / 34558)] ──► [VAT_CLEARING_POSTED (44551 / 34551 / 34552 + RAS-TVA)]
                                                    │
                         ┌──────────────────────────┴──────────────────────────┐
                (Délai <= 12 mois)                                    (Délai > 12 mois Art. 204 bis)
                         ▼                                                     ▼
           [DECLAREE_ZIP_SIMPL_TVA_V4]                              [FORCLOSE_EXCLUE_ANTI_AMENDE]
```

- Blocage des rapprochements ambigus : Conformément aux exigences AI Crafters, si deux factures du même montant coexistent sans référence de virement distinctive, le lettrage automatique est interdit et la ligne rejoint le dossier des suspens.
- Règle spéciale des Effets de Commerce (42_EFFET_LCN) : La remise d'une traite fait passer la créance en EFFET_EN_PORTEFEUILLE, mais la transition VAT_CLEARING_POSTED côté déduction/encaissement attend la date d'échéance ou d'encaissement bancaire effectif.
- Horloge de forclusion (Art. 204 bis CGI) : Un Cron hebdomadaire passe toute ligne VAT_CLEARING_POSTED non encore déclarée en ALERTE_FORCLUSION à 10 mois après payment_date, puis en FORCLOSE_EXCLUE_ANTI_AMENDE au-delà de 12 mois.
## Section 06 — FSM 05 : Délais de Paiement Loi 69-21, Litiges & Recouvrement
Chaque facture B2B dont le montant ou l'entreprise entre dans le périmètre de la Loi 69-21 (CA supérieur à 2 millions MAD HT) suit un automate quotidien calculé depuis service_delivery_date :
- DANS_DELAI_LEGAL : Compteur inférieur ou égal à 60 jours (ou 120 jours si contrat signé rattaché à la fiche tiers, ou 180 jours si décret sectoriel actif).
- PRE_RELANCE_VERIFIEE (J-10 et J-3) : L'agent de suivi vérifie simultanément l'absence de règlement non lettré et l'absence d'email/message récent du client mentionnant un paiement en cours ou une réclamation avant de soumettre le brouillon de relance à validation humaine.
- CONTESTEE_DOCUMENTEE (Gel légal) : Dès qu'une contestation formelle ou une date de recours judiciaire est téléversée dans R2, le calcul de pénalité est gelé et le montant bascule dans la balise de litige de l'état trimestriel ADC500B-23I.
- EN_RETARD_PENALISE : À J+1 au-delà de l'échéance légale sans litige, l'amende s'incrémente à chaque mois entamé (taux directeur BAM le premier mois puis +0,85 % par mois ou fraction de mois, arrondi au dirham supérieur via Math.ceil).
- APUREE_HORS_DELAI → DECLAREE_EDI_TRIMESTRIEL : Le paiement tardif fige nombreMoisRetard et amendePecuniaire pour l'export XML trimestriel et inscrit la pénalité en réintégration fiscale non déductible au Tableau 3 de SIMPL-IS.
## Section 07 — FSM 06 : FactorFlow Maroc (Escompte Dynamique 48h & Multi-Factors)
Pour garantir le risque zéro de double mobilisation et respecter strictement la Loi bancaire 103-12 de Bank Al-Maghrib :

| Étape FactorFlow | Transition d'État | Garde Atomique & Règle Métier |
|---|---|---|
| 1. Qualification | APPROUVEE → ELIGIBLE_FACTORFLOW | Certifiée xHub, 3-Way Matched, zéro litige et hors retenue BTP |
| 2. Verrouillage | ELIGIBLE → PLEDGED_LOCKED | Insertion UNIQUE(xhub_uuid, sha256_hash) dans le registre D1 |
| 3a. Négociation | PLEDGED_LOCKED → ESCOMPTE_ACCEPTE | Accord acheteur/vendeur sur le taux journalier prorata temporis |
| 3b. Affacturage | PLEDGED_LOCKED → SUBROGEE_FACTOR | Quittance subrogative Loi 43-20 ; bascule auto vers Factor 2 si refus Factor 1 |
| 4. Dénouement | ACCEPTE / SUBROGEE → SETTLED_48H | Émission automatique de l'avoir UBL 381 (6386/7386) et virement direct |

## Section 08 — FSM 07 : Abonnements, Compteur Fiduciaire par Dossier & Dunning Payzone
La machine de facturation protège vos revenus récurrents tout en garantissant qu'un incident de carte bancaire ne mette jamais un client marocain en défaut face à un contrôle de la DGI :
- Cycle Organisation (organizations.subscription_state) : TRIAL_SANDBOX_14D → ACTIVE_PAID → PAST_DUE_GRACE_14D (relances automatiques Infobip WhatsApp/Email à J+1, J+5 et J+10 via Payzone ; réception xHub maintenue) → RESTRICTED_READ_ONLY (création de nouvelles factures bloquée à J+15, mais consultation du coffre 10 ans et export de réversibilité toujours actifs) → CANCELED_WORM_PRESERVED.
- Cycle Unitaire Dossier Fiduciaire (company_billing_meters) :
- CREE_EN_COURS_DE_MOIS : Dès le provisionnement de la base D1 du client, calcul immédiat en centimes entiers du prorata temporis journalier sur les jours restants du mois selon son profil (6900, 14900 ou 24900 centimes HT).
- ACTIF_MENSUEL : Facturé chaque 1er du mois avec le socle cabinet (49000 centimes HT) ; si le total des dossiers ACTIF_MENSUEL du cabinet est supérieur ou égal à 100, le modificateur tarifaire applique automatiquement -15 % (8500 bps).
- CLOTURE_OU_TRANSFERE : Désactive la facturation récurrente à la fin de la période en cours tout en maintenant l'archive légale scellée.
## Section 09 — FSM 08 : Clés E2EE, Cycle SAE 10 Ans & Continuité Cloud (Failover/Failback)
- Cycle des Autorisations Cryptographiques (tenant_key_grants) : ACTIVE_GRANT (clé Tenant_DEK enveloppée en RSA-OAEP-256 pour le gérant, le cabinet OEC, l'agent ERP et le séquestre de Shamir 2-sur-3) → EPHEMERAL_UNWRAPPED_IN_RAM (déchiffrement HPKE en mémoire vive Worker inférieur à 15 ms sans trace disque) → REVOKED (horodatage revoked_at supprimant instantanément l'accès d'un cabinet comptable remplacé sans toucher aux archives R2).
- Cycle de Vie Probant Décennal (archival_packages) : SEALED_AIP_R2 → MERKLE_TIMESTAMPED_LTA_V1 (ancré dans le lot quotidien Barid eSign RFC 3161) → LTA_RENEWED_SHA512 (renouvelé tous les 24 mois avant expiration du certificat TSA) → RETENTION_EXPIRED (uniquement après clôture + 10 ans + 1 jour, protégé jusque-là par trigger SQLite anti-suppression).
- Automate de Bascule Infrastructure (StorageAdapter) : PRIMARY_CLOUDFLARE → (3 échecs consécutifs de santé à 20s d'intervalle) → FAILOVER_STANDBY_VPS (bascule Multi-DNS automatique vers le serveur miroir en moins de 60s) → (retour nominal Cloudflare stable pendant 10 min) → DRAIN_AND_SYNC_DELTA (fenêtre de maintenance lecture seule de 5s poussant le delta signé via le pont HTTP vers D1/R2 et contrôlant l'égalité des racines SHA-256) → PRIMARY_CLOUDFLARE.
## Section 10 — FSM 09 : Auto-Évolution des Règles Fiscales depuis le LLM Wiki
Chaque mise à jour légale (Loi de Finances, Note Circulaire DGI, Avis CNC) suit un pipeline de validation déterministe avant d'affecter la production :
RAW_PDF_UPLOADED → WIKI_DIFF_EXTRACTED → CANDIDATE_AST_COMPILED (validé par DynamicFiscalRuleSchema avec 3 tests unitaires auto-générés) → VITEST_SANDBOX_PASSED (rejeté vers COMPILATION_FAILED au moindre écart d'un centime) → SHADOW_OBSERVE_MODE (exécuté en silence sur un échantillon d'écritures sans impacter le Grand Livre) → ACTIVE_RULE_IN_D1 (après clic d'approbation de l'administrateur SYNAPTIC SYSTEMS) → SUPERSEDED_ARCHIVED (lorsqu'une loi d'une année suivante la remplace, tout en restant active pour la lecture des exercices antérieurs).
## Section 11 — Moteur TypeScript Générique de Transitions (packages/shared-types/src/fsm.ts)
Ce module de référence sans aucun type any doit être utilisé par tous les Workers Hono pour exécuter et auditer les transitions en une transaction atomique D1 :

```ts
import { z } from "zod";

export const ActorKindSchema = z.enum([
  "HUMAN_USER",
  "DETERMINISTIC_SYSTEM",
  "AI_AGENT_PROPOSAL",
  "EXTERNAL_WEBHOOK"
]);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export interface TransitionRule<TState extends string> {
  readonly from: readonly TState[];
  readonly to: TState;
  readonly allowedActors: readonly ActorKind[];
  readonly requiresHumanApprovalNote?: boolean;
}

export interface TransitionRequest<TState extends string> {
  readonly entityTable: "invoices" | "journal_entries" | "fiscal_years" | "pledged_invoices_registry";
  readonly entityId: string;
  readonly expectedFromState: TState;
  readonly targetState: TState;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly reasonOrProofRef?: string;
}

export function assertValidTransition<TState extends string>(
  rules: readonly TransitionRule<TState>[],
  req: TransitionRequest<TState>
): void {
  const matched = rules.find(
    (r) => r.to === req.targetState && r.from.includes(req.expectedFromState)
  );

  if (!matched) {
    throw new Error(
      `FSM_ILLEGAL_TRANSITION: [${req.entityTable}:${req.entityId}] ${req.expectedFromState} -> ${req.targetState}`
    );
  }

  if (!matched.allowedActors.includes(req.actorKind)) {
    throw new Error(
      `FSM_FORBIDDEN_ACTOR: Actor ${req.actorKind} cannot trigger ${req.expectedFromState} -> ${req.targetState}`
    );
  }

  if (matched.requiresHumanApprovalNote && (!req.reasonOrProofRef || req.reasonOrProofRef.trim().length < 5)) {
    throw new Error(
      `FSM_MISSING_PROOF: Transition to ${req.targetState} requires a documented reason or R2 proof reference.`
    );
  }
}

/**
 * Exécute de manière atomique le changement d'état avec verrou optimiste et trace d'audit dans Cloudflare D1
 */
export async function executeAtomicD1Transition<TState extends string>(
  tenantDb: D1Database,
  rules: readonly TransitionRule<TState>[],
  stateColumnName: "clearance_state" | "status" | "dispute_status",
  req: TransitionRequest<TState>
): Promise<{ transitionedAtIso: string }> {
  assertValidTransition(rules, req);
  const nowIso = new Date().toISOString();

  const updateStmt = tenantDb
    .prepare(
      `UPDATE ${req.entityTable}
       SET ${stateColumnName} = ?1
       WHERE id = ?2 AND ${stateColumnName} = ?3`
    )
    .bind(req.targetState, req.entityId, req.expectedFromState);

  const auditStmt = tenantDb
    .prepare(
      `INSERT INTO state_transition_audit
       (id, entity_table, entity_id, from_state, to_state, actor_kind, actor_id, idempotency_key, proof_ref, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      crypto.randomUUID(),
      req.entityTable,
      req.entityId,
      req.expectedFromState,
      req.targetState,
      req.actorKind,
      req.actorId,
      req.idempotencyKey,
      req.reasonOrProofRef ?? "",
      nowIso
    );

  const [updateRes] = await tenantDb.batch([updateStmt, auditStmt]);
  if (!updateRes || updateRes.meta.changes !== 1) {
    throw new Error(
      `FSM_CONCURRENCY_CONFLICT: State of [${req.entityTable}:${req.entityId}] changed concurrently.`
    );
  }

  return { transitionedAtIso: nowIso };
}
```

## Section 12 — Files d'Attente Asynchrones, Résilience & Dead-Letter Queues (DLQ)
Toutes les opérations asynchrones sur Cloudflare Queues respectent une matrice de résilience stricte garantissant zéro perte silencieuse de pièce comptable :

| File Cloudflare Queue | Consommateur | Tentatives Max & Backoff | File d'Erreur (DLQ) & Action de Repli |
|---|---|---|---|
| invoice-ingestion-queue | Extraction Docling / Clairic | 4 essais (5s, 30s, 2m, 10m) | dlq-ingestion → Bascule la pièce en PIECE_A_CONTROLER visible au cabinet |
| xhub-clearance-queue | Pont DgiClearanceWorkflow | 8 essais exponentiels jusqu'à 6h | dlq-xhub → Alerte critique tableau de bord + maintien du scellement local |
| erp-sync-outbound-queue | Webhooks Odoo / Agent Sage 100 | 6 essais (10s à 30m) | dlq-erp-sync → Mise en tampon SQLite local / génère export .PNM de secours |
| sovereign-mirror-queue | Réplication chiffrée vers miroir Maroc | 10 essais continus | dlq-mirror → Alerte monitoring Admin SYNAPTIC SYSTEMS + rejeu par lot |
| notifications-omnicanal | Infobip WhatsApp / SMS FISCA / SES | 3 essais rapides (2s, 15s, 60s) | Bascule automatique WhatsApp → SMS FISCA à 15s puis Email Amazon SES |

## Section 13 — FSM 10 : Session de Caisse POS, Ticket Z & Conversion B2C vers B2B xHub

Cette machine gouverne à la fois la session physique du caissier (en ligne ou hors-ligne) et la transformation sans doublon d'un ticket particulier en facture électronique B2B certifiée :

[CAISSE_FERMEE] ──(Comptage Fond Caisse >= 0 centime)──► [SESSION_OUVERTE_ACTIVE]
                                                                    │
         ┌──────────────────────────────────────────────────────────┼───────────────────────────────────┐
         ▼ (Encaissement Local < 100ms)                             ▼ (Coupure Réseau)                  ▼ (Fin de Poste)
[TICKET_SCELLE_SHA256_LOCAL] ◄─────────────────────── [MODE_OFFLINE_SQLITE_WASM]           [COMPTAGE_AVEUGLE_PRE_Z]
         │                                                                                              │
         ├──(Demande ICE immédiate ou scan QR avant Z)──► [CONVERTI_B2B_AVANT_Z]                        ▼
         │   (Exclu du Ticket Z B2C -> Envoyé vers FSM 01 xHub DGI)                       [CLOTURE_TICKET_Z_SCELLEE]
         │                                                                                (Écriture VTE B2C + Merkle R2)
         └──────────────────(Scan QR Client J+1..J+30 après Clôture Z)──────────────────────────────────┤
                                                                                                        ▼
                                                                                     [CONVERTI_B2B_POST_Z_NEUTRALISE]
                                                                                     (Extourne B2C du jour + Facture xHub)

* **Garde d'ouverture et de décaissement :** Aucune session ne peut s'ouvrir avec un fond négatif, et toute sortie d'espèces ou remise en banque (`5115`) supérieure au solde théorique en tiroir (`5161`) est bloquée matériellement.
* **Synchronisation Offline-to-Online :** Chaque terminal possède son propre préfixe de séquence (`POS-MAG01-CAISSE02-2026-xxxxx`) afin qu'aucune vente hors-ligne sur plusieurs tablettes ne crée de collision lors du retour de la connexion.
* **Invariance mathématique B2C vers B2B :** Un ticket ne peut subir la transition vers une facture B2B qu'une seule fois (contrainte `UNIQUE(pos_ticket_id)` sur la table `invoices`) ; si son Ticket Z d'origine est déjà à l'état `CLOTURE_TICKET_Z_SCELLEE`, la transaction atomique D1 crée simultanément la facture B2B xHub et une ligne négative de régularisation B2C pour préserver l'égalité exacte du chiffre d'affaires déclaré.
