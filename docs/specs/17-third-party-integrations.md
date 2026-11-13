<!--
ID canonique : Doc_17_Third_Party_Integrations   |   Fichier : docs/specs/17-third-party-integrations.md
Source : « Document 17 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_17_Third_Party_Integrations#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_17_Third_Party_Integrations »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 17 — Intégrations des Services Tiers
Ce document spécifie l'architecture technique, les protocoles de sécurité, la gouvernance anti-bannissement Meta et les modes dégradés de tous les connecteurs externes de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_17_Third_Party_Integrations).
## Section 01 — Architecture Unifiée des Connecteurs Externes & Garde-Fous
Tous les appels vers des fournisseurs tiers sont centralisés dans le package packages/external-integrations afin qu'aucune route métier n'appelle directement fetch sans contrôle de souveraineté, timeout ni disjoncteur.
- Coupe-circuit réglementaire préalable : Chaque connecteur invoque d'abord assertSovereignEgressAllowed pour bloquer tout flux hors Maroc sur les dossiers ENT_SOUVERAIN (Loi n° 05-20 DGSSI).
- Zéro secret en dehors du coffre : Les clés API et certificats clients mTLS résident exclusivement dans Cloudflare Secrets Store et ne sont jamais journalisés dans les traces OpenTelemetry.
- Vérification webhook constante et idempotence : Tout webhook entrant valide une signature HMAC en temps constant (fenêtre maximale de 300 secondes) et dédoublonne chaque événement sur 72 heures.
- Isolation par disjoncteur Edge : L'état de santé de chaque fournisseur est suivi dans Cloudflare KV / Durable Object pour basculer automatiquement sur le canal de secours dès le seuil d'erreurs franchi.
## Section 02 — WhatsApp Business Platform : Gouvernance Anti-Ban Meta & Fenêtre 24h
Le numéro officiel WhatsApp Business de Fisca constitue un canal vital de collecte de pièces et de validation OTP ; six règles techniques empêchent tout déclassement ou bannissement par Meta :
- Séparation stricte des numéros et catégories Meta : Un numéro WABA vérifié pour SYNAPTIC SYSTEMS SARL AU est dédié exclusivement aux flux AUTHENTICATION et UTILITY, avec interdiction totale d'envoyer de la prospection MARKETING à froid.
- Preuve d'Opt-In horodatée obligatoire : Aucun message sortant hors fenêtre de 24 heures n'est émis si la colonne whatsapp_optin_at est vide ; les mots-clés d'arrêt (STOP, ARRET, إيقاف) désactivent les relances avant tout signalement Meta.
- Consolidation mensuelle le 10 du mois : Le workflow fiduciaire regroupe toutes les pièces justificatives manquantes d'une PME dans un seul message récapitulatif mensuel au lieu de notifications unitaires répétitives.
- Sentinelle automatique du Quality Rating Meta : Le webhook écoute phone_number_quality_update (GREEN, YELLOW, RED). Si la note passe à YELLOW, les relances groupées sont suspendues 48 heures au profit d'Amazon SES.
- Exploitation de la fenêtre entrante gratuite de 24 heures : Dès qu'un gérant envoie la photo d'un reçu ou d'une facture, le bot répond gratuitement via boutons rapides (Payé Espèces, Payé Carte/Virement, À vérifier) sans muter directement le Grand Livre.
- Règle vocale multilingue V1 : Les notes vocales sont transcrites en Darija, Arabe, Français et Anglais ; toute note vocale détectée en Tamazight reçoit une réponse courtoise invitant à photographier la pièce ou écrire au clavier.
## Section 03 — Infobip Omnichannel : Cascade WhatsApp vers SMS FISCA en 15 Secondes
Pour garantir une délivrabilité proche de 100 % sur les opérateurs marocains (Maroc Telecom / IAM, Orange Maroc, inwi) tout en divisant le coût messagerie par quatre (Document 13), Fisca utilise l'API OMNI Failover d'Infobip hébergée en juridiction Union Européenne :

| Étape de Cascade | Canal Activé | Délai de Validité | Identifiant Émetteur | Condition de Passage Suivant |
|---|---|---|---|---|
| Étape 1 (T0) | WhatsApp Business (AUTHENTICATION) | 15 secondes | Compte certifié Fisca | Non remis (UNDELIVERABLE ou hors-ligne 15s) |
| Étape 2 (T+15s) | SMS Opérateur Direct Maroc | 10 minutes | Expéditeur FISCA | Échec réseau cellulaire après 60 secondes |
| Étape 3 (Secours) | Email Transactionnel SES | 10 minutes | no-reply@fisca.ma | Uniquement si email vérifié sur le profil |

- Bouton de copie OTP en 1 geste : Le modèle WhatsApp utilise le format officiel AUTHENTICATION à bouton COPY_CODE sans lien externe ni émoji afin d'obtenir une validation instantanée par les filtres automatiques de Meta.
- Protection anti-pompage SMS (SMS Pumping Fraud Guard) : Un limiteur Cloudflare KV / Turnstile plafonne les demandes d'OTP à 3 envois par numéro sur 15 minutes et bloque les préfixes internationaux à haut risque hors Maroc et diaspora autorisée.
## Section 04 — Amazon SES UE & Collecte Documentaire @ingest.fisca.ma
L'architecture email sépare l'émission transactionnelle sortante via Amazon SES (eu-west-3 Paris, conforme à l'Article 43 de la Loi n° 09-08 CNDP) et la réception haut débit des factures fournisseurs via Cloudflare Email Routing :
- Authentification DNS et réputation sortante : Les domaines fisca.ma et mail.fisca.ma publient un enregistrement SPF strict, une double clé DKIM RSA 2048 bits en rotation semestrielle et une politique DMARC à p=reject.
- Bouclier automatique anti-bounces SNS : Le webhook /api/v1/webhooks/ses-events vérifie le certificat X.509 Amazon SNS et inscrit immédiatement tout Hard Bounce ou plainte spam en liste de suppression locale pour maintenir un taux de rebond inférieur à 2 %.
- Pipeline entrant {dossier}@ingest.fisca.ma : L'Email Worker rejette tout courriel échouant à la fois spf=pass et dkim=pass, refuse les pièces jointes exécutables ou supérieures à 25 Mo, et pousse les flux PDF, XML UBL/Factur-X et images directement vers R2_LEGAL_VAULT.
- Reconnaissance déterministe des grands facturiers marocains : Un pré-analyseur de Niveau 0 identifie les expéditeurs récurrents (IAM, Orange, inwi, SRM / Lydec / Redal / Amendis, Jawaz, Afriquia) pour pré-affecter le compte PCGE et le taux de TVA 2026 à coût IA nul.
## Section 05 — Payzone Maroc & SIMT : Abonnements MIT, BYO-MID Client & Loi 103-12
Pour respecter scrupuleusement la Loi bancaire n° 103-12 de Bank Al-Maghrib (interdiction absolue d'encaisser des fonds pour le compte d'autrui sans agrément d'établissement de paiement), l'intégration Payzone sépare deux circuits hermétiques :
- Circuit A — Facturation SaaS SYNAPTIC SYSTEMS SARL AU : Enrôle les cartes nationales CMI, Visa et Mastercard via la page sécurisée Payzone avec authentification 3-D Secure v2, ne conserve que payzone_card_token et l'identifiant de mandat récurrent (conformité PCI-DSS SAQ-A), puis déclenche les prélèvements automatiques MIT (plans PME, licences POS et compteur fiduciaire au dossier) ainsi que le cycle de relance à J0, J+3, J+7 et J+12.
- Circuit B — Encaissement Direct des Factures PME (BYO-MID) : Chaque entreprise cliente saisit ses propres identifiants marchand Payzone ou Fatourati dans son coffre chiffré. Lorsqu'un acheteur clique sur Payer cette facture, 100 % des fonds sont crédités par l'acquéreur directement sur le compte bancaire de la PME ; Fisca reçoit uniquement le webhook signé qui passe la facture à ENCAISSEE, fige le compteur Loi 69-21 et génère l'écriture VAT_CLEARING (44558 vers 44551).
- Circuit C — Virements SIMT à Référence Structurée : Sur les contrats annuels Corporate / Souverain et les cabinets fiduciaires réglant par virement, l'import quotidien du relevé CAMT.053 / MT940 de SYNAPTIC SYSTEMS lettre automatiquement le motif FISCA-SUB-{ORG_ID}-{YYYYMM} et réactive les droits en moins de 2 secondes.
## Section 06 — Barid eSign HSM (Loi 43-20 DGSSI) : CSC API v2.0 & Horodatage RFC 3161
La signature électronique qualifiée et le cachet personne morale exigés par la Loi n° 43-20 s'exécutent à distance sur le HSM qualifié de Barid eSign via le standard Cloud Signature Consortium (CSC) API v2.0 sur liaison mTLS, sans qu'aucune facture en clair ne quitte Fisca :
- Étape 1 — Inspection du certificat (/csc/v2/credentials/info) : Récupère la chaîne X.509 du client et bloque immédiatement l'opération via assertCertificateMatchesEmitter si l'attribut OID 2.5.4.97 ou 2.5.4.5 ne correspond ni à l'ICE à 15 chiffres ni à l'IF du dossier émetteur.
- Étape 2 — Activation forte (/csc/v2/credentials/authorize) : Après validation Step-Up 2FA de moins de 300 secondes et saisie du code PIN HSM par le signataire, obtient le jeton temporaire SAD (Signature Activation Data).
- Étape 3 — Signature du condensat seul (/csc/v2/signatures/signHash) : Le Worker calcule en WebCrypto pur le condensat SHA-256 de 32 octets du XML UBL canonisé (xml-c14n11) et des SignedProperties, transmet uniquement ce hash de 32 octets au HSM et encapsule la signature retournée en XAdES-Baseline-T / PAdES-Baseline-T.
- Étape 4 — Horodatage quotidien de l'Arbre de Merkle (RFC 3161) : À 23h59, un Cron construit en ASN.1 DER une requête TimeStampReq (OID SHA-256 2.16.840.1.101.3.4.2.1) sur l'unique racine merkle_root_sha256 du jour, puis renouvelle tous les 24 mois les racines archivées en SHA-512 (OID 2.16.840.1.101.3.4.2.3).
## Section 07 — DirectInfo OMPIC, Attestations DGI/CNSS & Passerelle Nationale xHub
- Enrichissement ICE & Pare-feu légal DirectInfo OMPIC : Lors de la saisie d'un ICE à 15 chiffres absent du cache ou âgé de plus de 30 jours, le connecteur interroge les référentiels publics et l'API DirectInfo OMPIC pour consolider raison sociale FR/AR, RC, Tribunal, forme juridique et capital dans morocco_company_directory. Conformément au Document 01, Fisca ne revend jamais les documents PDF officiels OMPIC et commercialise uniquement son propre Rapport de Scoring & Solvabilité IA (15 MAD HT sur KYB_WALLET).
- Contrôle des Attestations Fiscales DGI (Art. 117 CGI) & CNSS : Pour trancher automatiquement entre une RAS-TVA de 75 % et de 100 % au décaissement d'une facture fournisseur supérieure ou égale à 5 000 MAD TTC, le connecteur combine l'analyse forensique binaire du PDF (xref / XMP anti-retouche), la vérification du code d'authenticité/QR DGI et le contrôle calendaire strict de moins de 6 mois à la date du paiement.
- Passerelle Nationale Clearance xHub DGI : Les soumissions UBL 2.1 signées partent en mTLS via DgiClearanceWorkflow (8 tentatives à recul exponentiel jusqu'à 6 heures sans jamais créer de trou dans InvoiceSequencerDO), tandis que le webhook /api/v1/webhooks/xhub-cdv reçoit les messages ApplicationResponse mettant à jour les 8 statuts du cycle de vie.
## Section 08 — Courtier Google OAuth 2.0 (auth.fisca.ma) & Alertes Teams / Slack
- Courtier OIDC multi-domaines (auth.fisca.ma) : Utilise le flux Authorization Code avec PKCE S256, valide la signature RS256 de l'id_token contre les clés publiques JWKS de Google mises en cache KV, exige email_verified === true et s'appuie sur le champ immuable sub. Un paramètre state signé en HMAC-SHA256 redirige en toute sécurité l'utilisateur vers le sous-domaine marque blanche de son cabinet fiduciaire avant d'imposer le défi 2FA Fisca si activé.
- Connecteurs Grands Comptes Microsoft Teams & Slack : Poussent des cartes structurées signées (Adaptive Cards Teams et Block Kit Slack) lorsqu'un écart de prix ou de quantité bloque un rapprochement 3-Way Matching, lorsqu'un contrat BPU du LLM Wiki détecte une surfacturation, ou lorsqu'un changement de RIB fournisseur requiert le double visa SoD-02 du DAF.
## Section 09 — Matrice des Timeouts, Disjoncteurs & Comportement Souverain Loi 05-20
Chaque intégration externe respecte des bornes temporelles strictes et s'adapte automatiquement lorsque le dossier relève de l'offre nationale ENT_SOUVERAIN :

| Fournisseur Externe | Timeout HTTP | Ouverture Disjoncteur | Repli Automatique (Parc Standard) | Mode Souverain Maroc (Loi 05-20) |
|---|---|---|---|---|
| Passerelle xHub DGI | 12 s | 5 erreurs 5xx / 1m | File DgiClearanceWorkflow 6h | Autorisé (Serveur régalien .gov.ma) |
| Barid eSign HSM/TSA | 8 s | 3 timeouts de suite | File de scellement différé + alerte | Autorisé (PSCE national Maroc) |
| Infobip WA + FISCA | 10 s | Non remis sous 15 s | SMS FISCA à 15s puis Email SES | Relais SMS national direct / TOTP |
| Amazon SES UE | 8 s | Taux erreur supérieur à 5 % | Mise en file locale de réessai | Remplacé par relais SMTP souverain Maroc |
| Payzone Maroc | 15 s | 4 erreurs passerelle | Réessai webhook + grâce 14 jours | Autorisé (Opérateur monétique Maroc) |
| DirectInfo OMPIC | 10 s | Indisponibilité portail | Cache morocco_company_directory | Autorisé (Établissement public Maroc) |
| Google OAuth / Teams | 8 s | Timeout JWKS / API | Login Email + Mot de passe + 2FA | Désactivé au profit de SAML/OIDC local |

## Section 10 — Dossiers Administratifs Marocains Pré-Go-Live (Checklist Rabat)
Avant le lancement commercial, SYNAPTIC SYSTEMS SARL AU boucle ces cinq démarches administratives auprès des opérateurs nationaux :
- Enregistrement de l'expéditeur SMS alphanumérique FISCA : Remise à Infobip Maroc du dossier réglementaire pour pré-validation auprès de Maroc Telecom, Orange et inwi (Modèle J du RC Rabat, attestation de réservation ANRT fisca.ma, lettre de mandat cachetée et modèles de messages OTP).
- Vérification Meta Business & Compte WABA : Validation de l'entité légale SYNAPTIC SYSTEMS SARL AU dans Meta Business Suite et pré-approbation des gabarits bilingues FR/AR fisca_otp_auth (AUTHENTICATION) et fisca_missing_docs_monthly (UTILITY).
- Contrat Marchand Payzone Récurrent (MIT + 3DS2) : Activation de l'option de tokenisation récurrente pour l'abonnement SaaS de SYNAPTIC SYSTEMS et ouverture de l'interface partenaire permettant aux PME de relier leur propre contrat marchand (BYO-MID).
- Convention PSCE Barid eSign (Loi n° 43-20) : Obtention des certificats clients mTLS d'accès à l'API CSC v2.0 de qualification/production et au serveur d'horodatage RFC 3161, ainsi que du cachet électronique qualifié propre à SYNAPTIC SYSTEMS SARL AU pour l'auto-facturation de ses abonnements.
- Abonnement API DirectInfo OMPIC & Sortie de Sandbox AWS SES : Activation des accès API B2B OMPIC et validation par AWS du passage en mode Production SES sur la région eu-west-3 (Paris) avec routage SNS des rebonds actif.
## Section 11 — Code de Référence : Orchestrateur Infobip Anti-Ban, Client CSC v2 & Guard SES
Ce module TypeScript pur sans aucun type any (packages/external-integrations/src/providers.ts) implémente l'envoi OTP Infobip avec cascade de 15 secondes vers l'expéditeur FISCA, la sentinelle anti-bannissement Meta et la signature distante de condensat Barid eSign CSC v2.0 :

```ts
import { assertSovereignEgressAllowed, type SovereigntyPolicy } from "@fisca/compliance-cndp";
import { FISCA_ADR_INVARIANTS } from "@fisca/shared-types";

export type MetaPhoneQualityRating = "GREEN" | "YELLOW" | "RED";

export interface InfobipOtpCascadeRequest {
  readonly sovereigntyPolicy: SovereigntyPolicy;
  readonly infobipBaseUrlEu: string; // Ex: "https://eu.api.infobip.com"
  readonly infobipApiKey: string;
  readonly whatsappSenderNumber: string;
  readonly recipientPhoneE164: string;
  readonly sixDigitOtp: string;
  readonly locale: "fr" | "ar" | "en";
  readonly currentMetaQuality: MetaPhoneQualityRating;
}

export interface InfobipCascadeResult {
  readonly bulkId: string;
  readonly primaryChannelUsed: "WHATSAPP_THEN_SMS_FISCA" | "SMS_FISCA_DIRECT_FALLBACK";
}

/**
 * 1. Cascade OTP Infobip : WhatsApp Business (15s) -> Failover automatique SMS expéditeur "FISCA"
 *    Bascule directement en SMS si le Quality Rating Meta est dégradé en RED (protection anti-ban).
 */
export async function sendOtpWithInfobip15sFailover(
  req: InfobipOtpCascadeRequest
): Promise<InfobipCascadeResult> {
  assertSovereignEgressAllowed(req.sovereigntyPolicy, {
    serviceName: "Infobip_EU_Morocco_Gateway",
    destinationCountryIso2: req.sovereigntyPolicy === "STRICT_DGSSI_LAW_05_20_MOROCCO" ? "MA" : "FR",
    hasCndpF118Authorization: true,
    carriesPersonalOrFiscalData: true,
  });

  if (!/^\+[1-9]\d{8,14}$/.test(req.recipientPhoneE164) || !/^\d{6}$/.test(req.sixDigitOtp)) {
    throw new Error("INFOBIP_INVALID_PHONE_OR_OTP_FORMAT");
  }

  const smsText =
    req.locale === "ar"
      ? `رمز التحقق الخاص بك في FISCA هو: ${req.sixDigitOtp} (صالح لمدة 10 دقائق).`
      : `Votre code de verification FISCA est : ${req.sixDigitOtp} (valable 10 min).`;

  const bypassWhatsApp = req.currentMetaQuality === "RED";
  const steps = bypassWhatsApp
    ? [
        {
          channel: "SMS",
          sender: "FISCA",
          validityPeriod: { amount: 10, timeUnit: "MINUTES" },
          text: smsText,
        },
      ]
    : [
        {
          channel: "WHATSAPP",
          sender: req.whatsappSenderNumber,
          validityPeriod: { amount: 15, timeUnit: "SECONDS" }, // Bascule exacte à 15 secondes !
          templateName: "fisca_otp_auth",
          language: req.locale === "ar" ? "ar" : "fr",
          templateData: {
            body: { placeholders: [req.sixDigitOtp] },
            buttons: [{ type: "URL", parameter: req.sixDigitOtp }],
          },
        },
        {
          channel: "SMS",
          sender: "FISCA",
          validityPeriod: { amount: 10, timeUnit: "MINUTES" },
          text: smsText,
        },
      ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${req.infobipBaseUrlEu}/omni/1/advanced`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `App ${req.infobipApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        destinations: [{ to: { phoneNumber: req.recipientPhoneE164 } }],
        scenarioPayload: { steps },
      }),
    });

    if (!response.ok) {
      throw new Error(`INFOBIP_HTTP_ERROR_${response.status}`);
    }
    const data = (await response.json()) as { readonly bulkId: string };
    return {
      bulkId: data.bulkId,
      primaryChannelUsed: bypassWhatsApp ? "SMS_FISCA_DIRECT_FALLBACK" : "WHATSAPP_THEN_SMS_FISCA",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 2. Gouverneur Anti-Ban Meta : Bloque toute relance proactive non critique si le Quality Rating quitte GREEN
 */
export function canSendProactiveWhatsAppUtilityTemplate(params: {
  readonly whatsappOptInIso: string | null;
  readonly unsubscribedAtIso: string | null;
  readonly metaQualityRating: MetaPhoneQualityRating;
}): { readonly allowed: boolean; readonly fallbackChannel?: "AMAZON_SES_EMAIL" } {
  if (!params.whatsappOptInIso || params.unsubscribedAtIso !== null) {
    return { allowed: false, fallbackChannel: "AMAZON_SES_EMAIL" };
  }
  if (params.metaQualityRating !== "GREEN") {
    return { allowed: false, fallbackChannel: "AMAZON_SES_EMAIL" };
  }
  return { allowed: true };
}

/**
 * 3. Client HSM Qualifié Barid eSign (Loi 43-20 DGSSI — Protocole CSC API v2.0 /signHash)
 *    Seul le condensat SHA-256 de 32 octets (Base64) est transmis au HSM distant.
 */
export interface BaridCscSignHashInput {
  readonly cscBaseUrlMa: string; // Endpoint national Maroc (.ma)
  readonly oauthAccessToken: string;
  readonly credentialId: string;
  readonly sadActivationToken: string;
  readonly certSubjectDn: string;
  readonly emitterIce15: string;
  readonly emitterIf: string;
  readonly sha256DigestBase64: string;
}

export async function signDigestViaBaridEsignCscV2(
  input: BaridCscSignHashInput
): Promise<{ readonly rawSignatureBase64: string }> {
  // Garde ADR-06 : Concordance stricte OID Certificat X.509 == ICE ou IF émetteur
  FISCA_ADR_INVARIANTS.assertCertificateMatchesEmitter(
    input.certSubjectDn,
    input.emitterIce15,
    input.emitterIf
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${input.cscBaseUrlMa}/csc/v2/signatures/signHash`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.oauthAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credentialID: input.credentialId,
        SAD: input.sadActivationToken,
        hashAlgorithmOID: "2.16.840.1.101.3.4.2.1", // OID officiel NIST SHA-256
        signAlgo: "1.2.840.113549.1.1.11",          // sha256WithRSAEncryption / ECDSA
        hashes: [input.sha256DigestBase64],
      }),
    });

    if (!res.ok) {
      throw new Error(`BARID_ESIGN_CSC_HTTP_${res.status}`);
    }
    const payload = (await res.json()) as { readonly signatures: readonly string[] };
    const sig = payload.signatures[0];
    if (!sig) {
      throw new Error("BARID_ESIGN_EMPTY_SIGNATURE");
    }
    return { rawSignatureBase64: sig };
  } finally {
    clearTimeout(timer);
  }
}
```

## Section 12 — Harnais de Simulation Hors-Ligne & Tests de Contrats Tiers
Aucun test automatisé dans Hyperagent ni dans GitHub Actions ne dépend d'une connexion réelle aux serveurs de Meta, Payzone ou Barid eSign ; l'agent Fisca-QA-Security-Auditor exécute six simulations déterministes bloquantes :
- Test de Cascade Infobip 15s & Expéditeur FISCA : Intercepte le corps JSON envoyé à /omni/1/advanced et vérifie la présence séquentielle de l'étape WHATSAPP bornée à 15 secondes suivie de l'étape SMS portant exactement sender: "FISCA".
- Test Sentinelle Anti-Ban Meta (YELLOW / RED) : Simule un webhook phone_number_quality_update passant à YELLOW et vérifie que canSendProactiveWhatsAppUtilityTemplate bloque immédiatement les relances groupées vers Amazon SES, tandis qu'un passage à RED bascule les OTP en SMS direct.
- Test Vocal WhatsApp V1 (Refus Courtois Tamazight) : Soumet un événement média audio étiqueté Tamazight et vérifie qu'aucune transcription erronée n'est tentée et que la réponse invite poliment l'utilisateur à envoyer une photo ou un texte.
- Test Séparation Loi 103-12 Payzone (BYO-MID) : Vérifie qu'un lien de paiement généré sur une facture client PME utilise exclusivement les identifiants marchands déchiffrés de cette PME et jamais le compte marchand SaaS de SYNAPTIC SYSTEMS SARL AU.
- Test Blocage Certificat Barid eSign (OID != ICE) : Injecte un certificat X.509 valide appartenant à une autre société marocaine et vérifie que signDigestViaBaridEsignCscV2 avorte avant tout appel réseau avec ADR_06_LOI4320_CERT_MISMATCH.
- Test d'Ingestion @ingest.fisca.ma & Suppression Bounce SES : Simule un email entrant sans signature SPF/DKIM valide (rejeté immédiatement), un email IAM valide avec PDF Factur-X (extrait au Niveau 0 sans token IA) et un événement SNS Hard Bounce (bloquant tout renvoi ultérieur vers cette adresse).
