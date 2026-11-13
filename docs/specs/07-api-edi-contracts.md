<!--
ID canonique : Doc_07_API_EDI   |   Fichier : docs/specs/07-api-edi-contracts.md
Source : « Document 07 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_07_API_EDI#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_07_API_EDI »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 07 — Contrats d'API & Spécifications des Flux EDI
Ce document définit selon une approche Design-First l'ensemble des contrats d'interfaces REST OpenAPI, des flux temps réel SSE, de la synchronisation hors-ligne Fisca POS, des webhooks signés, du serveur MCP et des schémas XML/XSD officiels de la DGI pour Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_07_API_EDI).
## Section 01 — Gouvernance Design-First, En-têtes HTTP & Loi d'Échange
Toutes les routes de apps/api-hono sont définies via @hono/zod-openapi avant toute implémentation métier afin de générer automatiquement le schéma openapi.json et le client RPC typé partagé avec React, Capacitor et la caisse tactile.

| En-tête HTTP | Caractère | Format Attendu | Rôle Sécuritaire et Transactionnel |
|---|---|---|---|
| Authorization | Requis | Bearer JWT ou OAuth 2.1 | Identifie l'acteur humain, l'agent ERP ou le client MCP |
| X-Fisca-Company-Id | Requis | UUIDv7 du dossier | Vérifié côté serveur contre les droits et mandats OEC |
| Idempotency-Key | Requis en écriture | UUIDv7 unique | Mis en cache 72h pour bloquer tout doublon comptable |
| X-Fisca-HPKE-Dek | Optionnel E2EE | Base64 RFC 9180 | Transmet la clé E2EE chiffrée pour la RAM de l'isolat V8 |
| Accept-Language | Optionnel | Code BCP-47 | Applique 6 langues PME/POS ou 3 langues Fiduciaire/Corporate |

Quatre règles de sérialisation gouvernent 100 % des payloads JSON entrants et sortants :
- Zéro nombre flottant sur le réseau : Tous les montants transitent en centimes entiers (_cents), les taux en points de base (_bps), les quantités en milli-unités (_milli) et les cours BAM en micro-unités (_micro).
- Enveloppe d'erreur normalisée RFC 9457 : Tout rejet retourne un statut HTTP précis accompagné de error_code, legal_ref (article du CGI ou du CGNC), trace_id W3C OpenTelemetry et issues[].
- Résolution hermétique du locataire : L'instance SQLite TENANT_DB est attachée par le middleware d'authentification ; aucun corps JSON ni outil IA n'est autorisé à cibler une autre base.
- Validation XSD pré-sortie obligatoire : Aucun fichier XML destiné à xHub ou au portail SIMPL n'est livré au client sans avoir franchi sans erreur le validateur binaire XSD / Schematron.
## Section 02 — Catalogue des Routes REST Hono v1 (/api/v1/*)
Le routeur principal regroupe les opérations synchrones en sept domaines métiers protégés par le middleware d'entitlements défini au Document 03 :

| Domaine Métier | Route Principale | Méthodes | Rôle Minimum | Livrable Déterministe |
|---|---|---|---|---|
| Identité & ICE | /api/v1/directory/ice/:ice | GET | Tout connecté | Enrichissement ICE 15 chiffres, IF, RC, ADC450 |
| Clearance xHub | /api/v1/invoices/:id/certify | POST | Gérant / Ventes | Numéro DO, UBL 2.1, XAdES Loi 43-20, Factur-X |
| Fisca POS | /api/v1/pos/sync-batch | POST | Terminal POS | Ingestion hors-ligne, Ticket Z et lettrage TPE |
| Achats & Banque | /api/v1/banking/reconcile | POST | Aide-Comptable | Lettrage, suspens 3497/4497 et VAT_CLEARING |
| Grand Livre | /api/v1/ledger/entries/:id/post | POST | Expert-Comptable | Scellement SHA-256 immuable ou contre-passation |
| Usine EDI DGI | /api/v1/edi/:declarationType | POST | Chef de Mission | Archives XML/ZIP validées XSD + FEC-MA 24 col. |
| Corporate & 48h | /api/v1/factorflow/pledge | POST | DAF / Gérant | Verrou anti-doublon, escompte 48h et pain.001 |

- Routes additionnelles cycle de vie : POST /api/v1/invoices/:id/cdv-response émet l'un des 8 statuts normalisés (APPROUVEE, EN_LITIGE_SUSPENDUE, ENCAISSEE) vers xHub DGI, et POST /api/v1/compliance/ras-tva/:id/certificate génère le certificat PDF de retenue 75 % ou 100 %.
- Sanctuarisation de la réversibilité : La route GET /api/v1/reversibility/export-10y et la route de vérification publique GET /api/v1/public/verify/:xhubUuid ignorent tout blocage commercial en cas d'abonnement impayé.

Ajoutez ce bloc de routes d'authentification publiques et protégées au registre @fisca_contracts_registry :

| Endpoint REST Hono | Méthode | Protection | Rôle Exact |
|---|---|---|---|
| /api/v1/auth/register | POST | Turnstile + Rate Limit | Crée le compte Email/Mot de passe et envoie le code SES |
| /api/v1/auth/verify-email | POST | Jeton / Code 6 chiffres | Passe is_email_verified = 1 et ouvre le flux KYB-1 |
| /api/v1/auth/login | POST | Turnstile + Anti-Bruteforce | Vérifie Email/Mot de passe et renvoie JWT ou défi 2FA |
| /api/v1/auth/google/start | GET | PKCE S256 + state KV | Redirige vers Google OAuth 2.0 (openid email profile) |
| /api/v1/auth/google/callback | GET | Vérif JWKS id_token | Lie ou connecte le profil Google puis vérifie le 2FA |
| /api/v1/auth/password/forgot | POST | Temps constant + SES | Envoie un lien de réinitialisation valable 15 minutes |
| /api/v1/auth/2fa/totp/setup | POST | JWT Actif | Génère le secret TOTP et l'URI QR otpauth:// |
| /api/v1/auth/2fa/totp/enable | POST | Code TOTP valide | Active le 2FA et retourne les 10 codes de secours |
| /api/v1/auth/2fa/verify | POST | mfa_challenge_token | Valide TOTP, OTP Infobip ou code secours et émet le JWT |

## Section 03 — Flux Temps Réel (SSE) & Protocole Offline Fisca POS
Pour offrir une fluidité de tableur sans rechargement lors du dépôt massif de jusqu'à 500 pièces d'achat, le backend diffuse l'avancement via Server-Sent Events :
- Flux GET /api/v1/purchases/stream : Émet quatre types d'événements typés (ingestion.queued, ocr.fields_extracted, cgi.cash_split_alert, pcge.account_proposed) contenant l'identifiant de ligne fixe pour remplir les rangées de 44px ou 28px sans aucun saut de mise en page.
- Contrat POST /api/v1/pos/sync-batch (Caisse Hors-Ligne) : Reçoit par lots jusqu'à 200 tickets signés localement sur SQLite WASM (terminal_seq_number préfixé par caisse, prev_ticket_sha256, ticket_sha256, ventilation TVA 20 %, 10 %, 0 % et droit de timbre espèces 25 bps). Le Worker vérifie la continuité mathématique de la chaîne SHA-256 avant d'acquitter chaque ticket_id.
- Contrat POST /api/v1/public/pos-qr/:qrToken/convert-b2b : Appelé lorsqu'un client professionnel scanne le QR Code de son ticket et saisit son ICE à 15 chiffres. Si le Ticket Z associé est déjà comptabilisé, l'endpoint exécute en une seule transaction atomique la création de la facture B2B xHub et l'écriture d'extourne B2C du jour afin d'interdire tout doublon de chiffre d'affaires sur le CPC et SIMPL-TVA.
## Section 04 — Contrats des Connecteurs ERP (Odoo, Sage 100 & Apache Camel)
L'interopérabilité bidirectionnelle avec le parc ERP installé au Maroc repose sur quatre protocoles verrouillés :
- Connecteur Python Odoo (l10n_ma_edi_clearance v17 à v20) : Appelle POST /api/v1/erp/odoo/clearance-entries signé par X-SaaS-Signature (HMAC-SHA256 du corps JSON trié) et Idempotency-Key pour certifier la facture et recevoir en retour dgi_clearance_uuid, ledger_entry_hash et qr_code_payload. Le hook sur account.partial.reconcile appelle POST /api/v1/erp/odoo/reconcile dès qu'un paiement est lettré afin de basculer la TVA sur encaissement et calculer la Loi 69-21.
- Connecteur Hybride Sage 100 (Sage100EdgeAgent en C# .NET 8) : Se connecte par tunnel sortant mTLS pour pousser les écritures extraites de SQL Server (WITH (NOLOCK) via le curseur cbMarq) sur POST /api/v1/erp/sage100/ingest-gl et consommer la file GET /api/v1/erp/sage100/outbound-entries injectée localement via le processus officiel IPMEncoder (Objets100cLib).
- Format Fallback universel .PNM Sage 100 (GET /api/v1/erp/sage100/export-pnm) : Pour les cabinets sans licence Objets Métiers, génère un fichier texte à largeur fixe stricte de 108 caractères par ligne (CRLF) : Code Journal (pos. 1 à 3), Date JJMMAA (4 à 9), Type pièce (10 à 11), Compte CGNC (12 à 24), Type G/X (25), Compte Tiers (26 à 38), Référence facture (39 à 51), Libellé nettoyé (52 à 76), Mode règlement (77), Échéance JJMMAA (78 à 83), Sens D/C (84), Montant formaté (85 à 104) et Type N (105).
- Grands Comptes Apache Camel & OData BI : Le conteneur camel-bridge expose AS4/SFTP/IDoc vers SAP, Oracle et Sage X3 pour synchroniser commandes et bons de réception multi-BL, tandis que GET /api/v1/bi/odata/$metadata livre en lecture seule les vues analytiques agrégées vers Power BI et Apache Superset.
## Section 05 — Webhooks Entrants & Sortants (Payzone, Infobip, SES & xHub)
Tous les webhooks entrants vérifient la signature cryptographique du fournisseur en temps constant et rejettent tout horodatage décalé de plus de 300 secondes :
- Webhook Payzone (POST /api/v1/webhooks/payzone) : Traite à la fois les renouvellements d'abonnements SaaS et le paiement direct d'une facture client ; dès réception d'un événement PAYMENT_CAPTURED sur une facture B2B, le Worker passe la facture à ENCAISSEE, fige le compteur Loi 69-21 et inscrit la ligne dans le sous-livre SIMPL-TVA du mois.
- Webhook Infobip (POST /api/v1/webhooks/infobip) : Gère d'une part les accusés de livraison OTP (déclenchant le SMS de secours expéditeur FISCA si le message WhatsApp n'est pas remis en 15 secondes), et d'autre part les photos de factures et messages vocaux envoyés au bot WhatsApp (avec message courtois de repli texte/photo si une note vocale Tamazight est détectée en V1).
- Collecteur Email (@ingest.fisca.ma via Cloudflare Email Routing + Amazon SES) : Vérifie SPF/DKIM, identifie le dossier via l'alias unique tenant_databases.ingest_email_alias, extrait les pièces jointes PDF/XML vers INVOICE_QUEUE et reconnaît nativement les grands facturiers marocains (IAM, Orange, inwi, SRM, Jawaz, Afriquia).
## Section 06 — Serveur MCP (mcp.fisca.ma/mcp) & Connecteur Meta Muse
Le serveur Model Context Protocol tourne sans état sur Cloudflare Workers via createMcpHandler derrière OAuth 2.1 + PKCE. Conformément aux ADR-02 et ADR-10, aucun outil MCP n'accepte d'identifiant de société en paramètre et tous les outils sont répartis en trois classes de sécurité :

| Classe d'Outil MCP | Outils Exposés | Mutation SQL | Validation Humaine Requise |
|---|---|---|---|
| 1. Lecture Certifiée | check_answerable, get_vat_forecast, search_cgi_wiki | Aucune | Non (lecture isolée du dossier) |
| 2. Audit & Contrôle | list_law6921_risks, inspect_fec_exceptions | Aucune | Non (calculs SQL déterministes) |
| 3. Brouillon Préparatoire | create_draft_invoice, propose_od_draft | Brouillon seul | Oui avant toute validation fiscale |

- Interdiction matérielle des actions irréversibles : Aucun outil MCP ne permet de passer une écriture au statut POSTED, de transmettre un fichier définitif à la DGI ni d'émettre un virement bancaire pain.001.
## Section 07 — Contrat XML OASIS UBL 2.1 (CIUS-MA), Factur-X & Signature Loi 43-20
Chaque facture électronique émise génère un fichier XML OASIS UBL 2.1 conforme à la norme EN 16931 (validé par ph-ubl et PHIVE) et embarqué dans un PDF/A-3b Factur-X bilingue Français/Arabe via Mustangproject :
- Codes de types UBL supportés : 380 (Facture commerciale ou décompte BTP), 381 (Avoir référençant obligatoirement l'UUID xHub initial dans BillingReference), 383 (Note de débit), 386 (Facture d'acompte) et 389 (Autofacturation mandatée).
- Mapping des identifiants légaux marocains (Art. 145 CGI & Lois 5-96 / 17-95) : L'ICE à 15 chiffres occupe PartyLegalEntity/CompanyID (schemeID="MA:ICE"), l'Identifiant Fiscal occupe PartyTaxScheme/CompanyID (schemeID="MA:IF"), la forme juridique et le capital social occupent CompanyLegalForm, et les numéros RC, Taxe Professionnelle et CNSS sont sérialisés dans AdditionalPartyIdentification.
- Chaînage et cas métiers Maroc : Le hash SHA-256 de la facture validée précédente (PIH) et le compteur monotone ICV sont inscrits dans AdditionalDocumentReference ; les lignes de Débours utilisent la catégorie hors champ O sans TVA, la Retenue de garantie BTP (7 % ou 10 %) et la RAS-TVA (75 % ou 100 %) sont portées en WithholdingTaxTotal, et le droit de timbre espèces (0,25 %) en AllowanceCharge.
- Enveloppe de signature XAdES-Baseline-T (Loi 43-20) : Injectée dans UBLExtensions avec canonisation xml-c14n11, vérification préalable que l'OID 2.5.4.97 ou 2.5.4.5 du certificat Barid eSign correspond à l'ICE/IF émetteur, signature HSM distante /csc/v2/signatures/signHash et jeton EncapsulatedTimeStamp RFC 3161.
## Section 08 — Contrats XSD DGI Lot 1 : SIMPL-TVA v4.0, RAS-TVA & Loi 69-21
Ces quatre flux sont encodés en UTF-8, validés contre leurs schémas .xsd officiels et compressés en archive .zip avant téléchargement :
- Relevé de Déductions SIMPL-TVA Annexe v4.0 (DeclarationReleveDeduction) : Impose un ordre séquentiel strict où la balise prorata (entier de 0 à 100) doit impérativement figurer entre tx et mp sous peine de rejet immédiat. Le code moyen de paiement mp/id est un entier de 1 à 7, l'unicité (if_fournisseur + num_facture) est garantie et l'égalité mht + tva == ttc est vérifiée au centime près.
- RAS-TVA Flux Fournisseur (DeclarationReleveRetenueSource — Annexe RDRS v1.0) : Permet au fournisseur d'imputer la TVA retenue à la source ; contrôle typeClient (1 à 4 public, 5 privé rendant refClient/if obligatoire), natureOperation (4 équipement, 5 travaux, 6 services), tauxTva limité à 20 ou 10 à compter de 2026, et tauxRetenue égal à 75 ou 100.
- RAS-TVA Flux Client Payeur (DeclarationVersementRASTVA) : Toujours mensuel (mois de 1 à 12), déclare pour chaque facture payée supérieure à 5 000 MAD TTC la base, le taux de retenue (75 % si attestation fiscale valide de moins de 6 mois au jour du décaissement, sinon 100 %) et le montant reversé.
- Délais de Paiement Loi 69-21 (DeclarationDelaisPaiement — Modèle ADC500B-23I v1.0) : Déclaration trimestrielle calculant l'échéance à partir de dateLivraisonMarchandise (60j légal, 120j contractuel ou 180j sectoriel), isolant sans pénalité les factures en montantFactureObjetLitige documentées dans R2, et arrondissant amendePecuniaire au dirham supérieur via Math.ceil.
## Section 09 — Contrats XSD DGI Lot 2 : SIMPL-IS v2.0.3, État des Ventes & DRVT
Le moteur packages/edi-simpl couvre la liasse fiscale complète et les quatre annexes de recoupement croisé de SIMPL-IS v2.0.3 :
- Liasse Fiscale SIMPL-IS v2.0.3 (Liasse en .zip, taille XML inférieure à 1 Mo) : Identifie le modèle comptable (1 Normal, 2 Simplifié, 3 Crédit, 4 Assurance), sérialise les cellules statiques ValeurCellule/cellule/codeEdi, les lignes répétables numeroLigne (Tableaux 3, 16, 18) et extraFieldvaleurs. Conformément à la v2.0.3, l'exporteur émet obligatoirement les lignes TOTAL GENERAL des Tableaux 4 (14045 à 14052) et 8 (14061 à 14064), les sous-totaux du Tableau 3 (18009, 18010, 18012, 18013), exclut les anciennes cellules 11501 à 11504 et omet les cellules nulles non obligatoires.
- État des Ventes par Client (EtatVentesParClient — Art. 20-I CGI) : Agrège par client B2B marocain (doté d'un ICE à 15 chiffres et d'un IF) les ventes HT/TTC, les rabais sur avoirs (comptes 7119/7129), le net, les encaissements TTC et le solde final 3421, après contrôle bloquant vérifiant que le CA domestique du CPC égale la somme de cet état B2B et des ventes B2C.
- Galaxie DRVT v2.0.3 (3 archives XML distinctes) :
- DeclarationRemunerationTiers (annuelle) : sépare honoraires et commissions soumis à la RAS (5 % pour personne morale IS, 10 % pour personne physique IR) et génère le nouveau bloc produitsLocationImmeubles incluant numArticleTaxeServicesCommunaux et la RAS sur loyers (10 % ou 15 % dès 120 000 MAD bruts/an).
- VersementRASRemunerationTiers (mensuelle) : prépare le brouillon de télépaiement mensuel de la retenue opérée.
- ImputationRASRemunerationTiers : inclut la balise obligatoire exercicePrelevement et la référence de quittance DGI pour déduire la RAS de 5 % subie des acomptes d'IS (typeVersementIS de 1 à 6).
## Section 10 — Contrats XSD DGI Lot 3 : État 9421, FEC-MA 24 Colonnes, SAF-T & ISO 20022
- État 9421 des Traitements et Salaires (TraitementEtSalaire — SIMPL-IR) : Livré en fichier .xml non compressé couvrant impérativement l'année civile du 1er janvier au 31 décembre. Contient les 38 balises d'en-tête suivies des 10 collections dans leur ordre exact, en corrigeant les divergences du parseur réel de la DGI : numPPR placé entre numCE et numCNSS, listSalariesCFC placée à l'intérieur de la racine juste après listPersonnelOccasionnel, balises d'identité vides auto-fermées, codes de paiement limités à ES, CH ou SIR, charges de famille plafonnées à 6, et cadrage préalable avec les comptes CGNC 6171 et 44525.
- Pack Contrôle Fiscal Informatisé Art. 211 CGI : Génère trois fichiers scellés ensemble :
- Le fichier plat {IF}FEC{YYYYMMDD}.txt à 24 colonnes séparées par pipe (|), encodé en UTF-8 avec fins de ligne CRLF, plaçant le journal d'ouverture AN équilibré en tête et ajoutant aux 18 colonnes standard les 6 extensions marocaines (TiersIF, TiersICE, ClearanceUUID, ModePaiementDGI, EntryHashSHA256, PrevHashSHA256).
- Le fichier XML SAF-T CGNC v2.0 (AuditFile OCDE v2.00 adapté Maroc).
- La notice descriptive réglementaire DESCRIPTIF_COMPTABILITE_ART211.json (et son PDF signé Loi 43-20) certifiant l'absence de trou de séquence et l'empreinte SHA-256 globale.
- Contrats Bancaires ISO 20022 : Génération du fichier XML de virement groupé pain.001.001.03 (refusant d'inclure toute facture dont le fournisseur a le statut ALERTE_RIB_DAF) et ingestion normalisée des relevés camt.053, SWIFT MT940 et CFONB 120.
## Section 11 — Code de Référence : Schémas OpenAPI Zod & Vérificateur Webhook
Ce module TypeScript sans aucun type any (packages/shared-types/src/api-contracts.ts) sert de contrat canonique entre le backend Hono, les frontends React/POS et les partenaires externes :

```ts
import { z } from "zod";

// 1. Primitives Monétaires Entières & Identifiants Fiscaux Marocains (Zéro Float)
export const CentimesIntSchema = z.number().int().safe();
export const BpsIntSchema = z.number().int().min(0).max(10000);
export const MilliIntSchema = z.number().int().positive();
export const Ice15Schema = z.string().regex(/^\d{15}$/, "L'ICE doit comporter exactement 15 chiffres.");
export const VatRate2026BpsSchema = z.union([
  z.literal(2000),
  z.literal(1000),
  z.literal(0),
]);

// 2. Contrat d'Émission de Facture Électronique UBL 2.1 / Clearance xHub
export const CreateInvoiceRequestSchema = z.object({
  ublTypeCode: z.enum([
    "380_FACTURE",
    "381_AVOIR",
    "383_NOTE_DEBIT",
    "386_ACOMPTE",
    "389_AUTOFACTURATION",
  ]),
  originInvoiceId: z.string().uuid().optional(),
  isBtpProgressStatement: z.boolean().default(false),
  btpRetentionRateBps: z.union([z.literal(0), z.literal(700), z.literal(1000)]).default(0),
  partnerId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ublPaymentCode: z.enum([
    "10_ESPECES",
    "20_CHEQUE",
    "30_VIREMENT",
    "42_EFFET_LCN",
    "48_CARTE",
    "97_COMPENSATION",
  ]),
  lines: z.array(
    z.object({
      isDisbursementDebours: z.boolean().default(false),
      descriptionFr: z.string().min(2).max(500),
      descriptionAr: z.string().max(500).optional(),
      quantityMilli: MilliIntSchema,
      unitPriceCents: CentimesIntSchema.nonnegative(),
      discountBps: BpsIntSchema.default(0),
      vatRateBps: VatRate2026BpsSchema,
      vatExemptionReasonCode: z.string().optional(),
      pcgeAccountNumber: z.string().regex(/^\d{4,8}$/),
    })
  ).min(1),
}).superRefine((val, ctx) => {
  if ((val.ublTypeCode === "381_AVOIR" || val.ublTypeCode === "383_NOTE_DEBIT") && !val.originInvoiceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "originInvoiceId est obligatoire pour un Avoir (381) ou une Note de Débit (383).",
      path: ["originInvoiceId"],
    });
  }
  val.lines.forEach((line, idx) => {
    if (line.vatRateBps === 0 && !line.isDisbursementDebours && !line.vatExemptionReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motif légal d'exonération (Art. 91 ou 92 CGI) obligatoire pour une ligne à 0 % hors débours.",
        path: ["lines", idx, "vatExemptionReasonCode"],
      });
    }
  });
});

// 3. Enveloppe d'Erreur Déterministe Conforme RFC 9457
export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int(),
  errorCode: z.string(),
  legalRef: z.string().optional(),
  traceId: z.string(),
  detail: z.string(),
});

// 4. Vérificateur Cryptographique de Webhooks (HMAC-SHA256 Temps Constant + Anti-Rejeu 300s)
export async function verifySignedWebhookPayload(params: {
  readonly rawBodyText: string;
  readonly signatureHexHeader: string;
  readonly timestampSecHeader: string;
  readonly sharedSecret: string;
  readonly maxSkewSeconds?: number;
}): Promise<boolean> {
  const maxSkew = params.maxSkewSeconds ?? 300;
  const ts = Number.parseInt(params.timestampSecHeader, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(ts) || Math.abs(nowSec - ts) > maxSkew) {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(params.sharedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedMessage = `${params.timestampSecHeader}.${params.rawBodyText}`;
  const macBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedMessage));
  const expectedBytes = new Uint8Array(macBuffer);

  if (params.signatureHexHeader.length !== expectedBytes.length * 2) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    const providedByte = Number.parseInt(params.signatureHexHeader.slice(i * 2, i * 2 + 2), 16);
    diff |= (expectedBytes[i] ?? 0) ^ providedByte;
  }
  return diff === 0;
}
```

## Section 12 — Protocole @fisca_contracts_registry & Harnais de Tests QA
Pour que trois sessions parallèles Hyperagent construisent simultanément le backend, l'interface React/POS et les connecteurs ERP sans aucun décalage :
- Publication automatique OpenAPI : Toute modification d'une route dans apps/api-hono régénère packages/shared-types/openapi.json et met à jour la ligne correspondante dans la table globale @fisca_contracts_registry.
- Suite de validation XSD hors-ligne (pnpm test:xsd) : Stocke dans packages/edi-simpl/xsd/ les schémas officiels OASIS UBL 2.1, SIMPL-TVA v4.0, SIMPL-IS v2.0.3, État 9421, DRVT v2.0.3, ADC500B-23I et ISO 20022 pain.001, et valide chaque XML généré avec xmllint --noout --schema lors des Barrières QA.
- Tests d'intrusion contractuels obligatoires : L'agent Fisca-QA-Security-Auditor vérifie le rejet HTTP 400 de tout montant décimal flottant, le rejet HTTP 401 d'un webhook rejoué à t + 301s, l'idempotence exacte d'un double appel certify portant la même Idempotency-Key, et l'absence totale de paramètre tenant_id sur l'ensemble des outils exposés par mcp.fisca.ma/mcp.
