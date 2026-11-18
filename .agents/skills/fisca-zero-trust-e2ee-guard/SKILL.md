---
name: fisca-zero-trust-e2ee-guard
description: Garde-fou sécurité Fisca. À utiliser pour toute route API, requête SQL, appel de modèle IA ou donnée personnelle : isolation D1 par société, auth Google/mot de passe, défi MFA, RBAC/ABAC/SoD, E2EE (AAD, index aveugle, Shamir), anti-injection, anonymisation avant IA.
---

# fisca-zero-trust-e2ee-guard

Garde-fou de sécurité de Fisca : toute route API, requête SQL, appel de modèle IA et manipulation de données personnelles. Sources : `docs/specs/09-auth-rbac-sod.md`, `10-stride-crypto.md`, `05-adr.md` § 14. Sessions : S1A surtout ; barrières G1, G3, G4 ; rubric R2.

## 1. Isolation par société

Une base D1 par société dès le forfait Solo, routée par `CONTROL_PLANE_DB.tenant_databases`. Le middleware authentifie, vérifie l'appartenance ou le mandat (`tenant_key_grants`), puis attache la base. L'en-tête `X-Fisca-Company-Id` ne fait que sélectionner un dossier parmi ceux de l'utilisateur. Aucun outil exposé à un LLM ou à MCP n'accepte `tenantId`, `tenant_id`, `companyId`, `company_id` ou `d1DatabaseId` : `FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema` le vérifie. Un accès hors portefeuille répond 403 `ABAC_TENANT_OUT_OF_SCOPE`, sans révéler l'existence du dossier.

## 2. Authentification

- Deux entrées : Google (OIDC, PKCE S256, `id_token` vérifié contre les JWKS, `email_verified`, liaison sur `sub`) et e-mail avec mot de passe de 12 à 128 caractères. Turnstile sur les routes publiques.
- Mot de passe : PBKDF2-HMAC-SHA512, 100 000 itérations, sel de 16 octets, pepper du Secrets Store ; format `pbkdf2_sha512$100000$<sel>$<empreinte>`. Pas d'Argon2id. Verrouillage de 15 minutes après 5 échecs.
- Second facteur : TOTP (RFC 6238, tolérance d'un pas, rejeu interdit par `last_used_totp_step`), OTP Infobip (WhatsApp, puis SMS expéditeur FISCA à 15 s), 10 codes de secours. Obligatoire pour `EXPERT_COMPTABLE_OEC`, `CHEF_MISSION`, `DAF_TRESORIER`, et pour le gérant dès la signature Loi 43-20 ou les virements.
- **Défi MFA** : avec un second facteur actif, la connexion (Google comprise) ne rend qu'un `mfa_challenge_token` de 5 minutes, sans aucun droit sur l'API métier. Le JWT complet n'est émis qu'après `/api/v1/auth/2fa/verify`. Un test automatisé doit échouer si une donnée fiscale est servie avant.
- Session : JWT EdDSA de 15 minutes, jeton de rafraîchissement rotatif en cookie `HttpOnly`, `Secure`, `SameSite=Strict` ; la réutilisation d'un ancien jeton invalide toute la chaîne. Passkeys WebAuthn, avec extension PRF en mode E2EE.
- Authentification renforcée de moins de 300 secondes pour : `INVOICE_CERTIFY_XHUB`, `PARTNER_APPROVE_RIB_CHANGE`, `PAYMENT_SIGN_PAIN001`, `LEDGER_POST_IMMUTABLE`, `E2EE_REVOKE_CPA_GRANT`.

## 3. Autorisation : RBAC, ABAC, séparation des tâches

`evaluateAccessPolicy` (`packages/auth-rbac/src/policy-engine.ts`) : 12 rôles (10 humains, plus `ERP_CONNECTOR_AGENT` et `AI_MCP_ACTOR`). Ordre des contrôles : portefeuille, abonnement en lecture seule (seul l'export décennal passe), rôle, habilitation paie (`canAccessPayrollPii`), exercice clos, authentification renforcée, séparation des tâches. SoD-01 commande, réception et facture par trois personnes ; SoD-02 changement de RIB à deux signatures dont un DAF ; SoD-03 préparation et signature du `pain.001` distinctes ; SoD-04 comptage aveugle en caisse. Dérogation `SINGLE_OWNER_SOD_WAIVER` pour un dirigeant seul en offre directe, tracée. `AI_MCP_ACTOR` ne peut que créer un brouillon : `canMutateLedgerDirectly = false` partout.

## 4. Chiffrement

- Deux modes dans `tenant_databases.crypto_mode` : `CLOUD_ASSISTED` (clés au Secrets Store) et `ZERO_KNOWLEDGE_E2EE` (clés générées chez le client, enveloppées en RSA-OAEP-256 dans `tenant_key_grants` pour `OWNER_ADMIN`, `EXTERNAL_CPA`, `ERP_CONNECTOR_AGENT`, `DGI_AUDIT_ESCROW`). Révoquer un cabinet : renseigner `revoked_at`, sans rechiffrer les archives.
- Champ `_enc` : AES-256-GCM, IV aléatoire de 12 octets, format `v1:<iv>:<chiffré>`, AAD = `companyId|tableName|recordId|columnName`. Déplacer un chiffré vers un autre enregistrement doit faire échouer le déchiffrement.
- Champ `_bidx` : HMAC-SHA256 de la valeur normalisée (majuscules, sans espace ni tiret), tronqué à 128 bits (32 caractères hexadécimaux).
- Séquestre : Shamir 2-sur-3 sur GF(256), polynôme `0x11b` ; les trois paires reconstruisent le secret, une part seule ne révèle rien.
- WebCrypto natif seulement. Une clé déchiffrée en mémoire est écrasée (`fill(0)`) dans un `finally`.

## 5. Bouclier IA

- Les extracteurs n'ont ni outil, ni réseau, ni base ; leur sortie passe par un schéma Zod strict.
- Avant tout modèle : retrait des caractères invisibles (U+E0000 à U+E007F, inversions bidirectionnelles), puis `EphemeralRamPiiScrubber` : noms connus, RIB à 24 chiffres, ICE à 15 chiffres, téléphones, e-mails, et aussi CIN, IF et CNSS (errata D-12), remplacés par des jetons, restaurés au retour, table détruite ensuite.
- Aucun agent ni outil MCP ne peut modifier un RIB vérifié, lever une alerte RIB, passer une écriture en `POSTED` ou signer un virement.

## 6. Secrets

Jamais dans Git, `wrangler.toml`, un journal ou un message. Liste et noms exacts dans `ops/state/contracts-registry.json` (nature `ENV_SECRET`). En test : valeurs factices injectées par Miniflare.

## 7. Tests exigés (R2)

Accès inter-sociétés refusé ; défi MFA étanche ; rejeu TOTP refusé ; auto-approbation d'un RIB refusée (`SOD_DUAL_CONTROL_VIOLATION`) ; permutation de chiffré refusée ; Shamir sur 100 clés ; injection de prompt dans un PDF sans effet sur le RIB ; aucune donnée personnelle réelle dans l'appel IA intercepté ; aucun secret dans l'arbre Git. Clauses éliminatoires : accès inter-sociétés, JWT complet avant le second facteur, approbation solitaire d'un RIB en Corporate, secret en clair, champ `_enc` sans AAD, agent IA capable d'écrire en `POSTED`, fuite de donnée personnelle vers un modèle.



## Mise à jour du 2026-11-15 : ce que les vagues 1 et 2 ont fixé et laissé ouvert (prime sur ce qui précède)

- **Accès** : `X-Fisca-Company-Id` au format `[A-Za-z0-9_-]{1,64}`, validé une seule fois par `assertValidCompanyId` ; il sélectionne un dossier parmi ceux de l'utilisateur, le serveur vérifie l'appartenance et le mandat (`company_cpa_mandates` du plan de contrôle, `tenant_key_grants` comme second verrou) ; jamais un argument d'outil IA ou MCP. Permissions d'un accès par mandat = intersection stricte.
- **RBAC** : `LEDGER_VISA_CYCLE` pour `OWNER_GERANT` et `DAF_TRESORIER` (arbitrage du propriétaire, Loi 9-88) ; `LEDGER_READ_PROOF` pour six rôles (gérant, DAF, aide-comptable, chef de mission, expert OEC, auditeur CAC/DGI) ; `permissionsOfRole` exporté ; accès à la paie 9421 sous l'attribut `canAccessPayrollPii` seulement ; step-up MFA de 300 s sur les actions sensibles.
- **Certificat émetteur** : `assertCertificateMatchesEmitter` lit les attributs 2.5.4.97 et 2.5.4.5, accepte `ICE`, `NTRMA-`, `ICEMA-`, `ICE:`, `ICE-` (ICE de 15 chiffres) et `VATMA-`, `IFMA-`, `IF:`, `IF-` (IF), rejette tout préfixe de pays différent de `MA` ; le CN est exclu.
- **Cryptographie** : tables GF(256) du partage de Shamir acceptées (cérémonie ponctuelle) ; coût PBKDF2 injectable seulement par la fabrique de test `@fisca/auth-rbac/testing` (production : 100 000 itérations avec `minIterations`) ; ce sous-chemin est public (réserve) ; caisse : ECDSA P-256 non extractible, comptage aveugle.
- **Limites connues, à traiter** : `EphemeralRamPiiScrubber` sur-masque les suites de 15 chiffres (biais fail-safe accepté) et doit être durci **avant P3-B** (ICE collé à une lettre, retour à la ligne, tiret bas) ; le filtre d'injection est contournable par épellation (avant P3-B) ; **avant G3** : les réponses d'idempotence (`idempotency_records`) sont stockées en base64 non chiffré ; **avant G4** : `expected_closing_cash_cents` en clair dans l'OPFS de la caisse.
- **Site** : CSP fermée par défaut (`style-src 'unsafe-inline'` en réserve), `nosniff`, `Referrer-Policy`, `Permissions-Policy` ; aucun script, cookie ni pixel tiers (un test le garantit).

## Adaptation Antigravity

- « Liste et noms exacts dans `fisca_contracts_registry` » → « dans `ops/state/contracts-registry.json` du dépôt » (table Hyperagent remplacée par fichier).
