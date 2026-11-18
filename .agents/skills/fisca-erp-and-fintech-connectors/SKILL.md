---
name: fisca-erp-and-fintech-connectors
description: Intégration des connecteurs Fisca : Sage 100, Odoo, facturation au dossier fiduciaire, Payzone, Infobip, Amazon SES, FactorFlow Maroc (Loi 103-12). À utiliser pour ERP, OTP WhatsApp/SMS, collecte e-mail, prorata fiduciaire, affacturage.
---

# fisca-erp-and-fintech-connectors

Méthode d'intégration des connecteurs ERP, de la monétisation, des services tiers et de l'affacturage de Fisca.

## 1. Sage 100 & Odoo

- Dans `Sage100EdgeAgent` (C# .NET 8), lire SQL Server avec `WITH (NOLOCK)` mais interdire tout INSERT/UPDATE SQL direct ; écrire exclusivement via `Objets100cLib` (`IPMEncoder`) ou export `.PNM` à 108 caractères fixes.
- Pour Odoo (v17–v20), surcharger `account.edi.format` et `account.partial.reconcile`.

## 2. Monétisation & Services Tiers

- Implémenter le compteur fiduciaire par dossier actif inspiré de Kill Bill (Socle 490 MAD + 69 / 149 / 249 MAD par client avec prorata journalier et remise -15 % dès 100 dossiers) branché sur Payzone.
- Router les OTP via Infobip (WhatsApp Business puis bascule SMS expéditeur FISCA après 15s).
- Router la collecte email `@ingest.fisca.ma` via Cloudflare Email Routing + Amazon SES.

## 3. FactorFlow Maroc (Loi 103-12 BAM)

Verrouiller (`xhub_uuid` + `sha256`) dans le registre anti-double mobilisation D1, calculer l'escompte prorata temporis type Apache Fineract et générer l'avoir UBL 381, sans jamais prêter sur le bilan de SYNAPTIC SYSTEMS.



## Mise à jour du 2026-11-15 : préparation des sessions P3-C et P4-B (prime sur ce qui précède)

- **Rien n'est encore construit** (`packages/external-integrations`, `connectors/*`, `containers/camel-bridge`, `packages/billing-metering`, `packages/factorflow` : squelettes). P3-C : voie EDI-2, branche `feat/w3-erp-third-party` ; P4-B : voie BACK-1, branche `feat/w4-billing-factor-pra`. Lire `docs/orchestration/preparation-vague-3.md` § 5 et `preparation-vague-4.md` § 4.
- **Fournisseurs tiers** (Infobip, WhatsApp, Amazon SES, Payzone, DirectInfo OMPIC, Google OAuth) : aucun compte réel ; tout est simulé hors ligne (Doc_17 § 12) avec des ports et des doubles ; aucune clé dans le dépôt ; webhooks vérifiés par `verifySignedWebhookPayload` (tolérance de 300 s) ; Payzone : deux circuits (MIT 3DS2 et BYO-MID, Loi 103-12).
- **Odoo** : les routes `/api/v1/erp/odoo/*` sont construites en T-P3C-08, après le module (T-P3C-06) : définir les contrats (CTR-API-23 à 28) dès le début et tester contre un serveur double ; HMAC `X-SaaS-Signature` (HMAC-SHA256 du corps JSON trié) ; Odoo n'est pas installable dans le bac à sable.
- **Sage 100** : lecture `WITH (NOLOCK)` par table (garde SQL, PR n° 8) ; `Objets100cLib` derrière `ISageWriter` dans un projet `net8.0-windows` exclu de la solution Linux (B-14) ; `.PNM` de 108 caractères, montant sur les positions 85 à 104, `N` en 105, somme des débits égale à celle des crédits par pièce (D-22).
- **Camel et OData BI** : « vues analytiques agrégées » non spécifiées (défaut : vues de balance et de TVA en lecture seule, provisoires) ; SAP, Oracle, Sage X3 absents : tests sur doubles ; image non construisible (pas de Docker).
- **Facturation (P4-B)** : prorata journalier avec plancher d'un jour, sans mois minimum (D-23) ; tables d'entitlements de Doc_03 § 10 absentes (périmètre de db-schema à étendre) ; FactorFlow reste une mise en relation (subrogation conventionnelle) : jamais d'encaissement pour compte de tiers ni de crédit sur bilan propre (loi 103-12).
