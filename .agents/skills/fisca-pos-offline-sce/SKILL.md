---
name: fisca-pos-offline-sce
description: Règles de construction de Fisca POS, caisse tactile hors-ligne (apps/pos-pwa) : SQLite WASM/OPFS, séquence par terminal, chaînage SHA-256, signature ECDSA P-256, comptage aveugle, Ticket Z, conversion QR B2C vers facture B2B sans double imposition.
---

# fisca-pos-offline-sce — caisse Fisca POS hors-ligne

Cinquième pilier du produit (Doc 01 § 13). Sources : `01-prd.md` § 13, `02-state-machines.md` § 13 (FSM 10), `04-tdd-architecture.md` § 05, `06-erd-data-lifecycle.md` § 04, `07-api-edi-contracts.md` § 03, `08-design-system-i18n.md` § 06, `09-auth-rbac-sod.md` § 02 et § 08, `10-stride-crypto.md` § 08, `14-qa-harness.md` § 06. Sessions : S1B (schéma), P2-A (routes de synchronisation et de conversion), P2-B (`apps/pos-pwa`), G2 (audit, rubric R3).

## 1. Autonomie de 72 heures

- React 19 et Service Worker ; base SQLite WASM persistée sur OPFS (catalogue, prix, taxes, file d'envoi). Aucune dépendance au réseau pour encaisser ; objectif d'encaissement sous 100 ms.
- Chaque terminal reçoit à l'activation un préfixe exclusif. Numéro de ticket : `POS-{MAG}-{TERM}-{AAAA}-{séquence}` (exemple `POS-M01-C02-2026-000841`). Trois tablettes hors ligne ne produisent aucune collision.
- Chaque ticket porte `prev_ticket_sha256` et `ticket_sha256` : la chaîne est continue par terminal et vérifiée par le serveur à la synchronisation.
- Synchronisation : `POST /api/v1/pos/sync-batch`, idempotente, par lots de 200 tickets au plus.

## 2. Inviolabilité

- À l'appairage (login complet du gérant, 2FA compris), WebCrypto crée une paire ECDSA P-256 avec `extractable: false`. Chaque ticket est signé par cette clé ; un ticket dont le SQLite local a été modifié est rejeté par le serveur.
- Les caissiers ouvrent leur session par un PIN local à 6 chiffres, vérifié hors ligne, verrouillé après 3 échecs.

## 3. Session de caisse et Ticket Z (FSM 10)

- `CAISSE_FERMEE → SESSION_OUVERTE_ACTIVE` : fond de caisse supérieur ou égal à 0.
- Toute sortie d'espèces ou remise en banque supérieure au solde théorique du tiroir (compte 5161) est refusée.
- Comptage aveugle (SoD-04) : `expected_closing_cash_cents` n'est jamais renvoyé au rôle `CAISSIER_POS` avant validation de son comptage. L'écart va en 6588 (manquant) ou 7588 (excédent) ; au-delà du seuil, code d'un superviseur.
- `CLOTURE_TICKET_Z_SCELLEE` : écriture VTE B2C ventilée par taux (20 %, 10 %, 0 %), droit de timbre de 25 bps sur la part payée en espèces, archive scellée, E-Reporting B2C du jour.
- Un retour se fait par ticket d'avoir lié (`origin_ticket_id`), jamais par suppression.

## 4. Conversion QR d'un ticket B2C en facture B2B

- Chaque ticket porte un `qr_conversion_token` unique. Route publique `POST /api/v1/public/pos-qr/:qrToken/convert-b2b`, protégée par Turnstile ; le client saisit son ICE à 15 chiffres.
- Avant la clôture Z : le ticket devient `CONVERTI_B2B_AVANT_Z`, il sort de l'assiette B2C du Ticket Z et suit le cycle de la facture xHub.
- Après la clôture Z : dans une seule transaction, création de la facture B2B et d'une écriture d'extourne B2C du même montant HT et TVA (`CONVERTI_B2B_POST_Z_NEUTRALISE`). Le chiffre d'affaires déclaré reste identique au centime.
- `UNIQUE(pos_ticket_id)` sur `invoices` : un second scan du même QR est rejeté.

## 5. Interface

- Cibles tactiles de 56 × 56 px au moins, aucun menu au survol, retour visuel sous 50 ms.
- Indicateur permanent d'état réseau et du nombre de tickets en attente de synchronisation.
- 6 langues (fr, ar, ary, zgh-Latn, zgh-Tfng, en) ; montants en `tabular-nums` dans un bloc `dir="ltr"`.
- Impression ESC/POS 58 et 80 mm par WebUSB, WebBluetooth ou passerelle IP ; ticket bilingue FR/AR avec QR ; écran cuisine KDS.
- SQLite WASM sur OPFS exige les en-têtes d'isolation `Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp`, y compris dans les tests Playwright.

## 6. Tests exigés (G2)

1. Trois terminaux hors ligne, 200 tickets chacun (TVA 20 %, 10 %, 0 % et timbre), synchronisés ensemble : aucune collision, chaîne SHA-256 valide.
2. Un centime modifié dans le SQLite local : lot rejeté pour signature invalide.
3. Clé ECDSA non extractible (`exportKey` échoue).
4. La réponse de session ne contient jamais `expected_closing_cash_cents` pour un caissier.
5. Conversion avant et après Z d'un ticket de 1 200,00 MAD TTC : chiffre d'affaires cumulé inchangé ; second scan rejeté.
6. Virement net d'un TPE ou d'une plateforme de livraison : vente brute, commission HT en 61473, TVA récupérable de 10 % en 34552.

Clauses éliminatoires de la rubric R3 : ticket perdu ou collision de séquence, clé extractible, fuite du solde attendu, acceptation d'un ticket falsifié.



## Mise à jour du 2026-11-15 : ce que les vagues 1 et 2 ont fixé

- **Empreintes** : SHA-256 de `JSON.stringify` d'un tuple versionné (`FISCA_POS_TKT_V1`, `FISCA_POS_Z_V1`) ; **amorce de chaîne = 64 zéros** (CHECK de 64 hexadécimaux, migration v4) ; genèse de 45 caractères réservée au grand livre et au PIH. Empreintes d'or : ticket `a9677d45…c7fe`, clôture Z `da7c6566…d7c2`.
- **Type de ticket** : stocké `SALE_B2C` ou `RETURN_REFUND` ; le tuple porte `SALE` ou `RETURN_REFUND` (table `POS_TICKET_KIND_TUPLE_LABEL`, `packages/ubl-xades/src/pos/hash.ts`, recopiée dans `apps/pos-pwa` avec un test de dérive) ; séquence entière dans le tuple, `{terminalId}-{9 chiffres}` en colonne.
- **Signature** : ECDSA P-256, clé non extractible (`extractable = false`), objet signé = les 64 hexadécimaux de `ticket_sha256`, `r‖s` en base64.
- **Règles arbitrées (D-23)** : le Ticket Z exclut `CONVERTI_B2B_AVANT_Z` et soustrait `RETURN_REFUND` (date UTC, fuseau paramétrable ensuite) ; extourne partielle `B2C_TO_B2B_REVERSAL` liée par `invoice_id` ; QR `https://fisca.ma/q/{token}` ; timbre 25 bps sur `paid_cash_cents` ; coupures BAM 20000 à 10 centimes ; seuil d'écart superviseur 2000 centimes ; fenêtre de 72 h décomptée seulement s'il reste un ticket non synchronisé ; appairage `POST /api/v1/pos/terminals/pair` (non construit, port `PairingGateway`).
- **Preuves** : OPFS prouvée dans Chromium (`pnpm --filter @fisca/pos-pwa test:e2e`) ; parité client et serveur et 600 tickets sur 3 terminaux (tests adverses de G2).
- **Réserve ouverte** : `expected_closing_cash_cents` est écrit en clair dans le stockage local au verrouillage du comptage (à traiter avant G4).
