---
id: cmwd2is8l005507adho5fc9t5
slug: fisca
title: Fisca
pageType: product / app
version: 3
updatedAt: 2026-11-14T23:08:19.744Z
url: https://hyperagent.com/wiki/fisca
---

# Fisca

**Résumé.** Fisca (fisca.ma) is a Moroccan tax and invoicing SaaS for small businesses, accounting firms and large accounts.

## Texte complet

Fisca (fisca.ma) is a Moroccan tax, invoicing and accounting SaaS published by SYNAPTIC SYSTEMS SARL AU, with registered office and competent Commercial Court in Rabat; the publisher is subject to 20% VAT. [1]

## Offers
Direct plans for self-employed, TPE and PME, an accounting-firm (fiduciaire) offer billed per active client, and annual large-account contracts. Prices are on [[fisca-pricing]].

## Design invariants
- All amounts are integer cents and rates are in bps; no floating-point money. [2]
- No hard-coded tax rules: everything comes from D1 tables fed by the LLM Wiki. [2]
- Each client company gets one isolated Cloudflare D1 database from the Solo plan (jurisdiction eu on R2/D1). All writes go through StorageAdapter (cloudflare mode active; standby_vps adapter ready for pre-production). [3]
- 2026 tax reform: VAT rates of 7% and 14% are abolished in 2026; only 20%, 10% and 0% remain. [4]
- Electronic signature under Loi 43-20 is done in a pure Worker with WebCrypto + CSC v2, with one RFC 3161 timestamp token per day through a Merkle tree. [4]
- Ledger immutability, hashing, mandate permissions and validators follow [[fisca-engineering-rules]]; POS rules are on [[fisca-pos-rules]]; accounts on [[fisca-chart-of-accounts]].

## Language policy
- 6 languages (fr, ar, ary Moroccan Arabic, zgh-Latn and zgh-Tfng IRCAM, en) on the Astro site and PME; zgh-Tfng stays left-to-right. [5] [6]
- 3 languages (fr, ar, en) on Fiduciaire and Corporate. [5]
- Factur-X is bilingual FR/AR; no Tamazight WhatsApp voice in V1. [5]
- Arabic fonts: IBM Plex Sans Arabic in fiscal-java PDFs and Noto Sans Arabic on the web, both validated (OFL, self-hosted). [6]
- The 20 marketing routes lacking a numeric case or primary source stay noindex, outside sitemap.xml and llms.txt. [6]

## Design system (Mercury) and UI rules
- Shared components (ui-mercury's AiCrafterCard, CommandPalette, SplitScreenReviewDrawer) take every visible string through required typed label props, with no default value and no hardcoded French fallback. [7]
- `--brand-indigo` measures only about 4.3:1 on the dark background: never use it for running text (including white text on indigo); only for icons, borders and focus rings. Text uses `--text-primary` or `--text-secondary` (at least 4.5:1). [8]
- Google sign-in on the SPA: a browser navigation gets a 302 that sets the refresh cookie and goes to `/auth/callback` (or `/auth/2fa#mfa_challenge_token=...`, in the fragment, never the query string); JSON is kept when `Accept: application/json`. [6]

## Compliance decisions
- CNDP receipt numbers stay null until delivered, with the mention that files F115, F211, F112 and F118 are being registered by SYNAPTIC SYSTEMS SARL AU. Retention: T-01 contract + 12 months; T-02 contract + 10 years after the last closed fiscal year; T-03 invoices 10 years; T-04 AI scoring cache 30 days + 12 months restricted archive (ERRATA D-23). [6]
- FEC-MA profile: 18 standard columns (JournalCode … Idevise) plus 6 Moroccan extensions (TiersIF, TiersICE, ClearanceUUID, ModePaiementDGI, EntryHashSHA256, PrevHashSHA256), labelled « Profil Fisca Art. 211 CGI en attente d'arrêté technique DGI ». [6]
- Fiduciary billing is an exact daily prorata in integer cents (activeDays/daysInMonth), no minimum month billed, floor of 1 day if activated and deactivated the same day. [6]

## Third-party providers
- Subscription payments: Payzone and SIMT bank transfer. [9]
- OTP: Infobip, WhatsApp Business first, then SMS with sender FISCA after 15 seconds. [9]
- Emails and document collection on @ingest.fisca.ma: Amazon SES and Cloudflare Email Routing. [9]

## Related
- [[fisca-pricing]]: price grids for each segment.
- [[fisca-monorepo]]: code base and stack.
- [[fisca-software-factory]]: the project building Fisca with agents.
- [[fisca-engineering-rules]]: integrity and validation rules.
- [[fisca-pos-rules]]: point-of-sale rules.
- [[fisca-chart-of-accounts]]: CGNC accounts and VAT roles.
- [[anasse-el-haji]]: owner.

## Sources

| N | Type | Nom | Identifiants |
|---|---|---|---|
| 1 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkgqr01wy06adtjh3c5jl |
| 2 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczki4t01r206ad3v3f087u |
| 3 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkhoi01kh07ad1pxs1a1h |
| 4 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkknd01ne07ad9sz5yymn |
| 5 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkk4t01x606adrgovxpwi |
| 6 | thread | Thread with Fisca-Lead-Orchestrator, started by Anasse El Haji, Nov 14 7:37 AM | threadId cmweubtfn067107ad0etaab1o, message cmwg3f35j013h07adxecnpqf8 |
| 7 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwfqsgt6018207adpcax6ilg |
| 8 | memory | Saved memory by Anasse El Haji, Nov 14 | memoryId cmwfqslq2010x07ad2sj4uip2 |
| 9 | memory | Saved memory by Anasse El Haji, Nov 12 | memoryId cmwczkjtc01x506ad8m67f5xd |
