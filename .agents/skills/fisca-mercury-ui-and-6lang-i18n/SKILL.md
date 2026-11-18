---
name: fisca-mercury-ui-and-6lang-i18n
description: Standard visuel et linguistique des interfaces Fisca : tokens Mercury clair/sombre, chiffres tabulaires LTR, densité 44/28 px, 6 langues PME et 3 langues portails B2B, CSS logique RTL, responsive. À utiliser pour tout composant UI, i18n, thème ou page web.
---

# fisca-mercury-ui-and-6lang-i18n

Standard visuel, ergonomique et linguistique de toutes les interfaces de Fisca. Source : `docs/specs/08-design-system-i18n.md` (tokens et primitives en § 11, harnais en § 12). Sessions : P2-B, P2-C, P4-A ; barrières G2 et G4 ; rubric R3. La caisse a son propre skill : `fisca-pos-offline-sce`.

## 1. Tokens, jamais de couleur brute

Les composants n'emploient que les variables de `packages/ui-mercury/src/tokens.css`. Aucune couleur hexadécimale ailleurs (le harnais la rejette).

| Token | Clair (registre) | Sombre (obsidienne) |
|---|---|---|
| `--bg-canvas` | `#FAF9F5` | `#0B0E14` |
| `--bg-surface` | `#FFFFFF` | `#121722` |
| `--bg-subtle` | `#F2EFE9` | `#181F2E` |
| `--text-primary` | `#141413` | `#F3F4F6` |
| `--text-secondary` | `#5C5A54` | `#9CA3AF` |
| `--line-border` | `#E4E1D8` | `#222B3A` |
| `--brand-emerald` | `#0F5338` | `#10B981` |
| `--brand-indigo` | `#4F46E5` | `#6366F1` |

Statuts (fond / texte) : validé `#E3F2E9` / `#0B4F32` et `#092E20` / `#34D399` ; alerte `#F8EEDB` / `#8A5300` et `#2E210B` / `#FBBF24` ; danger `#FCE8E6` / `#A51D24` et `#311114` / `#F87171`. Le thème (`light`, `dark`, `system`) est lu avant le premier rendu, sans clignotement. Contraste de 7:1 sur les montants ; aucun statut porté par la couleur seule.

## 2. Chiffres

`font-variant-numeric: tabular-nums lining-nums` sur tout montant, taux, ICE, RIB, compte PCGE et date. Chiffres occidentaux 0-9 dans les 6 langues. Tout montant, ICE, RIB, numéro de pièce ou téléphone est dans un bloc `dir="ltr"` avec `unicode-bidi: isolate`, pour que le signe moins ne s'inverse jamais en RTL. Formatage par `formatCentimesMad` : entiers seulement, séparateur de milliers espace, virgule décimale (`-1 200,00 MAD`). Polices auto-hébergées en `.woff2` : Geist, Geist Mono, Noto Sans Arabic, Noto Sans Tifinagh ; aucune police distante.

## 3. Densité et stabilité

Lignes de tableau à 44 px (dirigeant) ou 28 px (comptable, police 12,5 px), bascule persistante. TanStack Table et TanStack Virtual. Sous flux SSE, les rangées ont une hauteur réservée : décalage de mise en page (CLS) égal à 0. Palette de commande Cmd+K sous 150 ms. Tiroir d'inspection côte à côte (pièce à gauche, écriture à droite).

## 4. Garde-fous IA visibles

Une détection IA porte le badge ambre « Point à examiner », jamais « Anomalie confirmée » avant visa humain. Un montant illisible reste vide, bordure ambre, sans chiffre deviné. Le bouton final rappelle l'approbation humaine.

## 5. Langues par surface

- 6 langues sur le site Astro, l'espace Solo, TPE et PME, et la caisse : `fr`, `ar` (RTL), `ary` (Darija en alphabet arabe, RTL), `zgh-Latn`, `zgh-Tfng`, `en`.
- 3 langues strictes sur les portails Fiduciaire et Corporate (`/fiduciary`, `/enterprise`, domaines en marque blanche) : `fr`, `ar`, `en`. Une préférence `ary` y bascule sur `ar` ; `zgh-Latn` et `zgh-Tfng` sur `fr`. Logique : `resolveSafeLocaleForSurface`.
- Termes fiscaux : `ary` replie vers l'arabe officiel de la DGI suivi du sigle latin ; `zgh-Latn` vers le français du CGI ; `zgh-Tfng` vers le lexique IRCAM avec sigle latin et infobulle FR/AR (`FiscalTerm`).
- URL du site : `/fr/` (x-default), `/ar/`, `/ary/`, `/zgh/`, `/zgh-tfng/`, `/en/`, avec hreflang réciproques.
- Dictionnaires dans `packages/i18n/locales/{locale}/`, 6 espaces de noms ; la compilation échoue sur une clé manquante ou vide.
- Factur-X : toujours bilingue FR à gauche, AR à droite, double arrêté en lettres produit par deux fonctions pures.

## 6. RTL

Classes logiques seulement : `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `border-s`, `border-e`, `text-start`, `text-end`, `rounded-s`, `rounded-e`. Les classes physiques (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`) sont rejetées. Seules les icônes de direction se retournent (`rtl:-scale-x-100`).

## 7. Responsive

Mobile de 360 à 767 px (barre basse, cibles de 44 px) ; tablette caisse de 768 à 1279 px (cibles de 56 px, aucun survol) ; bureau à partir de 1280 px. Aucun défilement horizontal (`scrollWidth <= clientWidth`) à 375, 1024 et 1440 px, en clair et en sombre.

## 8. Avant de dire terminé

Contrôle dans un vrai navigateur : 375 px et 1440 px (1024 px pour la caisse), clair et sombre, `fr` et `ar` au moins. `bash scripts/harness-check.sh` propre. Pour le site Astro : Lighthouse au moins 98 en médiane de 3 passes, `/llms.txt`, miroirs `.md`, JSON-LD valide, aucun script tiers.



## Mise à jour du 2026-11-15 : acquis et arbitrages de la vague 2 (prime sur ce qui précède)

- **Polices (propriétaire, D-23)** : Noto Sans Arabic côté Web, **IBM Plex Sans Arabic côté PDF** (conteneur `fiscal-java`), toutes deux en OFL auto-hébergées sans appel tiers ; `zgh-Tfng` s'affiche en **LTR** ; le Tifinagh livré est une translittération mécanique du latin, à faire relire par des locuteurs natifs.
- **Contraste** : `--brand-indigo` en sombre mesure 4,32:1 (sous 4,5:1) : icônes et bordures seulement, jamais du texte courant ; le texte secondaire en clair mesure 6,9:1, donc les libellés comptables utilisent le token de texte principal (7:1, Doc_08 § 10) ; un test de contraste l'affirme.
- **Composants livrés (P2-B)** : `FiscaCommandPalette`, `FiscaReviewDrawer`, `resolveCommandReviewLabels` dans `apps/web-saas/src/shared` ; clés `ui.palette.*` et `ui.review.*` dans les 6 langues, sans libellé de repli en dur ; grille virtuelle bi-densité (44 px et 28 px) avec décalage de mise en page mesuré nul dans Chromium (`MercuryGrid` passe `useFlushSync: false`, test de régression) ; tiroir à droite en LTR, à gauche en RTL.
- **Langues** : 6 sur PME, POS et site ; 3 (fr, ar, en) sur fiduciaire et entreprise ; `ary`, `zgh-Latn`, `zgh-Tfng` à relire par des locuteurs natifs (T-S5-03).
- **Routes absentes** : une route que le registre ne contient pas reste un port injectable (`apps/web-saas/src/pme/pme-api.ts`) ; ne jamais inventer un chemin ni un corps.
- **Preuves** : contrôle en vrai Chromium (`bootstrap-sandbox.sh --playwright`) à 375 et 1440 px, clair et sombre ; la largeur 1024 px (tablette POS) n'a pas été capturée à G2 : à ajouter à G4 ; captures légères seulement dans le dépôt (PNG de 150 Ko au plus, 10 au plus) ; Lighthouse ≥ 98 en médiane de 3 passes (100 obtenu sur 11 pages du site à G2).
