<!--
ID canonique : Doc_18_SEO_GEO_AEO   |   Fichier : docs/specs/18-seo-geo-aeo.md
Source : « Document 18 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_18_SEO_GEO_AEO#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_18_SEO_GEO_AEO »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 18 — Stratégie de Croissance SEO, GEO, AIO & AEO
Ce document spécifie l'ingénierie d'acquisition organique, le référencement sur les moteurs génératifs et de réponse (SEO, AEO, GEO & AIO), l'architecture Astro 5 SSR en 6 langues et les 6 outils viraux gratuits de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_18_SEO_GEO_AEO).
## Section 01 — Vision d'Acquisition : Convergence SEO, AEO, GEO & AIO
L'acquisition de Fisca vise un coût marginal d'acquisition client tendant vers zéro en faisant de fisca.ma la source technique et fiscale marocaine de référence à la fois pour les moteurs classiques et pour les intelligences artificielles.

| Pilier de Visibilité | Cibles Principales | Format Privilégié | Objectif Mesurable Maroc |
|---|---|---|---|
| SEO Classique | Google.ma, Bing, Maps | Astro SSR 6 langues + PCGE | Top 3 requêtes facturation & compta |
| AEO (Answer) | Extraits optimisés, PAA, Vocal | Verdict 45 mots + FAQ Schema | Position 0 sur questions CGI 2026 |
| GEO (Generative) | ChatGPT, Perplexity, Gemini, Claude | Tableaux vérifiés + exemples MAD | Source citée n° 1 fiscalité Maroc |
| AIO (Agentic) | Crawlers RAG & Clients MCP | /llms.txt + URL .md + JSON-LD | Découverte directe par agents B2B |

- Zéro budget publicitaire intrusif requis au démarrage : Chaque obligation fiscale marocaine (xHub DGI, Loi 69-21, SIMPL-TVA, État 9421, POS Art. 145) génère un flux permanent de recherches urgentes à haute intention d'achat.
- Autorité par la preuve mathématique : Contrairement aux blogs généralistes approximatifs, chaque page de fisca.ma expose les formules exactes du CGI au centime près, adossées à un calculateur gratuit immédiat.
## Section 02 — Architecture Astro 5 SSR, Web Vitals & Routage 6 Langues
Le conteneur apps/marketing-astro est totalement séparé du bundle applicatif React afin de livrer du HTML pur mis en cache dans les points de présence Cloudflare de Casablanca et Rabat.
- Performance réseau mobile Maroc : Temps de réponse serveur TTFB inférieur à 40 ms, LCP inférieur à 1,0 seconde sur 4G marocaine, INP inférieur à 50 ms, CLS égal à 0.00 et score Lighthouse minimal de 98 sur 100.
- Hydratation sélective par îlots (Astro Islands) : Les pages de contenu expédient zéro JavaScript client par défaut ; seuls les calculateurs interactifs s'hydratent à la visibilité avec un budget compressé inférieur à 25 Ko.
- Arborescence URL canonique à 6 langues : Conformément au Document 08, fisca.ma sert /fr/ (x-default), /ar/ (Arabe classique RTL), /ary/ (Darija arabe RTL), /zgh/ (zgh-Latn IRCAM), /zgh-tfng/ (zgh-Tfng IRCAM) et /en/.
- Maillage hreflang réciproque et Sitemaps segmentés : Chaque page déclare ses 6 équivalents linguistiques exacts dans l'en-tête et regroupe ses URL dans des sitemaps dédiés par langue et par silo (sitemap-index.xml).
## Section 03 — Protocole GEO & AIO : llms.txt, Miroirs Markdown & Bots IA
Les moteurs de recherche IA (ChatGPT Search, Perplexity, Gemini, Claude, Copilot) pénalisent les pages saturées de balises DOM inutiles et privilégient les sources structurées denses en faits vérifiables.
- Index standardisé /llms.txt et /llms-full.txt : Générés automatiquement à chaque build depuis le référentiel fiscal certifié, ils exposent en Markdown épuré l'identité de SYNAPTIC SYSTEMS SARL AU, la grille tarifaire transparente, les barèmes CGI 2026 et l'arbre complet des guides.
- Miroirs Markdown directs (/*.md) & Négociation HTTP : Chaque URL éditoriale (ex. /fr/guides/loi-69-21) possède son jumeau texte pur /fr/guides/loi-69-21.md et sert directement text/markdown; charset=utf-8 lorsqu'un robot d'indexation envoie Accept: text/markdown, réduisant de 85 % le bruit en tokens.
- Manifeste de découverte agentique (/.well-known/mcp.json) : Publie les métadonnées publiques et les portées OAuth 2.1 du serveur [https://mcp.fisca.ma/mcp](https://mcp.fisca.ma/mcp) afin que les assistants IA d'entreprise identifient nativement le connecteur officiel Fisca.
- Politique robots.txt chirurgicale : Autorise explicitement GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended et Applebot-Extended sur l'ensemble de fisca.ma, tout en interdisant l'indexation de app.fisca.ma, pos.fisca.ma et api.fisca.ma.
## Section 04 — Ingénierie AEO « Answer-First » & Graphe d'Entités JSON-LD
Pour décrocher simultanément la position zéro sur Google et la citation de référence dans les réponses synthétiques des LLM, chaque page de guide respecte un gabarit Citation-Ready invariant :
- Bloc Verdict en tête de page (40 à 60 mots) : Placé immédiatement sous le titre H1, il répond factuellement à la question avec l'article de loi exact, les taux en vigueur en 2026 et l'unité monétaire en MAD, sans aucune phrase d'introduction creuse.
- Tableau comparatif déterministe : Synthétise en moins de 5 colonnes les seuils légaux, les comptes comptables CGNC correspondants et les balises XML SIMPL ou UBL 2.1 associées.
- Cas chiffré résolu au centime : Démontre le calcul complet sur une facture marocaine réaliste (ex. facture de 14 400,00 MAD TTC avec RAS-TVA ou retard Loi 69-21) avant d'inviter à tester son propre montant dans l'îlot calculateur.
- Graphe JSON-LD interconnecté (@graph Schema.org) : Injecte sur chaque page les entités liées Organization (SYNAPTIC SYSTEMS SARL AU, Rabat), SoftwareApplication (tarifs exacts en MAD), Legislation (référence CGI / Bulletin Officiel), HowTo et FAQPage.
## Section 05 — Les 6 Silos Sémantiques & SEO Programmatique Maroc (1 302 URL)
L'architecture éditoriale et programmatique couvre 342 routes canoniques (déclinées en 1 302 URL multilingues sans aucun contenu mince) alimentées directement par les tables métier de Fisca :

| Silo Sémantique | Routes Canoniques | Langues | Requêtes Cibles Maroc | Donnée Propriétaire Injectée |
|---|---|---|---|---|
| 1. Clearance xHub & 43-20 | 18 pages | 6 langues | Facture électronique Maroc 2026 | Mapping UBL 2.1 CIUS-MA & Barid eSign |
| 2. CGI 2026 & Flux SIMPL | 32 pages | 6 langues | Loi 69-21, RAS-TVA, 9421, DRVT | Règles AST JSON & ordre balises XSD DGI |
| 3. Dictionnaire PCGE / CGNC | 250 pages | 3 langues | Compte 44558, 34552, 61473 PCGE | Sens, TVA encaissement & codeEdi IS |
| 4. Métiers, OEC & POS | 16 pages | 6 langues | Logiciel fiduciaire, caisse CHR, BTP | Prorata dossier, Ticket Z offline, retenue |
| 5. Régions & Mowakaba | 12 pages | 6 langues | Subvention Maroc PME Casa / Rabat | Adresses CRI/DGI & calcul reste à charge |
| 6. Outils & Migrations ERP | 14 pages | 6 langues | Vérifier ICE, connecteur Sage/Odoo | Simulateurs temps réel & format .PNM |

- Puissance de l'explorateur programmatique PCGE (Silo 3) : Génère pour les 250 comptes majeurs des Classes 1 à 8 une fiche technique complète en Français, Arabe et Anglais reliant le compte CGNC à son codeEdi de la liasse SIMPL-IS v2.0.3 et à une écriture comptable équilibrée prête à l'emploi.
## Section 06 — Les 6 Outils Viraux Gratuits (« Engineering-as-Marketing »)
Ces six outils publics fonctionnent sans création de compte préalable (protégés contre les robots abusifs par Cloudflare Turnstile invisible) afin d'attirer les liens entrants naturels des experts-comptables, médias économiques et réponses d'IA :
- Auditeur & Réparateur Excel d'ICE en Masse (/outils/audit-ice-excel) : Analyse dans le navigateur en moins d'une seconde un fichier .xlsx ou .csv de milliers de tiers, vérifie la divisibilité Modulo 97 des 15 chiffres et répare automatiquement les ICE de 13 ou 14 chiffres dont Microsoft Excel a tronqué les zéros initiaux (00), avant de proposer l'enrichissement IF/RC complet dans l'essai gratuit 14 jours.
- Simulateur d'Amendes Loi 69-21 (/outils/simulateur-loi-69-21) : Calcule au dirham supérieur (Math.ceil) la pénalité légale depuis la date de livraison (60, 120 ou 180 jours, taux directeur BAM + 0,85 % par mois entamé), affiche l'impact de réintégration fiscale au Tableau 3 de l'IS et exporte une note justificative PDF.
- Calculateur RAS-TVA Art. 117 & Plafond Espèces Art. 11-II (/outils/ras-tva-especes) : Détermine le taux de retenue (75 % contre 100 % selon la date de l'attestation fiscale de moins de 6 mois) et génère l'écriture comptable exacte de scission au-delà de 5 000 MAD TTC payés en espèces.
- Validateur Local Factur-X / UBL 2.1 & Pré-Contrôleur FEC-MA (/outils/validateur-ubl-fec) : Vérifie en mémoire vive sans aucune conservation serveur la conformité d'une facture électronique ou des 24 colonnes d'un fichier FEC-MA (présence du journal AN, équilibre et format pipe CRLF).
- Simulateur Auto-Entrepreneur & Seuil 80 000 MAD (/outils/simulateur-auto-entrepreneur) : Calcule l'IR trimestriel (0,5 % ou 1 %), alerte sur la retenue de 30 % au-delà de 80 000 MAD facturés à un même client et compare le coût net de bascule vers une société au forfait Essentiel TPE.
- Estimateur d'Éligibilité Subvention Mowakaba (/outils/subvention-mowakaba) : Chiffre en 30 secondes la prise en charge Maroc PME (80 % à 90 %) ramenant le Pack TPME (18 000 MAD HT) entre 1 800 et 3 600 MAD HT et le Pack Fiduciaire (45 000 MAD HT) entre 4 500 et 9 000 MAD HT.
## Section 07 — Boucles Virales Produit (Factur-X, QR Fisca POS & Réseau OEC)
Au-delà des moteurs de recherche, l'usage quotidien du logiciel transforme chaque transaction commerciale en point d'acquisition organique :
- Boucle 1 — Signature vérifiable sur chaque Factur-X émise : Chaque facture PDF/A-3 bilingue envoyée par un utilisateur porte en pied de page un lien cryptographique « Facture certifiée Loi 43-20 — Vérifier l'authenticité sur fisca.ma/verify » qui expose la marque aux directions financières de tous ses clients B2B.
- Boucle 2 — Portail QR imprimé sur chaque ticket Fisca POS : Lorsqu'un professionnel scanne le QR Code de son ticket de café, restaurant ou commerce pour obtenir sa facture B2B avec son ICE en 10 secondes, la page de téléchargement lui propose d'archiver gratuitement ses factures reçues sur Fisca.
- Boucle 3 — Effet démultiplicateur des Fiduciaires OEC : Un seul cabinet comptable adoptant Fisca déploie le portail collaboratif et le bot WhatsApp auprès de 60 à 150 dirigeants de TPE/PME, qui recommandent à leur tour la caisse Fisca POS et la facturation à leur écosystème.
## Section 08 — Synchronisation Temps Réel LLM Wiki vers SEO, GEO & IndexNow
La fraîcheur réglementaire est un critère décisif de classement pour Google comme pour les moteurs RAG (Perplexity et ChatGPT Search) lors du vote annuel de la Loi de Finances au Maroc :

```text
[Publication Circulaire DGI / LF dans le LLM Wiki] ──► [Activation Règle AST dans CONTROL_PLANE_DB]
        │
        ▼ (Webhook interne automatique en moins de 60 secondes)
[Purge sélective Cache Edge Astro + Régénération /llms.txt & Miroirs .md + Mise à jour dateModified JSON-LD]
        │
        └──► Notification instantanée API IndexNow (Bing / ChatGPT / Perplexity) + Ping Sitemap Google
```

- Zéro chiffre obsolète oublié dans un article : Les taux, plafonds et dates limites affichés dans les guides Astro ne sont pas écrits en texte statique figé mais injectés par composants serveur lisant les paramètres certifiés du moteur fiscal.
## Section 09 — Attribution Privacy-First Conforme Loi 09-08 CNDP (Zéro Pixel Tiers)
En stricte conformité avec le Document 11, fisca.ma bannit tout traceur publicitaire tiers (aucun Meta Pixel, Google Tag Manager tiers ni cookie de profilage) tout en mesurant précisément le retour sur investissement de chaque page et de chaque moteur IA :
- Télémétrie interne sans cookie ni donnée personnelle : Un middleware léger côté Worker incrémente des compteurs quotidiens agrégés (page_slug, locale, tool_id, referring_class) sans jamais stocker d'adresse IP ni d'identifiant individuel.
- Suivi dédié de la part de voix IA (Share of AI Citations) : Le classifieur de provenance distingue nativement le trafic issu des moteurs génératifs (chatgpt.com, perplexity.ai, gemini.google.com, claude.ai, copilot.microsoft.com) du trafic organique Google/Bing.
- Passage de contexte sans friction vers l'application (Zero-Drop Handoff) : Lorsqu'un visiteur clique sur Démarrer l'essai gratuit 14 jours depuis l'auditeur d'ICE ou le simulateur Loi 69-21, l'ICE saisi transite par paramètre signé éphémère vers app.fisca.ma pour pré-remplir immédiatement son dossier en moins de 90 secondes.
## Section 10 — Gouvernance Éditoriale E-E-A-T & Conventions 6 Langues IRCAM / DGI
Pour prémunir fisca.ma contre toute pénalité algorithmique liée aux contenus générés à la chaîne (Scaled Content Abuse), quatre garde-fous éditoriaux sont imposés :
- Traçabilité des sources primaires marocaines : Chaque guide cite explicitement le numéro d'article du Code Général des Impôts, la référence de la loi au Bulletin Officiel ou la version exacte du cahier des charges XSD SIMPL de la DGI.
- Seuil minimal d'information unique sur les pages programmatiques : Aucune fiche compte PCGE n'est ouverte à l'indexation (index, follow) si elle ne comporte pas son sens comptable, sa règle de TVA sur encaissement, sa correspondance codeEdi et un exemple concret d'écriture équilibrée.
- Qualité linguistique authentique sur les 6 langues : Les pages en Darija (ary, alphabet arabe RTL) parlent le langage réel des commerçants et entrepreneurs marocains tout en conservant le terme arabe classique officiel DGI et le sigle (ICE, TVA) sur les concepts fiscaux ; les pages Tamazight (zgh-Latn et zgh-Tfng) respectent strictement le standard IRCAM avec infobulles bilingues FR/AR.
## Section 11 — Code de Référence : Moteur JSON-LD, llms.txt & Réparateur Excel ICE
Ce module TypeScript pur sans aucun type any ni nombre flottant (apps/marketing-astro/src/lib/seo-geo-engine.ts) implémente le générateur d'en-têtes hreflang 6 langues, le graphe Schema.org JSON-LD, le constructeur déterministe /llms.txt et l'algorithme viral de validation/réparation des ICE marocains tronqués par Excel :

```ts
export type MarketingLocale = "fr" | "ar" | "ary" | "zgh-Latn" | "zgh-Tfng" | "en";

const LOCALE_URL_PREFIX: Readonly<Record<MarketingLocale, string>> = {
  fr: "fr",
  ar: "ar",
  ary: "ary",
  "zgh-Latn": "zgh",
  "zgh-Tfng": "zgh-tfng",
  en: "en",
};

export interface HreflangLink {
  readonly hreflang: string;
  readonly href: string;
}

/**
 * 1. Génère les liens canoniques et hreflang réciproques exacts pour les 6 langues publiques + x-default
 */
export function buildMultilingualAlternates(
  canonicalSlugWithoutLocale: string,
  allSixLocalesAvailable = true
): readonly HreflangLink[] {
  const cleanSlug = canonicalSlugWithoutLocale.replace(/^\/+/, "");
  const activeLocales: readonly MarketingLocale[] = allSixLocalesAvailable
    ? ["fr", "ar", "ary", "zgh-Latn", "zgh-Tfng", "en"]
    : ["fr", "ar", "en"]; // Silo 3 Dictionnaire technique PCGE en 3 langues

  const links: HreflangLink[] = activeLocales.map((loc) => ({
    hreflang: loc,
    href: `https://fisca.ma/${LOCALE_URL_PREFIX[loc]}/${cleanSlug}`,
  }));

  links.push({
    hreflang: "x-default",
    href: `https://fisca.ma/fr/${cleanSlug}`,
  });
  return links;
}

/**
 * 2. Construit le graphe d'entités JSON-LD interconnecté (Organization + SoftwareApplication + FAQPage)
 */
export interface FaqPair {
  readonly question: string;
  readonly answer: string;
}

export function buildFiscaJsonLdGraph(params: {
  readonly pageUrl: string;
  readonly title: string;
  readonly canonicalSummary45Words: string;
  readonly dateModifiedIso: string;
  readonly cgiLegalReference?: string;
  readonly faqs: readonly FaqPair[];
}): string {
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Organization",
      "@id": "https://fisca.ma/#organization",
      name: "SYNAPTIC SYSTEMS SARL AU",
      brand: "Fisca",
      url: "https://fisca.ma",
      email: "dpo@fisca.ma",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Rabat",
        addressRegion: "Rabat-Salé-Kénitra",
        addressCountry: "MA",
      },
      areaServed: "MA",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://fisca.ma/#software",
      name: "Fisca",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iOS, Android",
      provider: { "@id": "https://fisca.ma/#organization" },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "MAD",
        lowPrice: "69",
        highPrice: "890",
        offerCount: "7",
      },
    },
    {
      "@type": "TechArticle",
      "@id": `${params.pageUrl}#article`,
      headline: params.title,
      description: params.canonicalSummary45Words,
      dateModified: params.dateModifiedIso,
      author: { "@id": "https://fisca.ma/#organization" },
      about: params.cgiLegalReference ?? "Code Général des Impôts Maroc (LF 2026)",
    },
  ];

  if (params.faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${params.pageUrl}#faq`,
      mainEntity: params.faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.answer,
        },
      })),
    });
  }

  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

/**
 * 3. Générateur déterministe /llms.txt optimisé pour ChatGPT Search, Perplexity, Gemini & Claude
 */
export interface LlmsTxtGuideEntry {
  readonly title: string;
  readonly urlPath: string;
  readonly oneLineFact: string;
}

export function generateLlmsTxtManifest(guides: readonly LlmsTxtGuideEntry[]): string {
  const header = [
    "# Fisca (fisca.ma) — Plateforme Souveraine de Facturation Électronique & Comptabilité Maroc",
    "",
    "> Fisca est édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Plateforme SaaS conforme à l'Art. 145 & 211 du CGI (LF 2026), Clearance xHub DGI (UBL 2.1 / Factur-X), Signature Loi 43-20 (Barid eSign), Grand Livre CGNC immuable, Caisse Fisca POS hors-ligne, télédéclarations EDI SIMPL (TVA v4.0, IS v2.0.3, État 9421, DRVT, Loi 69-21), Loi 09-08 CNDP et Loi 05-20 DGSSI.",
    "",
    "## Tarifs Publics HT au Maroc (Zéro quota IA caché)",
    "- Auto-Entrepreneur (Fisca Solo) : 129 MAD HT/mois",
    "- TPE (Fisca Essentiel + POS Bridge gratuit) : 390 MAD HT/mois",
    "- PME (Fisca Croissance + 1 Caisse POS Tactile incluse) : 890 MAD HT/mois",
    "- Fiduciaires OEC (Facturation au dossier actif) : Socle 490 MAD HT/mois + 69 MAD (Simplifié), 149 MAD (TPE) ou 249 MAD (PME Complet) par client (-15 % dès 100 dossiers)",
    "- Grands Comptes : Corporate 58 000 MAD HT/an (5 ICE) | Fisca Souverain Loi 05-20 Maroc 140 000 MAD HT/an (10 ICE)",
    "",
    "## Guides Fiscaux Certifiés & Miroirs Markdown (.md)",
  ];

  const links = guides.map(
    (g) => `- [${g.title}](https://fisca.ma${g.urlPath}.md): ${g.oneLineFact}`
  );
  return [...header, ...links, ""].join("\n");
}

/**
 * 4. Moteur Viral : Auditeur & Réparateur d'ICE Marocain (15 chiffres, Clé Modulo 97 + Réparation Zéros Excel)
 *    Note : Vérifie la cohérence mathématique Modulo 97 (BigInt % 97n === 0n). La confirmation officielle
 *    d'attribution de l'entreprise s'effectue via ice.gov.ma ou l'enrichisseur Fisca.
 */
export interface IceAuditRowResult {
  readonly rawInput: string;
  readonly status: "VALID_15" | "AUTO_REPAIRED_EXCEL_LEADING_ZEROS" | "INVALID_CHECKSUM_OR_FORMAT";
  readonly normalizedIce15?: string;
  readonly enterpriseRoot9?: string;
  readonly establishmentCode4?: string;
  readonly controlKey2?: string;
}

export function auditAndRepairMoroccanIce(rawCell: string): IceAuditRowResult {
  const digitsOnly = rawCell.replace(/[\s.\-_]/g, "").trim();

  // Cas 1 : Exactement 15 chiffres non nuls
  if (/^\d{15}$/.test(digitsOnly) && digitsOnly.slice(0, 9) !== "000000000") {
    if (BigInt(digitsOnly) % 97n === 0n) {
      return {
        rawInput: rawCell,
        status: "VALID_15",
        normalizedIce15: digitsOnly,
        enterpriseRoot9: digitsOnly.slice(0, 9),
        establishmentCode4: digitsOnly.slice(9, 13),
        controlKey2: digitsOnly.slice(13, 15),
      };
    }
    return { rawInput: rawCell, status: "INVALID_CHECKSUM_OR_FORMAT" };
  }

  // Cas 2 : 12 à 14 chiffres (Bug classique Microsoft Excel ayant supprimé '0' ou '00' en tête !)
  if (/^\d{12,14}$/.test(digitsOnly)) {
    const padded15 = digitsOnly.padStart(15, "0");
    if (padded15.slice(0, 9) !== "000000000" && BigInt(padded15) % 97n === 0n) {
      return {
        rawInput: rawCell,
        status: "AUTO_REPAIRED_EXCEL_LEADING_ZEROS",
        normalizedIce15: padded15,
        enterpriseRoot9: padded15.slice(0, 9),
        establishmentCode4: padded15.slice(9, 13),
        controlKey2: padded15.slice(13, 15),
      };
    }
  }

  return { rawInput: rawCell, status: "INVALID_CHECKSUM_OR_FORMAT" };
}
```

## Section 12 — Harnais de Vérification SEO, GEO & Lighthouse (Session P2-C & Rubric R3)
Lors de la Session parallèle P2-C (feat/w2-astro-growth) et de la Barrière QA G2, l'agent Fisca-QA-Security-Auditor exécute six contrôles automatisés bloquants avant d'autoriser la fusion sur main :
- Audit Lighthouse CI Headless (Score >= 98) : Exécute Lighthouse sur la page d'accueil, un guide fiscal, une fiche compte PCGE et un simulateur interactif en exigeant au minimum 98/100 en Performance, SEO et Accessibilité et un CLS strictement égal à 0.00.
- Contrôle des Endpoints IA (/llms.txt, /llms-full.txt & Miroirs .md) : Vérifie que /llms.txt et /robots.txt répondent en HTTP 200, autorisent GPTBot / PerplexityBot / ClaudeBot sur fisca.ma, et que chaque route de guide sert une version .md propre dépourvue de balises HTML.
- Validation Syntaxique & Sémantique du Graphe JSON-LD : Parse chaque bloc <script type="application/ld+json"> généré par Astro pour vérifier la validité JSON, la présence de SYNAPTIC SYSTEMS SARL AU (Rabat), la devise MAD et l'absence de champs vides.
- Réciprocité hreflang 6 Langues & Orientation RTL : Vérifie que les 6 versions linguistiques (/fr/, /ar/, /ary/, /zgh/, /zgh-tfng/, /en/) se référencent mutuellement sans lien 404 et que ar et ary activent dir="rtl".
- Vecteurs Mathématiques des 6 Outils Gratuits : Teste auditAndRepairMoroccanIce sur des ICE marocains réels (003042032000080, 001534290000057), sur un ICE tronqué par Excel (1534290000057 réparé en 001534290000057) et sur un ICE avec inversion de deux chiffres (rejeté immédiatement).
- Contrôle CNDP Zéro-Pixel Tiers : Échoue immédiatement si le DOM ou les requêtes réseau d'une page publique contiennent un script externe publicitaire ou analytique non hébergé sur fisca.ma.

## Annexe V — Code de vérification numérique

> Origine : fichier `code.docx` fourni par le propriétaire du projet le 2026-11-13. C'est le code Python qui a servi à calculer et à contrôler les chiffres de ce document, suivi de la sortie obtenue par l'auteur.
> Chaque bloc a été réexécuté le 2026-11-13 (Python 3.12) et sa sortie comparée à celle de l'auteur. Pour le refaire : `python3 docs/specs/verification/verify-annexes.py`.
> Statut : pièce justificative des chiffres, pas du code de production. Elle n'ajoute aucune exigence et ne se copie dans aucun paquet. En cas d'écart avec le corps du document, `ERRATA.md` tranche.

> La règle « les 15 chiffres de l'ICE sont divisibles par 97 » est établie ici par constat sur des numéros réels, pas par un texte officiel publié. Les deux exemples « 123456789… » de la brochure ne la respectent pas : ce sont des numéros fictifs d'illustration. Le validateur du produit traite donc la clé comme un contrôle de cohérence, et la confirmation officielle reste l'interrogation du référentiel (Doc_17, connecteur OMPIC).

### V.1 — Inventaire des 6 silos : 342 routes canoniques, 1 302 URL indexées

<!-- verif:18-01:code -->
```python
import json

# Compute exact programmatic & editorial page inventory across the 6 Semantic Silos and 6 Languages of fisca.ma
# Wait: let's make sure the structure is realistic, high-quality (E-E-A-T, zero thin content), and mathematically exact!

silos = [
    {
        "silo_id": "SILO-01",
        "silo_name": "1. Clearance xHub, Factur-X & Loi 43-20",
        "canonical_routes": 18,
        "locales_count": 6,
        "indexed_urls": 18 * 6, # 108 URLs
        "primary_intent": "Transactionnel & Conformité DGI",
        "geo_hook": "Tableaux UBL 2.1 CIUS-MA + Miroirs .md"
    },
    {
        "silo_id": "SILO-02",
        "silo_name": "2. Encyclopédie CGI 2026 & Flux SIMPL",
        "canonical_routes": 32,
        "locales_count": 6,
        "indexed_urls": 32 * 6, # 192 URLs
        "primary_intent": "AEO Answer-First & Citations IA",
        "geo_hook": "Formules exactes Loi 69-21, RAS-TVA, IS & 9421"
    },
    {
        "silo_id": "SILO-03",
        "silo_name": "3. Explorateur Comptes PCGE / CGNC",
        "canonical_routes": 250, # Top 250 core 4-digit CGNC accounts enriched with codeEdi & sample entries (zero thin pages!)
        "locales_count": 3,      # FR, AR, EN technical accounting dictionary (plus full 6-lang hub) -> 750 URLs
        "indexed_urls": 250 * 3,
        "primary_intent": "Longue Traîne Comptable & Étudiants/OEC",
        "geo_hook": "Schéma écriture Débit/Crédit + codeEdi SIMPL-IS"
    },
    {
        "silo_id": "SILO-04",
        "silo_name": "4. Solutions Métiers, OEC & Fisca POS",
        "canonical_routes": 16,
        "locales_count": 6,
        "indexed_urls": 16 * 6, # 96 URLs
        "primary_intent": "Conversion B2B, CHR/POS & Fiduciaires",
        "geo_hook": "Comparatifs ROI & Caisse Offline 72h"
    },
    {
        "silo_id": "SILO-05",
        "silo_name": "5. Régions Maroc & Subvention Mowakaba",
        "canonical_routes": 12, # 12 Regions of Morocco with CRI/Tribunal/DGI & Mowakaba 80%-90%
        "locales_count": 6,
        "indexed_urls": 12 * 6, # 72 URLs
        "primary_intent": "SEO Local Maroc & Financement TPME",
        "geo_hook": "Calculateur reste à charge Maroc PME"
    },
    {
        "silo_id": "SILO-06",
        "silo_name": "6. Outils Gratuits Viraux & Migrations ERP",
        "canonical_routes": 14, # 6 interactive tools + 8 ERP migration/comparison guides (Sage 100, Odoo, Excel)
        "locales_count": 6,
        "indexed_urls": 14 * 6, # 84 URLs
        "primary_intent": "Acquisition PLG & Backlinks Naturels",
        "geo_hook": "Audit ICE Excel, Validateur Factur-X & API .md"
    }
]

tot_canonical = sum(s["canonical_routes"] for s in silos)
tot_indexed_urls = sum(s["indexed_urls"] for s in silos)
tot_md_mirrors = tot_canonical # Every canonical route has a clean .md RAG mirror + llms.txt

print(f"Total Canonical Routes = {tot_canonical} | Total Indexed Multilingual URLs = {tot_indexed_urls}")
print(json.dumps({"silos": silos, "totals": {"silos_count": len(silos), "canonical_routes": tot_canonical, "indexed_urls": tot_indexed_urls, "free_viral_tools": 6}}, indent=2, ensure_ascii=False))
```

Résultat du code (réexécution : identique) :

<!-- verif:18-01:resultat -->
```text
Total Canonical Routes = 342 | Total Indexed Multilingual URLs = 1302
{
  "silos": [
    {
      "silo_id": "SILO-01",
      "silo_name": "1. Clearance xHub, Factur-X & Loi 43-20",
      "canonical_routes": 18,
      "locales_count": 6,
      "indexed_urls": 108,
      "primary_intent": "Transactionnel & Conformité DGI",
      "geo_hook": "Tableaux UBL 2.1 CIUS-MA + Miroirs .md"
    },
    {
      "silo_id": "SILO-02",
      "silo_name": "2. Encyclopédie CGI 2026 & Flux SIMPL",
      "canonical_routes": 32,
      "locales_count": 6,
      "indexed_urls": 192,
      "primary_intent": "AEO Answer-First & Citations IA",
      "geo_hook": "Formules exactes Loi 69-21, RAS-TVA, IS & 9421"
    },
    {
      "silo_id": "SILO-03",
      "silo_name": "3. Explorateur Comptes PCGE / CGNC",
      "canonical_routes": 250,
      "locales_count": 3,
      "indexed_urls": 750,
      "primary_intent": "Longue Traîne Comptable & Étudiants/OEC",
      "geo_hook": "Schéma écriture Débit/Crédit + codeEdi SIMPL-IS"
    },
    {
      "silo_id": "SILO-04",
      "silo_name": "4. Solutions Métiers, OEC & Fisca POS",
      "canonical_routes": 16,
      "locales_count": 6,
      "indexed_urls": 96,
      "primary_intent": "Conversion B2B, CHR/POS & Fiduciaires",
      "geo_hook": "Comparatifs ROI & Caisse Offline 72h"
    },
    {
      "silo_id": "SILO-05",
      "silo_name": "5. Régions Maroc & Subvention Mowakaba",
      "canonical_routes": 12,
      "locales_count": 6,
      "indexed_urls": 72,
      "primary_intent": "SEO Local Maroc & Financement TPME",
      "geo_hook": "Calculateur reste à charge Maroc PME"
    },
    {
      "silo_id": "SILO-06",
      "silo_name": "6. Outils Gratuits Viraux & Migrations ERP",
      "canonical_routes": 14,
      "locales_count": 6,
      "indexed_urls": 84,
      "primary_intent": "Acquisition PLG & Backlinks Naturels",
      "geo_hook": "Audit ICE Excel, Validateur Factur-X & API .md"
    }
  ],
  "totals": {
    "silos_count": 6,
    "canonical_routes": 342,
    "indexed_urls": 1302,
    "free_viral_tools": 6
  }
}
```

### V.2 — Clé de contrôle de l'ICE : numéros réels et exemples de la brochure

<!-- verif:18-02:code -->
```python
# Test the real Moroccan ICE numbers found in official brochure & Moroccan companies!
samples = [
    "003976749000084", # MySunday Sarlau
    "001534290000057", # OCP / Safyr example
    "123456789000057", # Official ICE brochure example 1
    "123456789000131", # Official ICE brochure example 2
]

for s in samples:
    n15 = int(s)
    n13 = int(s[:13])
    key = int(s[13:])
    rem15 = n15 % 97
    calc_key_iso7064 = 97 - ((n13 * 100) % 97)
    # Wait: what if (n13 * 100) % 97 == 0? Then 97 - 0 = 97 -> % 97 = 0 (or 97 can't fit in 2 digits if 97? Wait: 97 fits in 2 digits! Wait: if key is 97, (n13*100 + 97) % 97 == 0! If key is 00, (n13*100 + 0) % 97 == 0!)
    print(f"ICE={s} | n15 % 97 = {rem15} | key={key:02d} | 97 - ((n13*100)%97) = {calc_key_iso7064 % 97:02d}")
```

Résultat du code (réexécution : identique) :

<!-- verif:18-02:resultat -->
```text
ICE=003976749000084 | n15 % 97 = 0 | key=84 | 97 - ((n13*100)%97) = 84
ICE=001534290000057 | n15 % 97 = 0 | key=57 | 97 - ((n13*100)%97) = 57
ICE=123456789000057 | n15 % 97 = 43 | key=57 | 97 - ((n13*100)%97) = 14
ICE=123456789000131 | n15 % 97 = 20 | key=31 | 97 - ((n13*100)%97) = 11
```

### V.3 — Clé de contrôle de l'ICE : six numéros réels supplémentaires

<!-- verif:18-03:code -->
```python
real_ices = [
    "003042032000080", # Comma Solutions Marrakech
    "001548253000095", # Casablanca
    "002390937000044", # Capital Signature SARL
    "000196565000003", # Pneumatique Attacharouk II
    "001585349000028", # Fatourati receipt
    "002598605000093", # Dalia Tamesna
]
for ice in real_ices:
    print(ice, "-> % 97 =", int(ice) % 97)
```

Résultat du code (réexécution : identique) :

<!-- verif:18-03:resultat -->
```text
003042032000080 -> % 97 = 0
001548253000095 -> % 97 = 0
002390937000044 -> % 97 = 0
000196565000003 -> % 97 = 0
001585349000028 -> % 97 = 0
002598605000093 -> % 97 = 0
```
