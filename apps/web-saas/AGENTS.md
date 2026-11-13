# AGENTS.md — `apps/web-saas` (Mercury, i18n, RTL)

Précise la constitution racine (`/AGENTS.md`). Vaut aussi pour `apps/pos-pwa` et `packages/ui-mercury`. Lire aussi Doc_08 et `docs/specs/ERRATA.md` (B-02, B-13, D-09, D-14).

## Règles locales

- **Mercury** : uniquement les variables sémantiques de `tokens.css`, clair et sombre. Aucune couleur, ombre ni espacement en dur dans un composant.
- **Chargement des surfaces** : `import.meta.glob`, jamais une liste d'imports écrite à la main (B-02). Surfaces : `src/pme`, `src/fiduciary`, `src/enterprise`, `src/shared`.
- **Langues** : 6 (`fr`, `ar`, `ary`, `zgh-Latn`, `zgh-Tfng`, `en`) sur PME et POS (et Astro) ; **3 seulement** (`fr`, `ar`, `en`) sur `fiduciary` et `enterprise`. Aucune chaîne visible en dur : tout passe par `packages/i18n`. Repli terminologique fiscal : Darija vers arabe DGI ; Tamazight vers français CGI et lexique IRCAM, avec infobulle bilingue en Tifinagh.
- **RTL** : classes logiques seulement (`ps-*`, `pe-*`, `ms-*`, `me-*`, `text-start`, `text-end`) ; jamais `left`, `right`, `pl-*`, `pr-*`, `ml-*`, `mr-*`. Vérifier chaque écran en `dir="rtl"` et `dir="ltr"`.
- **Argent à l'écran** : aucun flottant monétaire. Pas de `parseFloat`, `toFixed`, `Number(…) / 100` sur un montant. Les centimes entiers se formatent par la fonction partagée (`formatCentimesMad`) ; `Math.trunc(x / 100)` et `%` sont admis pour l'affichage seulement (D-09). Montants, ICE et RIB : `tabular-nums` et `dir="ltr"`, même en page arabe.
- **Densité et stabilité** : double densité 44 px / 28 px sans saut de mise en page sous flux SSE (CLS = 0) ; en caisse, cibles tactiles d'au moins 56 × 56 px.
- **Libellés de conformité** : tant que seul le pilote `simulated` existe, l'état `--status-cleared` s'affiche « Validation simulée », jamais « Facture certifiée DGI ». Ni « conforme », ni « homologué », ni « certifié » DGI ou xHub (B-13).
- **Lighthouse** : au moins 98 en médiane de 3 passes ; 95 à 97 fait perdre des points, sous 95 c'est éliminatoire (D-14).
- **POS** : clé ECDSA P-256 non extractible ; comptage aveugle (l'attendu est masqué) ; hors ligne en OPFS.
- **Jamais** de `tenantId` ni `companyId` envoyé comme argument : l'en-tête `X-Fisca-Company-Id` sélectionne, le serveur vérifie (D-16).

## Vérifier

`pnpm --filter @fisca/web-saas test`, `pnpm verify:fast`, et pour toute interface un contrôle en vrai navigateur à 375 px et 1440 px, clair et sombre, LTR et RTL.
