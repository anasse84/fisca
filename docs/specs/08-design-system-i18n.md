<!--
ID canonique : Doc_08_Design_i18n   |   Fichier : docs/specs/08-design-system-i18n.md
Source : « Document 08 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_08_Design_i18n#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_08_Design_i18n »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 08 — Design System Hybride Mercury & Architecture Multilingue i18n
Ce document codifie le système de design hybride (clair et sombre), l'ergonomie responsive multi-surfaces (Web, Mobile Capacitor et Caisse POS) ainsi que l'ingénierie multilingue à 6 et 3 langues de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_08_Design_i18n).
## Section 01 — Philosophie Visuelle : Fusion « Mercury » & « Registre Comptable »
L'identité visuelle de Fisca fusionne la clarté bancaire minimaliste de Mercury.com (élévation fine par bordures d'un pixel, barre de commande universelle, courbes prévisionnelles épurées) avec la chaleur reposante du papier registre comptable marocain et un Mode Sombre haute précision.
- Confiance institutionnelle immédiate : L'interface associe le Vert Émeraude marocain pour les validations DGI et l'Indigo profond pour le pilotage financier et les actions IA.
- Zéro fatigue oculaire en saisie longue : Le mode clair remplace le blanc clinique agressif par un fond papier registre chaud qui offre un contraste optimal pendant les périodes fiscales.
- Mode Sombre natif sans halo : Le thème sombre utilise des gris obsidienne profonds et désature légèrement les pastilles de statut pour préserver un contraste WCAG AAA de nuit comme en salle de restaurant sur Fisca POS.
- Sobriété typographique : Les textes tout en majuscules agressifs sont bannis ; les références légales s'affichent sous forme de pastilles discrètes accompagnant chaque calcul.
## Section 02 — Tokens de Couleurs Sémantiques (Clair & Sombre)
Tous les composants de packages/ui-mercury et apps/marketing-astro consomment exclusivement ces variables CSS sémantiques (aucune couleur hexadécimale brute n'est tolérée dans les composants React) :

| Token CSS | Mode Clair (Registre) | Mode Sombre (Obsidienne) | Usage Métier Exact |
|---|---|---|---|
| --bg-canvas | #FAF9F5 | #0B0E14 | Arrière-plan principal reposant |
| --bg-surface | #FFFFFF | #121722 | Cartes KPI, modales et cellules |
| --bg-subtle | #F2EFE9 | #181F2E | En-têtes de tableaux et barre latérale |
| --text-primary | #141413 | #F3F4F6 | Encre principale à contraste maximal |
| --text-secondary | #5C5A54 | #9CA3AF | Labels secondaires et articles CGI |
| --line-border | #E4E1D8 | #222B3A | Bordures fines de 1 pixel des grilles |
| --brand-emerald | #0F5338 | #10B981 | Bouton primaire et certification xHub DGI |
| --brand-indigo | #4F46E5 | #6366F1 | Copilote IA, prévisions et focus clavier |
| --status-cleared | #E3F2E9 / #0B4F32 | #092E20 / #34D399 | Facture certifiée DGI et ICE vérifié |
| --status-warning | #F8EEDB / #8A5300 | #2E210B / #FBBF24 | Espèces 5 000 MAD, RAS expirée, point IA |
| --status-danger | #FCE8E6 / #A51D24 | #311114 / #F87171 | Rejet xHub, RIB suspect, retard 69-21 |

- Persistance et synchronisation du thème : Le choix utilisateur (light, dark ou system) est lu avant le premier rendu via un script inline sans clignotement blanc, synchronisé entre onglets et respecté sur les terminaux mobiles Capacitor et Fisca POS.
## Section 03 — Typographie Multi-Scripts & Loi des Chiffres Tabulaires
Pour respecter la Loi 09-08 (CNDP) sans requête externe vers des serveurs tiers et garantir le rendu hors-ligne de la caisse, les quatre familles de polices sont auto-hébergées en .woff2 :
- Scripts latins (fr, en, zgh-Latn) : Police Geist pour l'interface et Geist Mono pour les identifiants techniques, incluant la plage Unicode latine étendue nécessaire à l'orthographe standard de l'IRCAM (ṣ, ḍ, ṭ, ẓ, ɛ, ɣ, ḥ, ṛ).
- Scripts arabes (ar, ary Darija) : Police Noto Sans Arabic optimisée pour la lecture dense des libellés comptables et des aperçus Factur-X en orientation droite-à-gauche.
- Script Tifinagh (zgh-Tfng) : Police Noto Sans Tifinagh conforme au codage Unicode officiel de l'IRCAM (U+2D30 à U+2D7F) avec hauteur d'œil harmonisée à 1,08 em pour s'aligner sur les badges latins.
- Loi absolue tabular-nums et chiffres occidentaux 0-9 : La règle CSS font-variant-numeric: tabular-nums lining-nums s'applique obligatoirement à tous les montants en MAD, taux, numéros d'ICE à 15 chiffres, clés RIB à 24 chiffres, comptes PCGE et dates. Conformément à l'usage bancaire et comptable marocain, les chiffres occidentaux (0-9) sont maintenus dans les 6 langues (y compris ar et ary).
## Section 04 — Densité Adaptative (44px vs 28px) & Stabilité sous Flux SSE
Un dirigeant de PME sur ordinateur portable et un collaborateur comptable révisant un Grand Livre de 8 000 lignes n'ont pas le même besoin de densité visuelle :
- Mode Confort Dirigeant (44px par défaut) : Toutes les lignes des tableaux (Factures, Achats, Banque, Radar Loi 69-21) sont verrouillées à une hauteur stricte de 44 pixels avec aération généreuse style Mercury.
- Mode Haute Densité Comptable (28px en 1 clic) : Un commutateur persistant en haut des grilles réduit la hauteur de ligne à 28 pixels et la taille de police à 12,5 pixels, affichant plus de 30 écritures simultanément sans défilement vertical.
- Virtualisation haute vitesse et zéro saut visuel : Les grilles s'appuient sur TanStack Table et TanStack Virtual pour maintenir 60 images par seconde jusqu'à 10 000 écritures, et réservent des squelettes de largeur fixe pendant le remplissage en direct via Server-Sent Events afin d'imposer un Cumulative Layout Shift égal à zéro.
## Section 05 — Composants Signature : Cmd+K, Split-Screen & Garde-Fous IA
Cinq patrons ergonomiques distinguent Fisca des logiciels comptables traditionnels :
- Palette de commande universelle (Cmd+K / Ctrl+K) : Permet en moins de 150 ms de basculer entre 200 dossiers clients d'une fiduciaire, rechercher un ICE national, créer une facture, exporter un ZIP SIMPL-TVA ou interroger le copilote.
- Tiroir d'inspection côte-à-côte (Split-Screen Review Drawer) : Inspiré de Paperless-ngx, un clic sur une pièce ouvre à gauche le PDF ou la photo WhatsApp avec surbrillance interactive des zones extraites (ICE, Date, HT, TVA, TTC, cachet humide) et à droite l'écriture PCGE équilibrée proposée avec son score de confiance.
- Bannières fiscales contextuelles : Dès qu'une règle du CGI se déclenche (scission espèces au-delà de 5 000 MAD TTC Art. 11-II, attestation RAS-TVA expirée Art. 117, seuil 80 000 MAD Auto-Entrepreneur ou caisse 5161 proche de zéro), un bandeau explicatif cite l'article exact et montre l'écriture rectificative.
- Courbe de Trésorerie & TVA Prévisionnelle : En tête du tableau de bord, un graphique épuré trace en trait plein les encaissements bancaires lettrés et en pointillés la prévision à 90 jours ainsi que le provisionnement de la TVA due le 20 du mois.
- Matérialisation visuelle des 4 règles d'arrêt AI Crafters : Une détection IA porte toujours le badge ambre Point à examiner (jamais Anomalie confirmée avant visa humain), tout montant illisible sur un scan reste vide avec bordure ambre clignotante sans chiffre deviné, et le bouton final rappelle explicitement l'approbation humaine.
## Section 06 — Architecture Responsive : Mobile, Tablette POS & Bureau
Une seule base de composants sert quatre contextes matériels grâce à des points de rupture stricts :

| Surface & Largeur | Navigation Principale | Rendu des Tableaux | Cible Tactile Min. | Particularité Ergonomique |
|---|---|---|---|---|
| Mobile (360–767px) | Barre basse 5 icônes | Cartes résumées + TTC fixe | 44 x 44 pixels | Bouton central caméra scan & WhatsApp |
| Tablette POS (768–1279px) | Barre supérieure caisse | Grille articles + Ticket Z | 56 x 56 pixels | Zéro survol, retour visuel sous 50 ms |
| Desktop (1280–1535px) | Barre latérale 240px/64px | Table virtuelle complète | 32 x 32 pixels | Tiroir Split-Screen superposé 55 % |
| Grand Écran (1536px+) | Barre latérale + Raccourcis | Vue maître-détail permanente | 28 x 28 pixels | Double écran Révision Cycles OEC |

- Adaptation native Capacitor (iOS & Android) : Prise en compte systématique des encoches (safe-area-inset-top et bottom), retour haptique léger à la signature OTP ou au scan d'une facture, et verrouillage biométrique FaceID / empreinte à la reprise de session.
- Ergonomie comptoir Fisca POS Tactile : Aucun menu déroulant dépendant d'une souris n'est autorisé ; un indicateur permanent en haut d'écran affiche l'état réseau (En ligne ou Autonomie Hors-Ligne SQLite — X tickets en attente de synchro) ainsi que le bouton d'impression thermique ESC/POS et de génération du QR Code B2B.
## Section 07 — Gouvernance Linguistique : 6 Langues PME/POS vs 3 Langues B2B
Le routeur de langue applique matériellement la séparation décidée entre les surfaces grand public/commerçants et les portails d'audit institutionnels :

| Code BCP-47 | Langue & Script | Dir. | Surfaces Autorisées | Chaîne de Repli Terminologique Fiscal |
|---|---|---|---|---|
| fr | Français (Latin) | LTR | Toutes (Astro, PME, POS, OEC, Corp) | Référence CGI / CGNC de base |
| ar | Arabe classique | RTL | Toutes (Astro, PME, POS, OEC, Corp) | Terminologie officielle DGI (tax.gov.ma) |
| en | English (Latin) | LTR | Toutes (Astro, PME, POS, OEC, Corp) | Normes IFRS / ISA + sigles marocains (ICE, IF) |
| ary | Darija marocaine (Arabe) | RTL | Astro, PME/TPE/Solo & POS seuls | ary → ar officiel DGI + sigle majuscule (TVA) |
| zgh-Latn | Tamazight IRCAM (Latin) | LTR | Astro, PME/TPE/Solo & POS seuls | zgh-Latn → fr officiel CGI/CGNC |
| zgh-Tfng | Tamazight IRCAM (Tifinagh) | LTR | Astro, PME/TPE/Solo & POS seuls | Lexique IRCAM + sigle latin + infobulle ar / fr |

- Verrouillage strict des portails Fiduciaire et Corporate : Lorsqu'un utilisateur accède aux routes /fiduciary/* ou /enterprise/* (ou à un domaine marque blanche cabinet), le sélecteur de langue ne propose que fr, ar et en ; si la préférence précédente était ary, elle bascule automatiquement sur ar, et si elle était zgh-Latn ou zgh-Tfng, elle bascule sur fr.
- Découpage modulaire des dictionnaires JSON : Les traductions dans packages/i18n/locales/{locale}/ sont scindées en 6 espaces de noms chargés à la demande (common, marketing, invoicing_pos, accounting_cgnc, tax_simpl, enterprise) avec validation à la compilation vérifiant que 100 % des clés existent sans texte manquant.
## Section 08 — Ingénierie Bidirectionnelle RTL / LTR & Isolation Bidi
Le passage instantané du Français ou du Tifinagh (LTR) vers l'Arabe classique ou la Darija (RTL) sans aucune cassure visuelle repose sur trois règles CSS strictes :
- Propriétés logiques CSS exclusives : Toutes les marges, bordures, paddings et alignements utilisent les classes logiques Tailwind v4 (ms-*, me-*, ps-*, pe-*, start-*, end-*, border-s, border-e, text-start, text-end, rounded-s, rounded-e). Les classes physiques (ml-*, mr-*, pl-*, pr-*, left-*, right-*, text-left, text-right) sont interdites par ESLint.
- Isolation bidirectionnelle des données structurées : Même lorsque document.documentElement.dir vaut "rtl", tous les montants monétaires (en particulier négatifs comme -1 200,00 MAD), numéros d'ICE, RIB, numéros séquentiels (FAC-2026-00042), téléphones (+212 6...) et formules fiscales sont encapsulés dans dir="ltr" avec unicode-bidi: isolate afin que le signe moins ou les barres obliques ne s'inversent jamais.
- Symétrie directionnelle des icônes : Seules les icônes exprimant une progression ou un retour (ArrowRight, ChevronRight, Reply) portent la classe utilitaire rtl:-scale-x-100 ; les icônes universelles (coche de validation DGI, horloge Loi 69-21, cadenas E2EE, QR Code) ne sont jamais retournées.
## Section 09 — Gabarit Officiel Factur-X Bilingue (FR / AR) & Arrêté en Lettres
Indépendamment des 6 langues de l'interface, toute facture PDF/A-3 Factur-X générée par le conteneur Mustangproject respecte une mise en page bilingue symétrique Français / Arabe classique conforme à l'Article 145 du CGI et aux Lois 5-96 / 17-95 :
- En-tête société et client en double colonne : Colonne gauche en Français (LTR) et colonne droite en Arabe classique (RTL) affichant la raison sociale dans les deux langues, la forme juridique exacte et le montant du capital social, l'adresse ADC450, l'ICE à 15 chiffres, l'IF, le RC + Tribunal, la Taxe Professionnelle et la CNSS.
- Corps de lignes et tableau récapitulatif des taxes : Désignation bilingue par ligne, colonnes numériques alignées en tabular-nums, et bloc de liquidation ventilant HT par taux 2026 (20 %, 10 %, 0 % avec code motif légal), Débours hors TVA, Droit de timbre espèces (0,25 %), Retenue de garantie BTP, RAS-TVA (75 % ou 100 %) et Net à Payer Encaissable.
- Double arrêté en toutes lettres déterministe : Deux fonctions pures sans IA convertissent le total TTC exact en centimes vers sa formulation légale française (« Arrêtée la présente facture à la somme de : douze mille dirhams et zéro centime ») et arabe classique (« أوقفت هذه الفاتورة في مبلغ: اثنا عشر ألف درهم وصفر سنتيم »).
- Pied de preuve cryptographique DGI : Intègre le QR Code officiel xHub DGI, l'UUID de Clearance, les 16 premiers caractères de l'empreinte chaînée SHA-256, le cachet visible Loi 43-20 Barid eSign et le RIB vérifié à 24 chiffres accompagné du lien de paiement instantané Payzone.
## Section 10 — Accessibilité Financière (WCAG 2.2) & Navigation Clavier
- Contraste et daltonisme : Tous les couples texte/fond respectent un ratio minimal de 7:1 (WCAG AAA) sur les montants et libellés comptables ; aucun statut n'est communiqué par la couleur seule (chaque badge associe une icône distincte, une bordure et un libellé explicite).
- Productivité 100 % clavier pour les cabinets : Dans la boîte de réception d'achats et le Grand Livre, les touches J / K ou flèches parcourent les lignes de 44px ou 28px, Entrée ouvre le tiroir Split-Screen, Tab navigue entre les champs PCGE et Mod+Entrée valide le visa du cycle comptable sans toucher à la souris.
## Section 11 — Code de Référence : Tokens CSS, Routeur de Langues & Primitives UI
Ce premier bloc définit la feuille de tokens packages/ui-mercury/src/tokens.css :

```css
:root,
[data-theme="light"] {
  --bg-canvas: #FAF9F5;
  --bg-surface: #FFFFFF;
  --bg-subtle: #F2EFE9;
  --text-primary: #141413;
  --text-secondary: #5C5A54;
  --line-border: #E4E1D8;
  --brand-emerald: #0F5338;
  --brand-indigo: #4F46E5;
  --status-cleared-bg: #E3F2E9;
  --status-cleared-text: #0B4F32;
  --status-warning-bg: #F8EEDB;
  --status-warning-text: #8A5300;
  --status-danger-bg: #FCE8E6;
  --status-danger-text: #A51D24;
  --table-row-height: 44px;
}

[data-theme="dark"] {
  --bg-canvas: #0B0E14;
  --bg-surface: #121722;
  --bg-subtle: #181F2E;
  --text-primary: #F3F4F6;
  --text-secondary: #9CA3AF;
  --line-border: #222B3A;
  --brand-emerald: #10B981;
  --brand-indigo: #6366F1;
  --status-cleared-bg: #092E20;
  --status-cleared-text: #34D399;
  --status-warning-bg: #2E210B;
  --status-warning-text: #FBBF24;
  --status-danger-bg: #311114;
  --status-danger-text: #F87171;
}

[data-density="compact"] {
  --table-row-height: 28px;
}

.fisca-tabular-num {
  font-family: "Geist Mono", "Geist", monospace;
  font-variant-numeric: tabular-nums lining-nums;
  unicode-bidi: isolate;
}
```

Ce second module TypeScript/React 19 (packages/ui-mercury/src/FiscalPrimitives.tsx) implémente le verrouillage 6 langues contre 3 langues, le formatage entier sans flottant avec isolation bidirectionnelle et l'infobulle terminologique IRCAM :

```ts
import React from "react";

export type FiscaLocale = "fr" | "ar" | "ary" | "zgh-Latn" | "zgh-Tfng" | "en";
export type FiscaAppSurface =
  | "MARKETING_ASTRO"
  | "PME_SAAS"
  | "POS_TACTILE"
  | "FIDUCIAIRE_OEC"
  | "ENTERPRISE_CORPORATE";

const SIX_LOCALES: readonly FiscaLocale[] = ["fr", "ar", "ary", "zgh-Latn", "zgh-Tfng", "en"];
const THREE_INSTITUTIONAL_LOCALES: readonly FiscaLocale[] = ["fr", "ar", "en"];

export function getAllowedLocalesForSurface(surface: FiscaAppSurface): readonly FiscaLocale[] {
  if (surface === "FIDUCIAIRE_OEC" || surface === "ENTERPRISE_CORPORATE") {
    return THREE_INSTITUTIONAL_LOCALES;
  }
  return SIX_LOCALES;
}

export function resolveSafeLocaleForSurface(
  requested: FiscaLocale,
  surface: FiscaAppSurface
): { readonly locale: FiscaLocale; readonly dir: "ltr" | "rtl"; readonly fallbackChain: readonly FiscaLocale[] } {
  const allowed = getAllowedLocalesForSurface(surface);
  let active: FiscaLocale = allowed.includes(requested)
    ? requested
    : requested === "ary"
      ? "ar"
      : "fr";

  const dir: "ltr" | "rtl" = active === "ar" || active === "ary" ? "rtl" : "ltr";
  const fallbackChain: readonly FiscaLocale[] =
    active === "ary"
      ? ["ary", "ar", "fr"]
      : active === "zgh-Latn" || active === "zgh-Tfng"
        ? [active, "fr"]
        : [active, "fr"];

  return { locale: active, dir, fallbackChain };
}

/**
 * Formate des centimes entiers sans jamais recourir à une division flottante imprécise
 */
export function formatCentimesMad(amountCents: number, currency = "MAD"): string {
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(`UI_FLOAT_FORBIDDEN: Montant non entier détecté (${amountCents}).`);
  }
  const isNegative = amountCents < 0;
  const absCents = Math.abs(amountCents);
  const wholeDirhams = Math.trunc(absCents / 100);
  const centimesPart = String(absCents % 100).padStart(2, "0");
  const groupedWhole = wholeDirhams.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const signPrefix = isNegative ? "-" : "";
  return `${signPrefix}${groupedWhole},${centimesPart} ${currency}`;
}

export interface FiscalAmountProps {
  readonly amountCents: number;
  readonly currency?: string;
  readonly emphasizeSign?: boolean;
}

export function FiscalAmount({ amountCents, currency = "MAD", emphasizeSign = false }: FiscalAmountProps) {
  const formatted = formatCentimesMad(amountCents, currency);
  const toneClass =
    emphasizeSign && amountCents < 0
      ? "text-[var(--status-danger-text)]"
      : "text-[var(--text-primary)]";

  return (
    <span dir="ltr" className={`fisca-tabular-num inline-block text-end ${toneClass}`}>
      {formatted}
    </span>
  );
}

export interface FiscalTermProps {
  readonly locale: FiscaLocale;
  readonly label: string;
  readonly acronym?: string;
  readonly officialAr: string;
  readonly officialFr: string;
}

/**
 * Affiche un terme comptable avec sigle latin préservé et infobulle bilingue obligatoire en Tifinagh IRCAM
 */
export function FiscalTerm({ locale, label, acronym, officialAr, officialFr }: FiscalTermProps) {
  const tooltipText = `${officialFr} — ${officialAr}`;
  return (
    <span
      title={locale === "zgh-Tfng" ? tooltipText : undefined}
      className="inline-flex items-baseline gap-1 border-b border-dotted border-[var(--line-border)] cursor-help"
    >
      <span>{label}</span>
      {acronym ? (
        <abbr dir="ltr" className="fisca-tabular-num text-xs font-semibold no-underline">
          ({acronym})
        </abbr>
      ) : null}
    </span>
  );
}
```

## Section 12 — Harnais de Vérification Automatisée UI & i18n (Rubric R3)
Lors des sessions P2-B, P2-C, P4-A et des Barrières QA associées, l'agent Fisca-QA-Security-Auditor exécute quatre contrôles automatisés bloquants :
- Linter AST Anti-Classes Physiques & Anti-Hex : Échoue si un fichier .tsx ou .astro contient une classe directionnelle physique (ml-, mr-, pl-, pr-, text-left, text-right) ou une couleur hexadécimale hors de tokens.css.
- Audit Matriciel des Langues par Surface : Un test Playwright parcourt les 6 locales sur / et /app/pme, vérifie que document.documentElement.dir passe à "rtl" sur ar et ary, puis vérifie que /app/fiduciary et /app/enterprise rejettent ary, zgh-Latn et zgh-Tfng au profit exclusif de fr, ar et en.
- Contrôle Zéro Débordement & Stabilité 44px/28px : Vérifie l'absence de défilement horizontal parasite (scrollWidth <= clientWidth) en largeurs 375px (Mobile), 1024px (Tablette POS) et 1440px (Desktop) en mode clair et sombre, ainsi qu'un saut de mise en page nul pendant l'injection SSE de 100 factures.
- Validation visuelle du PDF Factur-X Bilingue : Génère une facture test contenant une remise, un débours, la RAS-TVA à 75 % et un montant négatif d'avoir, puis vérifie la présence des polices embarquées Geist et Noto Sans Arabic, du double arrêté en lettres FR/AR et l'absence de caractères arabes disjoints.
