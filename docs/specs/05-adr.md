<!--
ID canonique : Doc_05_ADR   |   Fichier : docs/specs/05-adr.md
Source : « Document 05 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_05_ADR#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_05_ADR »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 05 — Registre des 12 ADR (Architecture Decision Records)
Ce document consigne les 12 décisions d'architecture structurantes de Fisca (domaine fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Il est découpé en 14 sections nommées prêtes à être importées dans Hyperagent avec la portée Project (Doc_05_ADR) afin d'empêcher tout agent de codage de remettre en cause un choix tranché ou de réintroduire un anti-pattern écarté.
## Section 01 — Matrice de Synthèse & Gouvernance des 12 ADR
Toutes les décisions ci-dessous ont le statut ACCEPTÉ ET VERROUILLÉ. Toute révision ultérieure exige l'ajout d'un nouvel ADR amendant explicitement l'ancien sans jamais écraser l'historique.

| Réf. | Domaine Technique | Décision Retenue | Alternative Écartée | Impact Clé |
|---|---|---|---|---|
| ADR-01 | Frontends & POS | Astro SSR + React/Vite + POS SQLite WASM | Monolithe Next.js unique | SEO rapide et caisse 72h hors-ligne |
| ADR-02 | Multi-Tenancy | Une base Cloudflare D1 dédiée par société | Base SQL unique par colonne tenant | Isolation comptable et export 1 clic |
| ADR-03 | Arithmétique & Séquence | Centimes entiers + Durable Object atomique | Flottants IEEE-754 et auto-incrément | Zéro écart 0,01 MAD ni trou CGI |
| ADR-04 | Fiscalité Évolutive | Moteur AST JSON dynamique via LLM Wiki | Taux et articles CGI codés en dur | Mise à jour légale sans redéploiement |
| ADR-05 | Comptabilité & IS | Grand Livre CGNC immuable + DSL 6 colonnes | Tables mutables et soldes simples | Conformité PAF Art. 145-I et SIMPL-IS |
| ADR-06 | Signature Loi 43-20 | WebCrypto Worker pur + HSM CSC API v2.0 | Binaire C++ xmlsec ou clés USB locales | Zéro clé exposée et latence minimale |
| ADR-07 | Archivage 10 Ans | Paquets AIP R2 EU + Arbre de Merkle quotidien | Jeton TSA RFC 3161 unitaire par pièce | Coût TSA divisé par 50 000 |
| ADR-08 | Confidentialité Cloud | Double mode Cloud Assisté / E2EE + Shamir | Texte clair seul ou E2EE sans séquestre | Recherche HMAC et audit Art. 211 garanti |
| ADR-09 | Validation & OCR | Cloudflare Containers Java/Python + repli TS | Réécriture JS de Schematron ou K8s fixe | Conformité PHIVE/Docling à coût nul au repos |
| ADR-10 | Agents IA & FinOps | Neuro-symbolique + Model Tiering + Hindsight | Agent LLM écrivant directement en SQL | Zéro hallucination et coût divisé par 10 |
| ADR-11 | Intégration ERP | Sage 100 NOLOCK + IPMEncoder/.PNM & Odoo | Écriture SQL directe dans Sage 100 | Garantie éditeur préservée à 100 % |
| ADR-12 | Souveraineté & PRA | Contrat StorageAdapter + Miroir Maroc RPO nul | Appels Cloudflare dispersés sans miroir | Conformité Loi 05-20 et bascule 60s |

L'explorateur interactif ci-dessous regroupe ces 12 décisions par couche architecturale pour visualiser leurs compromis et les garde-fous imposés aux agents Hyperagent.
## Section 02 — ADR-01 : Découplage Astro SSR, React 19 + Hono & POS Offline-First
- Contexte : Fisca doit combiner une indexation SEO/GEO/AEO ultrarapide en 6 langues sur fisca.ma, une interface SaaS haute densité inspirée de Mercury.com (6 langues PME contre 3 langues Fiduciaire/Corporate), une application mobile native et une caisse tactile Fisca POS capable d'encaisser sans internet.
- Alternatives rejetées : Un monolithe Next.js App Router unique alourdit le JavaScript des pages publiques, complique le packaging natif Capacitor et gêne l'isolation d'un moteur SQLite hors-ligne dédié au point de vente.
- Décision retenue : Découpler dans le Monorepo apps/marketing-astro (Astro 5 SSR zéro-JS superflu), apps/web-saas (React 19 + Vite + TanStack Virtual + Capacitor), apps/pos-pwa (React 19 + SQLite WASM persistant sur OPFS + pilotes ESC/POS WebUSB/Bluetooth/IP) et apps/api-hono (API typée sur Workers).
- Compromis & Garde-fous : Partage obligatoire du design system packages/ui-mercury et attribution d'un préfixe matériel unique par caisse afin d'éliminer toute collision de numérotation pendant 72 heures hors-ligne.
## Section 03 — ADR-02 : Isolation Multi-Tenant « Database-per-Tenant » sur Cloudflare D1
- Contexte : Un cabinet comptable marocain gère de 25 à plus de 500 sociétés indépendantes et exige une étanchéité absolue des écritures ainsi qu'une sauvegarde ou réversibilité unitaire instantanée.
- Alternatives rejetées : Une base de données unique partagée avec filtrage logique par colonne tenant_id expose l'ensemble du parc au moindre oubli de clause WHERE et empêche l'export natif du fichier SQLite d'un seul dossier contrôlé par la DGI.
- Décision retenue : Provisionner une base SQLite Cloudflare D1 dédiée par société cliente dès le forfait Solo (129 MAD HT/mois), orchestrée par une base maîtresse CONTROL_PLANE_DB en juridiction Union Européenne, avec option Cloudflare Hyperdrive vers PostgreSQL au Maroc pour les Grands Comptes.
- Compromis & Garde-fous : Mise en œuvre d'un orchestrateur de migrations par lots de 50 bases (Rolling Schema Migrator) avec mise à niveau Just-in-Time à la connexion, et résolution du binding D1 exclusivement côté serveur.
## Section 04 — ADR-03 : Arithmétique Monétaire Entière & Séquenceur Durable Object
- Contexte : Le validateur Schematron de xHub et les parseurs XSD SIMPL rejettent tout écart d'arrondi d'un centime, tandis que l'Article 145 du CGI impose une numérotation chronologique ininterrompue même sous forte concurrence.
- Alternatives rejetées : Les nombres à virgule flottante JavaScript (number flottant sujet aux dérives binaires) et les séquences AUTOINCREMENT SQLite qui créent des trous définitifs lors de l'annulation d'une transaction.
- Décision retenue : Stocker et calculer tous les montants en centimes entiers (100,00 MAD = 10000), les taux en points de base (20 % = 2000), les quantités en milli-unités et les cours BAM en micro-unités, et confier la numérotation ainsi que le chaînage PIH SHA-256 à un InvoiceSequencerDO atomique par société.
- Compromis & Garde-fous : Le Durable Object sépare le compteur d'essais techniques du numéro fiscal certifié afin qu'un rejet de validation xHub ne brise jamais la séquence ni la chaîne cryptographique.
## Section 05 — ADR-04 : Moteur Fiscal Déclaratif (AST JSON) Alimenté par le LLM Wiki
- Contexte : La fiscalité marocaine évolue chaque année via la Loi de Finances et les Notes Circulaires de la DGI (comme la suppression des taux de TVA de 7 % et 14 % en 2026 au profit des seuls taux de 20 %, 10 % et 0 %, ou l'ajout du tableau des loyers dans la DRVT v2.0.3).
- Alternatives rejetées : Coder en dur les taux, seuils (espèces 5 000 MAD, RAS-TVA 75 %/100 %, seuil 80 000 MAD AE) et schémas d'écritures dans des fichiers TypeScript figés qui imposent de redéployer le code et compliquent l'audit d'exercices passés.
- Décision retenue : Déporter 100 % des règles fiscales, modèles d'écritures PCGE et mappings de balises XML dans des tables déclaratives D1/KV exécutées par un interpréteur d'arbres AST déterministe et alimentées par le compilateur du LLM Wiki.
- Compromis & Garde-fous : Toute nouvelle règle compilée depuis le Wiki doit générer 3 cas de tests contradictoires Vitest vérifiés mathématiquement et tourner en mode observation avant activation par un administrateur.
## Section 06 — ADR-05 : Grand Livre CGNC Immuable, TVA Encaissement & DSL SIMPL-IS
- Contexte : La Loi de Finances 2026 (Art. 145-I CGI) et l'Article 211 du CGI imposent une comptabilité électronique inaltérable avec Piste d'Audit Fiable, suivi de la TVA sur encaissement et génération d'une liasse SIMPL-IS v2.0.3 de plus de 1 500 cellules bouclées.
- Alternatives rejetées : Des écritures modifiables par UPDATE ou DELETE, l'inscription directe en TVA déclarable avant paiement, et le calcul du Bilan/Tableaux de flux depuis une balance simple à 2 colonnes.
- Décision retenue : Verrouiller les pièces POSTED par triggers SQLite levant une erreur PAF (correction par contre-passation seule) avec chaînage SHA-256, loger la TVA non réglée dans les comptes d'attente 44558 et 34558 jusqu'au lettrage bancaire, et évaluer la liasse IS via un DSL déclaratif à 5 opérateurs sur une balance à 6 colonnes.
- Compromis & Garde-fous : L'Actif Net est toujours calculé par soustraction entre cellules (Cellule_Brut - Cellule_Amort) pour éviter tout écart horizontal, et tout décaissement rendant la caisse 5161 créditrice est bloqué.
## Section 07 — ADR-06 : Signature Qualifiée Loi 43-20 en WebCrypto Pur via CSC API v2.0
- Contexte : Les factures UBL 2.1 et Factur-X soumises au Clearance xHub doivent recevoir un cachet électronique qualifié XAdES/PAdES et un horodatage RFC 3161 délivrés par un PSCE agréé DGSSI comme Barid eSign.
- Alternatives rejetées : Utiliser des clés cryptographiques USB physiques (inexploitables en SaaS multi-tenant), stocker des clés privées clientes sur disque cloud, ou compiler la librairie C++ xmlsec dans les Workers.
- Décision retenue : Exécuter la canonisation C14N11 et les condensats SHA-256 nativement dans le Worker via crypto.subtle (WebCrypto), signer le hash à distance sur le HSM qualifié Barid eSign via le standard CSC API v2.0 (/csc/v2/signatures/signHash) et encapsuler le jeton RFC 3161 ASN.1 DER.
- Compromis & Garde-fous : Avant chaque appel HSM, le moteur contrôle que l'attribut OID 2.5.4.97 ou 2.5.4.5 du certificat X.509 correspond exactement à l'ICE ou à l'IF de la société émettrice.
## Section 08 — ADR-07 : Coffre-Fort Probant 10 Ans Scellé par Arbre de Merkle Quotidien
- Contexte : L'Article 211 du CGI impose 10 ans de conservation intègre après clôture ; acheter un jeton d'horodatage qualifié RFC 3161 individuel (environ 0,20 MAD) sur 50 000 pièces mensuelles coûterait 10 000 MAD/mois d'OPEX pur.
- Alternatives rejetées : Un simple stockage objet sans scellement temporel qualifié (rejetable lors d'un contrôle fiscal) ou l'horodatage TSA unitaire qui ruine la marge sur les forfaits à 69 et 129 MAD.
- Décision retenue : Empaqueter chaque document et le hash de son écriture comptable dans une archive OAIS AIP (ISO 14641) chiffrée AES-256-GCM sur Cloudflare R2 (jurisdiction = "eu", WORM 10 ans), agréger tous les hash du jour dans un Arbre de Merkle SHA-256 horodaté par un seul jeton RFC 3161 quotidien (coût ramené à 15 MAD/mois), et appliquer un ré-horodatage SHA-512 tous les 24 mois.
- Compromis & Garde-fous : Chaque ligne conserve son chemin de preuve JSON (merkle_proof_json) permettant à un vérificateur DGI de prouver mathématiquement l'antériorité d'une seule pièce sans exposer celles des autres clients.
## Section 09 — ADR-08 : Double Mode E2EE Zero-Trust, Blind Index & Séquestre de Shamir
- Contexte : La plateforme manipule des données hautement sensibles (salaires nominatifs de l'État 9421, honoraires DRVT, loyers, secrets commerciaux) soumises à la Loi 09-08 (CNDP) et aux exigences des banques et OIV, tout en devant rechercher des ICE en SQL et répondre aux réquisitions de l'Article 211 du CGI.
- Alternatives rejetées : Le chiffrement passif seul (opérateur cloud capable de lire la base) ou le chiffrement E2EE naïf côté client qui casse les requêtes SQL de dédoublonnage et bloque définitivement le dossier si le gérant perd son mot de passe.
- Décision retenue : Offrir un double mode : Cloud Assisté par défaut (pour l'autonomie nocturne des agents IA) et Zero-Knowledge E2EE via E2eeFiscalCryptoEngine combinant enveloppes RSA-OAEP-256 multi-acteurs (tenant_key_grants pour dirigeant, fiduciaire révocable en 1 clic et agent ERP), liaison de contexte AAD, Blind Indexing HMAC-SHA256 128 bits, déchiffrement RAM éphémère HPKE (RFC 9180) inférieur à 15 ms, et séquestre fiscal par Partage de Secret de Shamir (2-sur-3).
- Compromis & Garde-fous : Ajout systématique de colonnes d'index aveugles pour les clés fiscales et anonymisation PII réversible en RAM avant tout appel vers un modèle IA externe.
## Section 10 — ADR-09 : Conteneurs Isolés Java/Python & Repli Natif TypeScript
- Contexte : Les briques certifiées de validation UBL/Schematron (ph-ubl, PHIVE), de génération Factur-X PDF/A-3 (Mustangproject), d'extension PAdES-LTA (esig/dss) et d'extraction tabulaire (Docling) requièrent un environnement Java 21 ou Python 3.12.
- Alternatives rejetées : Réimplémenter artisanalement des milliers de règles Schematron EN 16931 en JavaScript ou payer en continu des serveurs dédiés externes hors du réseau Cloudflare.
- Décision retenue : Exécuter ces moteurs officiels dans des microVMs Cloudflare Containers (fiscal-java, docling-python, camel-bridge) réveillées à la demande par RPC interne, doublées d'un constructeur UBL 2.1 / XML-DSig natif TypeScript servant de mode de secours instantané et d'outil de test local léger.
- Compromis & Garde-fous : Maintien de tests de conformité croisés garantissant que le mode de secours TypeScript respecte 100 % des balises obligatoires validées par PHIVE et xmllint.
## Section 11 — ADR-10 : Agents Neuro-Symboliques, Model Tiering FinOps & Hindsight
- Contexte : Utiliser un grand modèle de langage pour chaque pièce comptable coûte environ 4 000 EUR/mois pour 10 000 analyses et expose les dossiers à des montants complétés à tort ou à des causes de variations inventées.
- Alternatives rejetées : Agents IA purement génératifs autorisés à modifier le Grand Livre sans revue humaine ou facturation de crédits IA par clic à l'utilisateur.
- Décision retenue : Appliquer une architecture neuro-symbolique routée sur 3 niveaux (Model Tiering) : Niveau 0 déterministe gratuit (75 % des flux XML/relevés/calculs), Niveau 1 modèles spécialisés rapides (Clairic, Qwen2.5-VL, Nanonets-OCR-s, AtlasOCR, Clef-flash), Niveau 2 raisonnement sur escalade seule ; dotée de la mémoire auto-apprenante Hindsight et des 4 règles d'arrêt AI Crafters.
- Compromis & Garde-fous : Toute sortie IA demeure une proposition soumise au circuit de visa humain à 3 niveaux du cabinet, avec canMutateLedgerDirectly: false gravé dans le code.
## Section 12 — ADR-11 : Connecteurs ERP Non-Intrusifs (Sage 100 IPMEncoder/.PNM & Odoo)
- Contexte : Les fiduciaires et PME/ETI marocaines utilisent massivement Sage 100 sur SQL Server et Odoo (l10n_ma), où un INSERT SQL direct dans F_ECRITUREC déséquilibre les tables de cumuls internes de Sage et fait perdre le support éditeur.
- Alternatives rejetées : Écrire directement en SQL dans les tables comptables de Sage 100, ou imposer l'achat de la licence payante Objets Métiers aux petites fiduciaires qui n'en disposent pas.
- Décision retenue : Déployer un agent hybride C# .NET 8 (Sage100EdgeAgent) qui extrait les écritures et lettrages en lecture rapide WITH (NOLOCK) sur cbMarq, et réinjecte les pièces exclusivement via le processus transactionnel officiel IPMEncoder (Objets100cLib) ou par génération universelle de fichiers .PNM à 108 caractères fixes ; et fournir pour Odoo v17–v20 le module Python l10n_ma_edi_clearance branché sur le lettrage temps réel.
- Compromis & Garde-fous : File tampon SQLite locale intégrée à l'agent Windows pour tolérer toute coupure internet du serveur client sans perte de synchronisation.
## Section 13 — ADR-12 : Adaptateur de Portabilité Souveraine & Failback à Perte Nulle
- Contexte : SYNAPTIC SYSTEMS SARL AU doit protéger la plateforme contre toute indisponibilité cloud régionale, éviter le verrouillage fournisseur et répondre à la Loi 05-20 de la DGSSI qui impose un hébergement physique sur le sol marocain pour les OIV et entités publiques.
- Alternatives rejetées : Appeler directement les bindings propriétaires D1/R2/Queues dans tout le code métier, ou basculer le DNS vers un serveur secondaire sans protocole strict de réconciliation des chaînes de hachage.
- Décision retenue : Isoler toutes les entrées/sorties derrière l'interface FiscaInfrastructureAdapter supportant deux pilotes interchangeables (CLOUDFLARE_EDGE actif par défaut et SOVEREIGN_MOROCCO_VPS sur PostgreSQL 16 + MinIO WORM + BullMQ hébergé au Maroc), alimenté en continu par des enveloppes signées SignedReplicationDelta et doté d'un pont HTTP de retour (Failback) avec gel d'écriture de 5 secondes garantissant une perte nulle (RPO égal à zéro).
- Compromis & Garde-fous : Interdiction d'utiliser des extensions SQL propriétaires non portables entre SQLite D1 et PostgreSQL 16 dans les requêtes du cœur métier.
## Section 14 — Traduction Exécutable des 12 ADR dans le Harnais de Code
Lors de la Session S0, l'agent orchestrateur installe ce module de garde déterministe dans le package des types partagés afin que toute violation des ADR-02, ADR-03, ADR-06, ADR-08, ADR-10 ou ADR-11 échoue immédiatement à la compilation ou aux tests unitaires :

```ts
/**
 * Garde-fous d'exécution et de compilation verrouillant les invariants des 12 ADR de Fisca
 */
export const FISCA_ADR_INVARIANTS = {
  // ADR-03 : Vérifie à l'exécution qu'un montant en centimes ou un taux en BPS est un entier sûr strict
  assertSafeIntegerAmount(value: number, label: string): number {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `ADR_03_FLOAT_FORBIDDEN: [${label}] doit être un entier exact en centimes/bps (reçu: ${value}).`
      );
    }
    return value;
  },

  // ADR-04 : Vérifie la réforme TVA 2026 par défaut tout en laissant le moteur AST gérer les millésimes antérieurs
  assertValidVatRateForIssueYear(vatRateBps: number, issueDateIso: string): void {
    const year = Number.parseInt(issueDateIso.slice(0, 4), 10);
    if (year >= 2026 && vatRateBps !== 2000 && vatRateBps !== 1000 && vatRateBps !== 0) {
      throw new Error(
        `ADR_04_LF2026_VAT_VIOLATION: Taux ${vatRateBps} bps interdit à partir de 2026 (seuls 2000, 1000 et 0 sont admis).`
      );
    }
  },

  // ADR-06 : Vérifie que le certificat X.509 Barid eSign porte bien l'ICE ou l'IF de la société émettrice
  assertCertificateMatchesEmitter(certSubjectDn: string, emitterIce: string, emitterIf: string): void {
    const normalized = certSubjectDn.replace(/\s+/g, "").toUpperCase();
    const hasIce = emitterIce.length === 15 && normalized.includes(emitterIce);
    const hasIf = emitterIf.length >= 6 && normalized.includes(emitterIf);
    if (!hasIce && !hasIf) {
      throw new Error(
        `ADR_06_LOI4320_CERT_MISMATCH: Le SubjectDN du certificat qualifié ne correspond ni à l'ICE (${emitterIce}) ni à l'IF (${emitterIf}).`
      );
    }
  },

  // ADR-02 & ADR-10 : Interdit tout paramètre tenant_id dans un schéma d'outil exposé au LLM ou à MCP
  assertSafeMcpToolSchema(toolName: string, parameterKeys: readonly string[]): void {
    const forbidden = ["tenantId", "tenant_id", "companyId", "company_id", "d1DatabaseId"];
    for (const key of parameterKeys) {
      if (forbidden.includes(key)) {
        throw new Error(
          `ADR_02_10_TENANT_LEAK_RISK: L'outil IA [${toolName}] ne doit jamais accepter [${key}] depuis le modèle.`
        );
      }
    }
  },

  // ADR-11 : Bloque toute requête SQL d'écriture directe vers les tables internes Sage 100
  assertReadOnlySageSql(sqlQuery: string): void {
    const upper = sqlQuery.toUpperCase();
    if (/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE)\b/.test(upper)) {
      throw new Error(
        "ADR_11_SAGE100_CORRUPTION_GUARD: Écriture SQL directe interdite sur Sage 100. Utilisez IPMEncoder ou l'export .PNM."
      );
    }
  },
} as const;
```
