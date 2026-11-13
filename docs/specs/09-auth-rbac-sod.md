<!--
ID canonique : Doc_09_RBAC_SoD   |   Fichier : docs/specs/09-auth-rbac-sod.md
Source : « Document 09 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_09_RBAC_SoD#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_09_RBAC_SoD »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 09 — Matrice d'Authentification, d'Autorisation & Séparation des Tâches
Ce document définit l'architecture Zero-Trust d'identité, les parcours d'authentification forte (Passkeys WebAuthn, OTP Infobip et SSO), le contrôle d'accès hybride RBAC / ABAC, le visa cabinet à 3 niveaux et la séparation des tâches (SoD) de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_09_RBAC_SoD).
## Section 01 — Architecture Zero-Trust d'Identité & Principes Directeurs
Dans Fisca, aucune requête humaine, caisse tactile, passerelle ERP ni agent IA n'accède à une base locataire sans franchir une chaîne de vérification cryptographique et contextuelle côté serveur.
- Identité vérifiée avant routage SQL : Le middleware Hono authentifie le jeton, vérifie l'appartenance active au dossier ou le mandat fiduciaire, puis attache la base isolée.
- Triple barrière d'autorisation : Chaque action combine le rôle métier (RBAC), les attributs dynamiques du contexte (ABAC) et l'incompatibilité des fonctions critiques (SoD).
- Moindre privilège des agents IA : Conformément aux règles de sécurité agentique, tous les agents IA et outils MCP ont la propriété d'écriture directe verrouillée à faux.
- Traçabilité inaltérable des accès : Toute élévation de privilège, approbation de RIB, signature fiscale ou révocation de mandat est journalisée avec horodatage UTC et empreinte.
## Section 02 — Parcours Signup, Login (Google OAuth & Email/Password) & 2FA Complet

L'authentification offre dès l'écran d'accueil le choix entre **Continuer avec Google** et **Email + Mot de passe**, protégés par Cloudflare Turnstile (anti-bot invisible) et une couche **2FA** complète.

```text
[Écran Signup / Login]
   ├──► Option A : "Continuer avec Google" (OIDC + PKCE S256 via auth.fisca.ma)
   │       └──► Vérification JWKS Google (email_verified == true) + Safe Account Linking sur 'sub'
   └──► Option B : "Email + Mot de passe" (12+ car., PBKDF2-SHA512 + Pepper, vérif email Amazon SES)
                    │
                    ▼ (Facteur 1 validé — Verrouillage temporaire 15 min après 5 échecs consécutifs)
         [2FA Activé sur le profil OU Imposé par le rôle OEC / DAF ?]
            ├── NON (PME standard) ──► Émission JWT EdDSA (15 min) + Refresh Cookie HttpOnly Rotatif
            └── OUI ──► Émission mfa_challenge_token (TTL 5 min, zéro droit API métier)
                           ├──► Code 6 chiffres App TOTP (Google Authenticator / Authy / 1Password)
                           ├──► Code 6 chiffres Infobip (WhatsApp Business -> SMS FISCA auto à 15s)
                           └──► Code de secours à usage unique (1 parmi 10 générés à l'enrôlement)
                                        │
                                        ▼
                        Émission JWT EdDSA (avec claim mfa_verified_at pour Step-Up < 300s)
```

- Politique d'obligation du 2FA : Facultatif mais fortement encouragé avec bannière d'incitation pour SOLO_AE et CAISSIER_POS ; obligatoire dès la fin de l'onboarding pour les rôles EXPERT_COMPTABLE_OEC, CHEF_MISSION, DAF_TRESORIER, et pour tout OWNER_GERANT dès l'activation de la signature fiscale Loi 43-20 ou des virements pain.001.
- Appareil de confiance 30 jours vs Step-Up 5 minutes : Cocher « Se souvenir de cet appareil pendant 30 jours » évite la ressaisie du 2FA au login matinal, mais toute action sensible (PARTNER_APPROVE_RIB_CHANGE, PAYMENT_SIGN_PAIN001, LEDGER_POST_IMMUTABLE, E2EE_REVOKE_CPA_GRANT) exige toujours une validation 2FA ou Passkey datant de moins de 300 secondes.
- Continuité hors-ligne Fisca POS : L'appairage initial de la tablette POS requiert un login complet (Google ou Email + 2FA) du OWNER_GERANT ; ensuite, les caissiers opèrent hors-ligne par code PIN local à 6 chiffres.

### Module TypeScript de Référence : Mot de Passe Pepper, Google PKCE & Vérificateur TOTP RFC 6238 (packages/auth-rbac/src/auth-2fa.ts)

```ts
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(base32Input: string): Uint8Array {
  const cleaned = base32Input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error("TOTP_INVALID_BASE32_SECRET");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/**
 * Hache un mot de passe en WebCrypto natif (PBKDF2-HMAC-SHA512, 100 000 itérations + sel 16o + Pepper Secrets Store)
 */
export async function hashPasswordWorkerSafe(
  plainPassword: string,
  serverPepper: string,
  providedSaltHex?: string
): Promise<string> {
  if (plainPassword.length < 12 || plainPassword.length > 128) {
    throw new Error("AUTH_PASSWORD_LENGTH_POLICY: Le mot de passe doit contenir entre 12 et 128 caractères.");
  }
  const saltBytes = providedSaltHex
    ? new Uint8Array(providedSaltHex.match(/.{1,2}/g)?.map((b) => Number.parseInt(b, 16)) ?? [])
    : crypto.getRandomValues(new Uint8Array(16));

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${plainPassword}\u0000${serverPepper}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-512" },
    keyMaterial,
    256
  );

  const saltHex = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2_sha512$100000$${saltHex}$${hashHex}`;
}

/**
 * Vérifie un code 2FA TOTP à 6 chiffres (RFC 6238) avec tolérance +-1 fenêtre de 30s et protection anti-rejeu
 */
export async function verifyTotpCodeRfc6238(params: {
  readonly base32Secret: string;
  readonly sixDigitCode: string;
  readonly nowEpochSec: number;
  readonly lastUsedStep: number | null;
}): Promise<{ readonly valid: boolean; readonly matchedStep?: number }> {
  if (!/^\d{6}$/.test(params.sixDigitCode)) {
    return { valid: false };
  }

  const secretBytes = decodeBase32(params.base32Secret);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const currentStep = Math.floor(params.nowEpochSec / 30);

  for (const offset of [0, -1, 1]) {
    const candidateStep = currentStep + offset;
    if (params.lastUsedStep !== null && candidateStep <= params.lastUsedStep) {
      continue; // Interdit strictement le rejeu d'un code déjà consommé
    }

    const counterBuf = new ArrayBuffer(8);
    const view = new DataView(counterBuf);
    view.setUint32(0, Math.floor(candidateStep / 0x100000000), false);
    view.setUint32(4, candidateStep >>> 0, false);

    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, counterBuf));
    const dynOffset = (digest[19] ?? 0) & 0x0f;
    const binaryCode =
      (((digest[dynOffset] ?? 0) & 0x7f) << 24) |
      (((digest[dynOffset + 1] ?? 0) & 0xff) << 16) |
      (((digest[dynOffset + 2] ?? 0) & 0xff) << 8) |
      ((digest[dynOffset + 3] ?? 0) & 0xff);

    const expectedOtp = String(binaryCode % 1000000).padStart(6, "0");
    if (expectedOtp === params.sixDigitCode) {
      return { valid: true, matchedStep: candidateStep };
    }
  }

  return { valid: false };
}
```

### Annexe historique de la Section 02 (version initiale, remplacée)
> **Erratum (2026-11-13)** — Cette version initiale est remplacée par la Section 02 ci-dessus. Restent valables : Passkeys WebAuthn + extension PRF (mode E2EE), sessions JWT EdDSA 15 min + jeton de rafraîchissement rotatif, appairage POS et PIN local 6 chiffres. Est abandonné : Argon2id (non disponible dans WebCrypto des Workers), remplacé par PBKDF2-HMAC-SHA512 100 000 itérations + pepper.

L'inscription et la connexion concilient rapidité mobile pour les commerçants et résistance cryptographique contre l'hameçonnage pour les cabinets et directions financières.
- Vérification téléphonique Infobip (+212 et international) : À l'inscription, un code OTP à 6 chiffres (valable 10 minutes, limité à 5 tentatives) part via Infobip sur WhatsApp Business. Sans accusé de remise opérateur sous 15 secondes, Infobip déclenche automatiquement un SMS de secours avec l'expéditeur alphanumérique FISCA, complété en dernier recours par Amazon SES.
- Passkeys WebAuthn & Extension Cryptographique PRF : Fisca privilégie les clés d'accès FIDO2 / WebAuthn (FaceID, TouchID, Windows Hello). En mode Zero-Knowledge E2EE, l'extension standard WebAuthn PRF dérive localement dans le navigateur la clé déverrouillant le coffre du dossier sans qu'aucun mot de passe maître ne quitte l'appareil.
- Repli Mot de Passe + MFA Obligatoire : Lorsque l'appareil ne supporte pas les Passkeys, le mot de passe est haché avec Argon2id (mémoire 64 Mo, 3 itérations) et obligatoirement doublé d'un second facteur TOTP ou OTP Infobip pour tout rôle comptable, fiduciaire ou financier.
- Gestion des sessions et détection de vol : L'API émet un jeton d'accès JWT signé EdDSA d'une durée de 15 minutes et un jeton de rafraîchissement rotatif en cookie HttpOnly, Secure, SameSite=Strict. Toute tentative de réutilisation d'un ancien jeton de rafraîchissement invalide instantanément toute la chaîne de sessions de l'utilisateur.
- Session Caisse Fisca POS Hors-Ligne : Une tablette Fisca POS est appairée une première fois par un OWNER_GERANT via un certificat matériel lié à son terminal_id. En service quotidien (même sans internet pendant 72 heures), chaque caissier bascule sur sa session en tapant son code PIN local à 6 chiffres vérifié hors-ligne avec verrouillage temporaire après 3 échecs.

## Section 03 — Vérification d'Identité Entreprise (KYB Maroc & SIMT)
Pour interdire qu'un tiers malveillant n'ouvre un compte avec l'ICE public d'une autre entreprise marocaine afin d'émettre de fausses factures ou de détourner des flux, l'activation suit trois paliers KYB cumulatifs :

| Palier KYB | Moment Déclencheur | Preuves Vérifiées | Droits Déverrouillés |
|---|---|---|---|
| KYB-1 Sandbox | Création du compte (90s) | OTP Infobip + clé Modulo 97 ICE | Mode essai 14 jours filigrané |
| KYB-2 Fiscal | Activation Clearance xHub | RC Modèle J + CIN + OID Barid eSign | Émission officielle UBL / Factur-X |
| KYB-3 Bancaire | Activation Payzone / FactorFlow | RIB 24 chiffres + micro-virement SIMT | Encaissement en ligne & Escompte 48h |

- Inspection forensique des justificatifs KYB-2 : Le pipeline inspecte la structure binaire du PDF du Registre de Commerce (Modèle J) et de l'attestation fiscale pour rejeter tout fichier modifié par un éditeur graphique, puis vérifie que l'attribut OID 2.5.4.97 ou 2.5.4.5 du certificat Barid eSign contient exactement l'ICE ou l'IF du dossier.
- Validation bancaire SIMT (KYB-3) : Le contrôleur vérifie la clé Modulo 97 du RIB marocain à 24 chiffres et valide la concordance du titulaire via relevé bancaire certifié ou code aléatoire à 6 caractères transmis sur un micro-virement SIMT avant d'autoriser FactorFlow.
## Section 04 — SSO Grands Comptes (SAML 2.0 / OIDC) & Marque Blanche
Les grandes entreprises et les cabinets comptables disposent de mécanismes dédiés d'intégration d'annuaire et d'isolation de domaine :
- Fédération SAML 2.0 & OIDC (ENT_CORPORATE & ENT_SOUVERAIN) : Connexion directe aux fournisseurs d'identité d'entreprise (Microsoft Entra ID, Google Workspace, Okta, Keycloak local) avec correspondance déclarative entre groupes AD et rôles Fisca.
- Synchronisation et révocation SCIM 2.0 : Lorsqu'un collaborateur quitte une grande entreprise ou un cabinet, la requête PATCH /scim/v2/Users coupe en moins de 5 secondes ses sessions actives et révoque ses enveloppes tenant_key_grants.
- Cloisonnement des domaines Fiduciaires : Sur un domaine personnalisé servi par Cloudflare for SaaS (compta.moncabinet.ma), le portail n'autorise l'authentification qu'aux collaborateurs du cabinet et aux gérants des sociétés clientes rattachées à ce cabinet, tout en verrouillant l'interface sur les 3 langues institutionnelles (fr, ar, en).
## Section 05 — Catalogue des 12 Rôles Canoniques
Le modèle d'autorisation unifie 9 rôles humains et 3 acteurs techniques sans aucun chevauchement ambigu :
- Dirigeant PME (OWNER_GERANT) : Propriétaire légal du dossier société, détient la clé maître OWNER_ADMIN, signe les factures et gère le mandat de son expert-comptable.
- Gestionnaire Facturation (COMMERCIAL_FACTURATION) : Crée les devis, commandes clients, factures brouillons et relances commerciales sans pouvoir modifier le RIB ni clôturer la comptabilité.
- Caissier Point de Vente (CAISSIER_POS) : Opère uniquement sur Fisca POS Tactile pour encaisser au comptoir, gérer les retours référencés et saisir son comptage aveugle de fin de poste.
- Acheteur (ACHATS_BUYER) : Crée les fiches fournisseurs (hors validation finale de RIB), émet les Bons de Commande et charge les contrats BPU dans le LLM Wiki.
- Magasinier / Chef de Chantier (MAGASINIER_BL) : Valide quantitativement et qualitativement les Bons de Livraison et attachements BTP pour nourrir le rapprochement tripartite.
- DAF / Trésorier (DAF_TRESORIER) : Co-valide les changements de RIB fournisseurs, approuve les bons à payer élevés, signe les virements ISO 20022 pain.001 et pilote FactorFlow.
- Aide-Comptable (AIDE_COMPTABLE) : Traite la boîte de réception IA, prépare l'imputation PCGE et le lettrage bancaire au statut DRAFT sur son portefeuille de dossiers assignés.
- Chef de Mission (CHEF_MISSION) : Supervise une équipe d'aides-comptables, examine les fiches d'exception IA et appose le visa REVISEE_CYCLE sur les 5 cycles de révision.
- Expert-Comptable Signataire (EXPERT_COMPTABLE_OEC) : Associé inscrit à l'OEC habilité à sceller les écritures en POSTED, clôturer les exercices et valider les liasses EDI SIMPL.
- Auditeur CAC / Vérificateur DGI (AUDITEUR_CAC_DGI) : Accès temporaire strictement en lecture seule aux journaux validés, pièces R2, preuves de Merkle et exports FEC-MA / SAF-T.
- Connecteur ERP (ERP_CONNECTOR_AGENT) : Identité machine mTLS ou HMAC dédiée à la synchronisation d'un seul dossier Odoo, Sage 100 ou Apache Camel.
- Acteur IA & MCP (AI_MCP_ACTOR) : Identité restreinte des 11 agents internes et clients MCP, limitée à la lecture certifiée et au dépôt de propositions brouillons.
## Section 06 — Matrice RBAC par Domaine Métier
Les deux tableaux ci-dessous synthétisent les permissions maximales accordées à chaque famille de rôles avant filtrage par les règles contextuelles ABAC et SoD.
### A. Opérations Commerciales, POS, Achats & Trésorerie

| Ressource & Action | Gérant PME | Caissier POS | Achats / BL | DAF Groupe | Agent IA / MCP |
|---|---|---|---|---|---|
| Émettre & Certifier xHub | Lecture + Signe | Conversion QR | Aucun | Lecture + Signe | Brouillon seul |
| Encaisser Ticket POS & Z | Complet + Écart | Vente + Aveugle | Aucun | Lecture | Lecture seule |
| Créer BC / Valider BL | Complet (TPE) | Aucun | Séparé SoD-01 | Lecture + Audit | Rapprochement |
| Approuver Changement RIB | Complet + MFA | Aucun | Proposition | Co-visa SoD-02 | Alerte seule |
| Signer Virement pain.001 | Complet + MFA | Aucun | Aucun | Signe SoD-03 | Interdit |

- Isolation du rôle Caissier : Le profil CAISSIER_POS n'a aucun accès au Grand Livre, aux marges d'achat ni aux relevés bancaires de la société.
- Interdiction financière absolue côté IA : L'acteur AI_MCP_ACTOR ne possède aucune permission sur la validation d'un RIB, la signature Loi 43-20 ou l'émission d'un fichier pain.001.
### B. Comptabilité CGNC, Fiscalité SIMPL, Paie 9421 & Coffre E2EE

| Ressource & Action | Aide-Comptable | Chef Mission | Expert OEC | Auditeur CAC/DGI | Gérant PME |
|---|---|---|---|---|---|
| Écritures Statut DRAFT | Crée + Modifie | Crée + Modifie | Complet | Lecture Post-Clôture | Lecture |
| Visa des 5 Cycles | Soumet | Appose Visa | Appose + Scelle | Lecture Preuves | Lecture |
| Scellement POSTED & Clôture | Interdit | Pré-contrôle | Autorisé | Interdit | Autorisé (Direct) |
| Exports EDI SIMPL & FEC | Prépare brouillon | Vérifie XSD | Valide archive | Télécharge FEC | Valide (Direct) |
| Paie 9421 & Mandats E2EE | Si attribut PII | Si attribut PII | Selon mandat | Si contrôle 9421 | Gère clés & Révoc. |

- Étanchéité du scellement comptable : Ni l'aide-comptable ni le chef de mission ne peuvent basculer seuls une pièce au statut irréversible POSTED dans un dossier géré par un cabinet OEC.
## Section 07 — Règles ABAC Contextuelles & Step-Up Authentication
Après vérification du rôle RBAC, le moteur évalue six attributs contextuels obligatoires avant d'autoriser l'exécution :
- Assignation nominative de portefeuille : Dans une fiduciaire comptant 150 sociétés, un AIDE_COMPTABLE ou CHEF_MISSION ne peut ouvrir que les bases TENANT_DB présentes dans sa liste d'affectation active.
- Habilitation spéciale Paie & Données Sensibles (can_access_payroll_pii) : La lecture et la génération de l'État 9421 (salaires, numéros de CIN, CNSS, situation familiale) sont refusées par défaut même aux comptables du dossier tant que cet attribut n'est pas activé pour eux.
- Authentification renforcée fraîche (Step-Up Auth moins de 5 minutes) : Toute action critique (signature d'un lot pain.001, approbation d'un nouveau RIB, révocation d'un cabinet OEC, export intégral déchiffré ou activation d'un jeton SAD Barid eSign Loi 43-20) exige une preuve WebAuthn ou OTP Infobip validée depuis moins de 300 secondes.
- Verrou temporel d'exercice (fiscal_year.status) : Toute création ou modification d'écriture sur un exercice au statut CLOSED est rejetée quel que soit le rôle.
- Sanctuarisation légale en cas d'impayé (RESTRICTED_READ_ONLY) : Au-delà de 14 jours de grâce d'abonnement, toutes les actions de mutation sont bloquées, mais les actions READ et l'export décennal Art. 211 CGI restent systématiquement ouverts.
## Section 08 — Séparation des Tâches (SoD Grands Comptes & Anti-Fraude)
Pour répondre aux exigences d'audit interne des ETI, banques et filiales de groupes (ENT_CORPORATE et ENT_SOUVERAIN), quatre règles de contrôle mutuel (Maker-Checker) sont gravées dans la base de données :
- SoD-01 — Incompatibilité Commande / Réception / Facture : Dans le rapprochement tripartite (3-Way Matching), l'identifiant utilisateur ayant émis le Bon de Commande (ACHATS_BUYER) doit être différent de celui qui valide le Bon de Réception (MAGASINIER_BL) et de celui qui approuve l'écart éventuel.
- SoD-02 — Double Signature sur Changement de RIB Fournisseur : Dès que l'OCR ou un utilisateur renseigne un RIB à 24 chiffres différent du rib_24_verified enregistré, la fiche bascule en ALERTE_RIB_DAF. Deux utilisateurs distincts (updated_by_user_id != approved_by_user_id), dont au moins un DAF_TRESORIER avec Step-Up MFA frais, doivent valider le justificatif bancaire avant de débloquer tout paiement.
- SoD-03 — Préparation vs Signature des Virements ISO 20022 : L'utilisateur qui assemble un lot de règlement pain.001.001.03 ne peut jamais être l'approbateur final qui scelle le fichier XML destiné au portail bancaire.
- SoD-04 — Comptage Aveugle en Caisse POS : Lors de la fermeture d'une session Fisca POS, l'API masque expected_closing_cash_cents au CAISSIER_POS jusqu'à validation irrévocable de son comptage physique ; tout écart dépassant le seuil paramétré requiert le code d'approbation d'un superviseur.
- Exception cadrée pour les TPE mono-utilisateur : Sur les forfaits SOLO_AE et ESSENTIEL_TPE ne comptant qu'un seul dirigeant actif, le moteur autorise l'auto-approbation après confirmation Step-Up OTP/Passkey et inscrit le marqueur SINGLE_OWNER_SOD_WAIVER dans la piste d'audit.
## Section 09 — Workflow Hiérarchique OEC & Délégation E2EE Révocable
La collaboration entre une PME et son cabinet d'expertise comptable marocain respecte à la fois la hiérarchie interne du cabinet et la souveraineté cryptographique du client :
- Circuit de révision à 3 niveaux par cycles : Les écritures préparées par les agents IA (IA_PROPOSITION) sont vérifiées par l'Aide-Comptable (DRAFT), contrôlées et visées cycle par cycle (TRESORERIE, ACHATS, VENTES, PAIE_SOCIAL, FISCAL) par le Chef de Mission (REVISEE_CYCLE), puis scellées définitivement en POSTED par l'Expert-Comptable Signataire avant génération de la liasse SIMPL-IS.
- Mandat E2EE sans partage de mot de passe : Lorsque le OWNER_GERANT invite un cabinet OEC sur son dossier, son navigateur enveloppe la clé symétrique Tenant_DEK et la clé d'index aveugle Tenant_BIDX_Key avec la clé publique RSA-OAEP-256 du cabinet dans la table tenant_key_grants (grantee_role = EXTERNAL_CPA).
- Révocation instantanée en cas de changement de fiduciaire : Si la PME change d'expert-comptable, le gérant clique sur Révoquer le mandat ; la colonne revoked_at est renseignée immédiatement, bloquant à la milliseconde suivante toute requête API et tout déchiffrement par l'ancien cabinet sans avoir à rechiffrer les archives décennales stockées dans Cloudflare R2.
## Section 10 — Gouvernance des Accès Machines, MCP & Séquestre Art. 211 CGI
Les identités non-humaines et les réquisitions légales obéissent à des garde-fous dédiés :
- Isolation des jetons MCP et Agents IA : Chaque session sur mcp.fisca.ma/mcp utilise un jeton OAuth 2.1 + PKCE lié à un utilisateur et un dossier précis. Les schémas d'outils interdisent tout argument tenant_id ; une action de type brouillon exige la portée mcp:draft, tandis qu'aucune portée n'existe pour sceller le Grand Livre ou transférer des fonds.
- Clés d'agents ERP à périmètre unique : Le certificat client mTLS du service Windows Sage100EdgeAgent et le secret HMAC du module Odoo l10n_ma_edi_clearance ne donnent accès qu'aux deux endpoints de synchronisation d'une seule société et tournent tous les 12 mois sans coupure.
- Procédure de Séquestre Réglementaire (DGI_AUDIT_ESCROW — Shamir 2-sur-3) : Sur les dossiers en mode Zero-Knowledge E2EE, lors d'un contrôle fiscal au titre de l'Article 211 du CGI où le dirigeant serait décédé ou injoignable, la clé de secours découpée via le Partage de Secret de Shamir exige la réunion cryptographique d'au moins 2 parts sur 3 (1 part détenue par le mandataire désigné par le client / OEC, 1 part en HSM froid SYNAPTIC SYSTEMS, 1 part tiers de confiance / séquestre légal) pour restituer le FEC-MA déchiffré avec procès-verbal horodaté.
## Section 11 — Code de Référence : Moteur RBAC, ABAC & SoD
Ce module TypeScript pur sans aucun type any (packages/auth-rbac/src/policy-engine.ts) s'exécute dans le middleware Hono avant toute mutation métier :

```ts
import { z } from "zod";

export const RoleCodeSchema = z.enum([
  "OWNER_GERANT",
  "COMMERCIAL_FACTURATION",
  "CAISSIER_POS",
  "ACHATS_BUYER",
  "MAGASINIER_BL",
  "DAF_TRESORIER",
  "AIDE_COMPTABLE",
  "CHEF_MISSION",
  "EXPERT_COMPTABLE_OEC",
  "AUDITEUR_CAC_DGI",
  "ERP_CONNECTOR_AGENT",
  "AI_MCP_ACTOR",
]);
export type RoleCode = z.infer<typeof RoleCodeSchema>;

export const PermissionActionSchema = z.enum([
  "INVOICE_CREATE_DRAFT",
  "INVOICE_CERTIFY_XHUB",
  "POS_ENCASH_TICKET",
  "POS_VIEW_EXPECTED_CASH",
  "PO_CREATE",
  "BL_CONFIRM_RECEIPT",
  "PARTNER_PROPOSE_RIB_CHANGE",
  "PARTNER_APPROVE_RIB_CHANGE",
  "PAYMENT_PREPARE_PAIN001",
  "PAYMENT_SIGN_PAIN001",
  "LEDGER_SAVE_DRAFT",
  "LEDGER_VISA_CYCLE",
  "LEDGER_POST_IMMUTABLE",
  "PAYROLL_9421_READ_EXPORT",
  "REVERSIBILITY_EXPORT_10Y",
  "E2EE_REVOKE_CPA_GRANT",
]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionAction[]>> = {
  OWNER_GERANT: [
    "INVOICE_CREATE_DRAFT", "INVOICE_CERTIFY_XHUB", "POS_ENCASH_TICKET", "POS_VIEW_EXPECTED_CASH",
    "PO_CREATE", "BL_CONFIRM_RECEIPT", "PARTNER_PROPOSE_RIB_CHANGE", "PARTNER_APPROVE_RIB_CHANGE",
    "PAYMENT_PREPARE_PAIN001", "PAYMENT_SIGN_PAIN001", "LEDGER_SAVE_DRAFT", "LEDGER_POST_IMMUTABLE",
    "PAYROLL_9421_READ_EXPORT", "REVERSIBILITY_EXPORT_10Y", "E2EE_REVOKE_CPA_GRANT",
  ],
  COMMERCIAL_FACTURATION: ["INVOICE_CREATE_DRAFT", "INVOICE_CERTIFY_XHUB"],
  CAISSIER_POS: ["POS_ENCASH_TICKET"], // POS_VIEW_EXPECTED_CASH volontairement absent (comptage aveugle)
  ACHATS_BUYER: ["PO_CREATE", "PARTNER_PROPOSE_RIB_CHANGE"],
  MAGASINIER_BL: ["BL_CONFIRM_RECEIPT"],
  DAF_TRESORIER: [
    "INVOICE_CREATE_DRAFT", "INVOICE_CERTIFY_XHUB", "POS_VIEW_EXPECTED_CASH",
    "PARTNER_APPROVE_RIB_CHANGE", "PAYMENT_PREPARE_PAIN001", "PAYMENT_SIGN_PAIN001",
    "PAYROLL_9421_READ_EXPORT", "REVERSIBILITY_EXPORT_10Y",
  ],
  AIDE_COMPTABLE: ["INVOICE_CREATE_DRAFT", "LEDGER_SAVE_DRAFT"],
  CHEF_MISSION: ["LEDGER_SAVE_DRAFT", "LEDGER_VISA_CYCLE"],
  EXPERT_COMPTABLE_OEC: [
    "LEDGER_SAVE_DRAFT", "LEDGER_VISA_CYCLE", "LEDGER_POST_IMMUTABLE",
    "PAYROLL_9421_READ_EXPORT", "REVERSIBILITY_EXPORT_10Y",
  ],
  AUDITEUR_CAC_DGI: ["REVERSIBILITY_EXPORT_10Y"],
  ERP_CONNECTOR_AGENT: ["INVOICE_CREATE_DRAFT", "LEDGER_SAVE_DRAFT"],
  AI_MCP_ACTOR: ["INVOICE_CREATE_DRAFT"], // Aucune mutation définitive ni financière autorisée
};

const STEP_UP_MFA_ACTIONS: ReadonlySet<PermissionAction> = new Set([
  "INVOICE_CERTIFY_XHUB",
  "PARTNER_APPROVE_RIB_CHANGE",
  "PAYMENT_SIGN_PAIN001",
  "LEDGER_POST_IMMUTABLE",
  "E2EE_REVOKE_CPA_GRANT",
]);

export interface AuthorizationContext {
  readonly actorId: string;
  readonly role: RoleCode;
  readonly companyId: string;
  readonly assignedCompanyIds: readonly string[];
  readonly orgPlanSegment: "DIRECT_PME" | "FIDUCIAIRE" | "ENTERPRISE";
  readonly activeHumanMembersCount: number;
  readonly subscriptionReadOnly: boolean;
  readonly fiscalYearClosed: boolean;
  readonly canAccessPayrollPii: boolean;
  readonly lastStepUpMfaEpochSec?: number;
  readonly nowEpochSec: number;
  readonly sodMakerActorId?: string; // Renseigné pour SoD-01, SoD-02 et SoD-03
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly denialCode?: string;
  readonly auditFlags: readonly string[];
}

export function evaluateAccessPolicy(
  action: PermissionAction,
  ctx: AuthorizationContext
): PolicyDecision {
  const auditFlags: string[] = [];

  // 1. Vérification d'appartenance au dossier (ABAC Portefeuille)
  if (!ctx.assignedCompanyIds.includes(ctx.companyId)) {
    return { allowed: false, denialCode: "ABAC_TENANT_OUT_OF_SCOPE", auditFlags };
  }

  // 2. Sanctuarisation Art. 211 CGI en cas d'impayé J+15 (seul l'export légal 10 ans passe en mutation/export)
  if (ctx.subscriptionReadOnly && action !== "REVERSIBILITY_EXPORT_10Y") {
    return { allowed: false, denialCode: "ABAC_SUBSCRIPTION_READ_ONLY", auditFlags };
  }

  // 3. Contrôle RBAC de base
  const allowedForRole = ROLE_PERMISSIONS[ctx.role];
  if (!allowedForRole.includes(action)) {
    return { allowed: false, denialCode: `RBAC_FORBIDDEN_FOR_${ctx.role}`, auditFlags };
  }

  // 4. Cloisonnement strict des données personnelles de Paie État 9421 (Loi 09-08 CNDP)
  if (action === "PAYROLL_9421_READ_EXPORT" && !ctx.canAccessPayrollPii) {
    return { allowed: false, denialCode: "ABAC_PAYROLL_PII_CLEARANCE_MISSING", auditFlags };
  }

  // 5. Verrou d'exercice comptable clôturé
  if (
    ctx.fiscalYearClosed &&
    (action === "LEDGER_SAVE_DRAFT" || action === "LEDGER_VISA_CYCLE" || action === "LEDGER_POST_IMMUTABLE")
  ) {
    return { allowed: false, denialCode: "ABAC_FISCAL_YEAR_CLOSED", auditFlags };
  }

  // 6. Contrôle d'authentification forte fraîche (< 300 secondes) sur actions sensibles
  if (STEP_UP_MFA_ACTIONS.has(action)) {
    const ageSec =
      ctx.lastStepUpMfaEpochSec !== undefined
        ? ctx.nowEpochSec - ctx.lastStepUpMfaEpochSec
        : Number.POSITIVE_INFINITY;
    if (ageSec < 0 || ageSec > 300) {
      return { allowed: false, denialCode: "ABAC_STEP_UP_MFA_REQUIRED", auditFlags };
    }
  }

  // 7. Contrôle de Séparation des Tâches (SoD-01 BL, SoD-02 RIB, SoD-03 Virement pain.001)
  const isSodGuardedAction =
    action === "BL_CONFIRM_RECEIPT" ||
    action === "PARTNER_APPROVE_RIB_CHANGE" ||
    action === "PAYMENT_SIGN_PAIN001";

  if (isSodGuardedAction && ctx.sodMakerActorId !== undefined && ctx.sodMakerActorId === ctx.actorId) {
    const canWaiveForSoloTpe =
      ctx.orgPlanSegment === "DIRECT_PME" &&
      ctx.activeHumanMembersCount === 1 &&
      ctx.role === "OWNER_GERANT";

    if (!canWaiveForSoloTpe) {
      return { allowed: false, denialCode: "SOD_DUAL_CONTROL_VIOLATION", auditFlags };
    }
    auditFlags.push("SINGLE_OWNER_SOD_WAIVER");
  }

  return { allowed: true, auditFlags };
}
```

## Section 12 — Harnais de Vérification Sécuritaire (Rubric R2 & Tests QA)
Lors de la Session S1A et des Barrières QA G1 et G4, l'agent Fisca-QA-Security-Auditor exécute six tests d'intrusion automatisés dont l'échec bloque immédiatement toute fusion sur main :
- Test Anti-IDOR Inter-Sociétés : Un jeton valide d'un AIDE_COMPTABLE envoyé avec l'en-tête X-Fisca-Company-Id d'une société non attribuée reçoit systématiquement 403 ABAC_TENANT_OUT_OF_SCOPE sans fuite d'existence.
- Test SoD Anti-Fraude RIB : Un DAF_TRESORIER dans une organisation ENTERPRISE qui tente d'approuver un changement de RIB 24 chiffres qu'il a lui-même saisi (sodMakerActorId === actorId) est bloqué par SOD_DUAL_CONTROL_VIOLATION.
- Test Immuabilité & Hiérarchie OEC : Toute tentative d'appeler LEDGER_POST_IMMUTABLE avec un rôle AIDE_COMPTABLE, CHEF_MISSION ou AI_MCP_ACTOR échoue à 100 %.
- Test Cloisonnement CNDP État 9421 : Un EXPERT_COMPTABLE_OEC dont le drapeau canAccessPayrollPii vaut faux se voit refuser la lecture de payroll_annual_subledger.
- Test Révocation Cryptographique Instantanée : À la milliseconde où OWNER_GERANT exécute E2EE_REVOKE_CPA_GRANT, la requête suivante du cabinet portant l'ancien mandat échoue à déverrouiller tenant_key_grants.
- Test Comptage Aveugle POS & Bascule OTP Infobip : Vérifie qu'un CAISSIER_POS ne reçoit jamais expected_closing_cash_cents dans la réponse JSON de session ouverte, et simule un non-accusé WhatsApp de 15 secondes déclenchant l'appel de secours SMS expéditeur FISCA.
