<!--
ID canonique : Doc_01_PRD   |   Fichier : docs/specs/01-prd.md
Source : « Document 01 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_01_PRD#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_01_PRD »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 01 — PRD Maître Fisca (Product Requirements Document)
Ce document constitue le référentiel fonctionnel et produit de Fisca (domaine fisca.ma), édité par la société SYNAPTIC SYSTEMS SARL AU (siège social et compétence juridictionnelle : Tribunal de Commerce de Rabat, Maroc). Il est structuré en 12 sections nommées prêtes à être importées dans Hyperagent avec la portée Project.
## Section 01 — Vision Produit, Positionnement & Cadre Réglementaire
Fisca est une plateforme SaaS souveraine tout-en-un de facturation électronique certifiée, de comptabilité électronique immuable, de télédéclaration fiscale EDI et d'intelligence financière neuro-symbolique destinée au marché marocain. Elle unifie dans une architecture découplée et mobile-first les besoins des Auto-Entrepreneurs, des TPE/PME, des Cabinets Comptables (Fiduciaires membres de l'OEC) et des Grandes Entreprises.

| Texte Réglementaire | Autorité Marocaine | Impact Produit Structurant dans Fisca |
|---|---|---|
| Art. 145 (I à IX) CGI | DGI (MEF) | Facturation Clearance xHub et tenue électronique obligatoire (LF 2026) |
| Art. 91, 92 & 99 CGI | DGI (LF 2026) | Suppression des taux 7 % et 14 % ; maintien exclusif de 20 %, 10 % et 0 % |
| Art. 210 & 211 CGI | DGI & CNC | Archivage probant WORM 10 ans et audit informatisé FEC-MA / SAF-T |
| Loi n° 43-20 | DGSSI | Cachet et signature qualifiés XAdES/PAdES et horodatage Barid eSign |
| Loi n° 69-21 | MCINET & DGI | Délais de paiement 60/120/180j, amendes BAM et EDI trimestriel |
| Lois 09-08 & 05-20 | CNDP & DGSSI | Protection PII, juridiction UE adéquate et option souveraine Maroc |
| Loi n° 103-12 | Bank Al-Maghrib | Courtage technologique d'escompte sans encaissement pour autrui |

La conception du produit obéit à cinq invariants non négociables :
- Découplage Front/App : Le portail public SEO/GEO/AEO tourne sous Astro SSR ultra-rapide, séparé de l'application métier React 19, Vite, API Hono et coque mobile native Capacitor.
- Isolation Database-per-Tenant : Chaque entreprise cliente dispose de sa propre base SQLite Cloudflare D1 dédiée dès le forfait d'entrée Solo, orchestrée par une base maîtresse Control Plane.
- Zéro Règle Fiscale Codée en Dur : Aucun taux, seuil, compte comptable ni chemin XML n'est figé dans le code ; tout est exécuté par un moteur AST déclaratif alimenté par le LLM Wiki.
- Séparation IA / Déterminisme : Les modèles IA extraient et qualifient en JSON typé, tandis que 100 % des calculs monétaires s'exécutent en centimes entiers et points de base dans du code déterministe.
- Transparence Tarifaire Sans Quotas IA : Aucun compteur de crédits OCR ni devis par clic n'est affiché ; toute l'intelligence documentaire s'exécute automatiquement en arrière-plan.
## Section 02 — Personas Cibles, Surfaces & Politique Linguistique
L'application sert cinq profils d'utilisateurs distincts aux droits et interfaces adaptés :
- P1 — Auto-Entrepreneur & Freelance : Émet ses devis et factures sans TVA (Art. 91), surveille son plafond annuel (200 000 ou 500 000 MAD) et suit le seuil critique de 80 000 MAD par client.
- P2 — Dirigeant de TPE, PME & Entreprise BTP : Pilote sa facturation xHub, ses décomptes de chantier, sa trésorerie prévisionnelle à 90 jours et sa TVA du 20 du mois depuis mobile ou WhatsApp.
- P3 — Expert-Comptable (OEC) & Collaborateur Fiduciaire : Gère des dizaines ou centaines de sociétés isolées en marque blanche, automatise la collecte, révise par cycles et produit toutes les liasses EDI SIMPL.
- P4 — DAF, Chef Comptable & Achats Grand Compte : Connecte son ERP (SAP, Sage X3, Oracle, Odoo), automatise le rapprochement tripartite, audite ses contrats BPU, sécurise les RIB et pilote l'escompte 48h.
- P5 — Commissaire aux Comptes (CAC) & Vérificateur DGI : Inspecte en lecture seule les pistes d'audit ISA 230/500, vérifie les preuves d'arbre de Merkle et télécharge le pack légal Art. 211 CGI.
La gouvernance linguistique sépare strictement les surfaces grand public/PME des espaces institutionnels :

| Surface Applicative | Langues Actives | Règle d'Écriture & Repli Terminologique Fiscal |
|---|---|---|
| Site Public Astro | 6 langues | FR, AR, Darija arabe, Tamazight Latin/Tifinagh IRCAM, EN |
| App Solo, TPE & PME | 6 langues | Repli Darija vers AR DGI ; Tamazight vers FR CGI / IRCAM |
| Portail Fiduciaire OEC | 3 langues | Français, Arabe classique (RTL) et Anglais uniquement |
| Portail Grand Compte | 3 langues | Français, Arabe classique (RTL) et Anglais uniquement |
| Factures Factur-X | Bilingue FR/AR | Français à gauche, Arabe à droite, arrêté en lettres double |

- Convention Darija (alphabet arabe RTL) : Les actions courantes sont en Darija naturelle tandis que les notions fiscales utilisent le terme officiel en Arabe classique de la DGI suivi du sigle majuscule (ICE, IF, TVA).
- Convention Tamazight IRCAM (Latin et Tifinagh) : En script latin, les termes comptables intraduisibles restent en Français officiel ; en Tifinagh, les sigles latins sont conservés avec une infobulle bilingue FR/AR.
- Limitation vocale WhatsApp V1 : Les notes vocales WhatsApp sont transcrites en Darija, Arabe, Français et Anglais, mais refusées proprement en Tamazight avec invitation à photographier la pièce ou écrire au clavier.
## Section 03 — Pilier 1 : Facturation Clearance xHub, Cas Maroc & Signature Loi 43-20
Le module d'émission couvre l'intégralité du cycle commercial et fiscal conforme à l'Article 145 du CGI et au standard OASIS UBL 2.1 / EN 16931 :
- Onboarding ICE en 90 secondes : La saisie de l'ICE à 15 chiffres (vérifié par clé Modulo 97) ou du nom pré-remplit raison sociale FR/AR, IF, RC, Tribunal, Taxe Pro, adresse ADC450, forme juridique et capital social.
- Validation intelligente des identifiants : L'ICE, l'IF et la Taxe Professionnelle sont requis pour tous ; le RC n'est bloquant que pour les sociétés commerciales et commerçants, et la CNSS est optionnelle sans salarié.
- Séquenceur atomique et chaînage PIH : Un Durable Object par société garantit une numérotation sans trou par type de pièce et scelle le hash SHA-256 précédent (PIH) ainsi que le compteur monotone ICV.
- Couverture documentaire complète : Gestion des devis signés par OTP en 1 clic, bons de commande, factures (code UBL 380), avoirs liés à l'UUID d'origine (381), notes de débit (383), acomptes (386) et autofacturation (389).
- Application stricte de la réforme TVA 2026 : Seuls les taux de 20 %, 10 % et 0 % (avec motif légal obligatoire) sont autorisés par ligne avec tableau récapitulatif par taux ; tout import à 7 % ou 14 % propose sa conversion légale.
- Cas particuliers métiers marocains : Prise en charge native des débours hors TVA (comptes 3488/4488), des décomptes BTP avec retenue de garantie 7 %/10 % (TVA différée à la libération), du timbre espèces 0,25 % et de la RAS-TVA 75 %/100 %.
- Flux E-Reporting B2C quotidien : Génération d'un récapitulatif journalier électronique des ventes aux particuliers sans ICE par taux de TVA afin d'assurer une réconciliation exacte avec SIMPL-TVA et le CPC.
- Signature Loi 43-20 et Coffre Merkle 10 ans : Validation ph-ubl / PHIVE, PDF/A-3 Mustangproject, signature WebCrypto via CSC API v2.0 Barid eSign (contrôle OID X.509) et scellement R2 UE dans un Arbre de Merkle quotidien.
- Cycle de vie à 8 statuts et paiement direct : Suivi normalisé de DEPOSEE jusqu'à ENCAISSEE, avec lien de paiement Payzone / Fatourati qui solde la facture, fige le compteur Loi 69-21 et active la TVA sur encaissement.
## Section 04 — Pilier 2 : Comptabilité Électronique Immuable (CGNC) & Collecte Omnicanale
Conformément à l'Article 145-I modifié par la Loi de Finances 2026, Fisca opère un véritable Grand Livre en partie double nativement scellé :
- Collecte omnicanale zéro saisie : Réception des pièces par glisser-déposer en vrac, scanner mobile, WhatsApp Business, adresse dédiée @ingest.fisca.ma et récupération des grands facturiers (IAM, Orange, inwi, SRM, Jawaz).
- Cascade d'extraction haute précision : Lecture directe du XML embarqué sur Factur-X/UBL, sinon extraction par Docling (tableaux multi-pages), Clairic, Nanonets-OCR-s (tampons et signatures) et AtlasOCR.
- Grand Livre CGNC inaltérable : Plan comptable marocain Classes 1 à 8, journaux auxiliaires séparés (AN, ACH, VTE, BNQ, CAI, OD), équilibre atomique Débit égal Crédit et triggers SQLite interdisant tout UPDATE ou DELETE sur statut POSTED.
- Mécanique TVA sur encaissement : Inscription initiale dans les comptes d'attente (44558 collectée, 34558 récupérable) et bascule automatique VAT_CLEARING au prorata du règlement effectif ou de l'échéance d'effet LCN.
- Plafond espèces Art. 11-II CGI : Au-delà de 5 000 MAD TTC par jour ou 50 000 MAD TTC par mois et par fournisseur, l'écriture d'achat est automatiquement scindée pour isoler le HT non déductible à l'IS et exclure la TVA excédentaire.
- Notes de frais et immobilisations : Génération couplée de l'Ordre de Mission justificatif pour chaque note de frais, et suivi automatisé des immobilisations de Classe 2 (plafond auto 400 000 MAD TTC) avec dotations annuelles.
- Rapprochement bancaire universel Maroc : Lecture des relevés PDF, CSV, CFONB 120, MT940 et ISO 20022 camt.053 de toutes les banques marocaines, avec mise en suspens obligatoire (3497/4497) de tout rapprochement ambigu.
## Section 05 — Pilier 3 : Usine EDI Fiscale SIMPL, Subtilités CGI & Contrôle Art. 211
Le Grand Livre et ses sous-livres fiscaux génèrent sans ressaisie tous les fichiers XML/ZIP conformes aux schémas XSD officiels de la DGI :

| Téléservice / Audit DGI | Version / Référence | Particularité Technique Automatisée dans Fisca |
|---|---|---|
| SIMPL-TVA Déductions | XSD Annexe v4.0 | Balise <prorata> insérée entre <tx> et <mp>, anti-doublon IF |
| SIMPL-TVA RAS | RDRS v1.0 & Versement | Double flux XML (créance fournisseur et reversement mensuel client) |
| SIMPL-IS Liasse | XSD v2.0.3 (4 modèles) | 1 500+ codeEdi sur balance 6 colonnes, Tableau 3 auto-alimenté |
| SIMPL-IS Annexes | Art. 20-I & DRVT v2.0.3 | Ventes B2B cadrées CPC, RAS 5 %/10 %, loyers TSC 10 %/15 %, imputation IS |
| SIMPL-IR Paie | État 9421 Annuel | XML civil non zippé, 10 collections, <numPPR/>, cadrage 6171/44525 |
| SIMPL Loi 69-21 | Modèle ADC500B-23I | Calcul sur service_delivery_date, gel litiges R2, amende Math.ceil |
| Contrôle Art. 211 | FEC-MA 24 col. & SAF-T | Journal AN en tête, double hash SHA-256 et notice descriptive signée |

Les sept subtilités avancées suivantes du CGI et du CGNC sont contrôlées en continu :
- Prestations étrangères (Art. 15 & 115 CGI) : Détection des factures de fournisseurs non-résidents en devises avec écriture d'auto-liquidation TVA 20 % et provisionnement de la RAS IS 10 % avant virement.
- Prorata de TVA et régularisations (Art. 104 & 113 CGI) : Calcul annuel du prorata des assujettis partiels, régularisation par cinquième sur 5 ans si variation supérieure à 5 points, et alerte cession avant 60 mois.
- Forclusion TVA à 12 mois (Art. 204 bis CGI) : Compte à rebours dès la date de paiement alertant à 10 mois et verrouillant la déduction au-delà de 12 mois pour éviter l'amende fiscale de 15 %.
- Écarts de conversion en devises (CGNC) : Provisionnement comptable des pertes latentes (3701 vers 6393), réintégration fiscale au Tableau 3 des gains latents (4701) et extourne automatique au 1er janvier.
- Cotisation Minimale précise (Art. 144 CGI) : Calcul continu à 0,25 %, 0,15 % ou taux libéral en excluant strictement les comptes 713, 714 et 719, avec suivi des 36 premiers mois d'exonération.
- Avoirs vs Escomptes (CGNC) : Imputation obligatoire sur comptes soustractifs à terminaison 9 (7119/6119) pour les avoirs commerciaux et en classe financière (6386/7386) pour les escomptes de règlement.
- Boucliers anti-rejet de comptabilité : Blocage temps réel d'une caisse 5161 créditrice, alerte immédiate sur compte courant d'associé 3463 débiteur et obligation de solder 3497/4497 avant clôture.
## Section 06 — Pilier 4 : Portails Fiduciaires, Grands Comptes, Connecteurs ERP & FactorFlow
- Espace Fiduciaire en Marque Blanche : Domaine personnalisé cabinet, sélecteur rapide Cmd+K, vue compacte haute densité 28px, relance WhatsApp autonome le 10 du mois et visa hiérarchique en 3 niveaux sur 5 cycles.
- Contrôle Interne Grands Comptes : Rapprochement automatique 3-Way Matching supportant plusieurs bons de livraison pour une facture récapitulative (N-to-1), écritures de Cut-Off (FNP 4417, CCA 3491) et matrice SoD.
- LLM Wiki Contrats & Diffusion Externe : Compilation des contrats fournisseurs BPU pour bloquer toute surfacturation, détecter les remises de fin d'année (RFA) atteintes et pousser les alertes sur WhatsApp, Teams, Slack et Power BI OData.
- Anti-fraude RIB & ISO 20022 : Vérification Modulo 97 du RIB marocain à 24 chiffres contre le référentiel fournisseur ; tout changement exige une double signature DAF avant export du virement groupé pain.001.
- Connecteurs ERP bidirectionnels inclus dès la V1 : Module Python Odoo v17–v20 (l10n_ma_edi_clearance), service Windows C# .NET 8 Sage 100 (WITH NOLOCK + écriture sûre IPMEncoder ou .PNM 108 car.), et pont Apache Camel + Hyperdrive.
- FactorFlow Maroc & Scoring KYB : Curseur d'escompte dynamique 48h négociable (prorata temporis + avoir UBL 381 automatique), routage multi-factors bancaires avec registre anti-double mobilisation et fiche propriétaire de Scoring IA Fournisseur avec inspection forensique et vérification par navigateur headless des attestations DGI/CNSS.
## Section 07 — Flotte des 11 Agents IA, Auto-Évolution Wiki & Serveur MCP
La couche agentique combine la méthode en 6 repères d'AI Crafters, la mémoire auto-apprenante à 3 niveaux Hindsight et l'orchestration nocturne observe-first :
- Les 5 Agents Cœur : Préparation des écritures, Rapprochement bancaire, Contrôle continu des écarts, Préparation du dossier de clôture comparative N/N-1 et Suivi des impayés / Loi 69-21.
- Les 6 Agents Spécialisés + Guichet AP : Réception BL, Recherche RAG de justificatifs, Hygiène référentiel tiers ICE, Écarts budgétaires, Import-Export (DUM/change), Pièces fournisseurs incomplètes et répondeur statut paiement.
- Les 4 Règles d'Arrêt Métier Obligatoires : Interdiction de compléter un montant illisible, blocage de tout lettrage ambigu, interdiction d'inventer la cause d'une variation et vérification du dernier échange email/message avant relance client.
- Auto-détection de nouvelles règles depuis le LLM Wiki : Dès l'ajout d'une circulaire ou loi dans le Wiki, le compilateur détecte les nouveautés via Clef-flash, génère la règle AST JSON accompagnée de 3 tests contradictoires Vitest et simule son impact en silence avant approbation administrateur.
- Serveur MCP Stateless & Connecteur Meta Muse : Exposition sécurisée sur mcp.fisca.ma/mcp via createMcpHandler et OAuth 2.1, classifiant chaque outil en Read, Non-Sensitive Write ou Sensitive Write avec confirmation humaine et aucun outil de transfert d'argent.
## Section 08 — User Stories Critiques & Critères d'Acceptation

| ID Story | Persona | Action Clé | Résultat Mesurable Attendu |
|---|---|---|---|
| US-01 | PME / TPE | Émettre une facture B2B bilingue | Numéro DO sans trou, UBL valide PHIVE, signature Loi 43-20 en moins de 3s |
| US-02 | Fiduciaire | Importer 100 achats dont espèces 6 200 MAD | Scission auto Art. 11-II sur les 1 200 MAD excédentaires, compte PCGE proposé |
| US-03 | Fiduciaire | Lettrer un relevé bancaire marocain | Déclenchement VAT_CLEARING (34558 vers 34552) et ZIP SIMPL-TVA v4 conforme |
| US-04 | Fiduciaire | Clôturer un exercice annuel IS + Paie | Liasse SIMPL-IS v2.0.3 bouclée au centime, DRVT, 9421 et FEC-MA 24 colonnes |
| US-05 | DAF Groupe | Recevoir 1 facture liée à 4 BL et 1 BPU | Validation N-to-1, alerte si écart prix BPU ou RIB modifié, virement pain.001 |
| US-06 | Vendeur PME | Demander un paiement anticipé à J+2 | Calcul prorata temporis exact, verrou anti-double cession et avoir UBL 381 |

## Section 09 — Gestion des Cas Limites (Edge Cases)
- Rejet de facture par xHub DGI : Si la plateforme centrale rejette une soumission pour donnée tiers invalide, le compteur d'essai s'incrémente mais le numéro séquentiel fiscal et la chaîne PIH SHA-256 restent intacts jusqu'à validation effective.
- Paiement partiel sur facture multi-taux ou RAS-TVA : Lorsqu'un client ne règle que 40 % d'une facture mêlant TVA 20 % et 10 % avec RAS-TVA 75 %, le moteur ventile l'exigibilité TVA et la créance RAS proportionnellement à chaque base en centimes entiers avec ajustement du centime résiduel sur la ligne majeure.
- Cumul mensuel espèces multi-factures : Neuf factures en espèces de 4 800 MAD TTC chacune chez le même fournisseur le même mois sont individuellement sous 5 000 MAD, mais le moteur détecte le franchissement du plafond mensuel de 50 000 MAD TTC dès la onzième facture et scinde la fraction excédentaire.
- Révocation d'un cabinet comptable sous E2EE : Lorsqu'une PME change de fiduciaire, la révocation de l'entrée EXTERNAL_CPA dans tenant_key_grants coupe immédiatement l'accès du cabinet sortant sans avoir à rechiffrer les archives décennales R2.
- Indisponibilité du dirigeant lors d'un contrôle Art. 211 : En mode Zero-Knowledge E2EE, la combinaison de 2 parts sur 3 du séquestre de Shamir (DGI_AUDIT_ESCROW) permet de restituer légalement le FEC-MA déchiffré à l'inspecteur vérificateur.
## Section 10 — Exclusions Strictes (Out-of-Scope & Frontières Légales)
Afin de protéger SYNAPTIC SYSTEMS SARL AU sur les plans réglementaire, pénal et opérationnel, les éléments suivants sont formellement exclus du produit :
- Zéro intermédiation de fonds ni crédit sur bilan propre : Fisca n'encaisse jamais l'argent des factures pour le compte d'autrui (les flux Payzone/Fatourati vont directement sur le compte marchand du vendeur) et ne finance aucune facture sur sa trésorerie propre (Loi bancaire 103-12).
- Zéro exercice illégal de la profession comptable : Fisca fournit un moteur logiciel d'automatisation mais ne signe aucun rapport de certification ni visa relevant du monopole légal des membres de l'Ordre des Experts-Comptables (Loi 15-89).
- Zéro revente brute des PDF officiels OMPIC : Le cache inter-clients commercialise uniquement le Rapport de Scoring & Solvabilité Propriétaire Fisca calculé par nos modèles, sans jamais revendre à des tiers la copie PDF estampillée par l'OMPIC.
- Zéro écriture définitive ou télédépôt sans humain : Aucun agent IA n'est autorisé à passer seul une écriture au statut immuable POSTED ni à transmettre automatiquement une déclaration fiscale définitive sans validation humaine explicite.
- Exclusions matérielles et vocales V1 : Pas de fabrication ni commercialisation de caisses physiques matérielles, et pas de reconnaissance vocale WhatsApp en langue Tamazight en V1.
## Section 11 — Modèle Commercial Synthétique & Objectifs de Performance
Le détail technique des quotas et du moteur de facturation figure au Document 03 ; l'offre s'articule autour de quatre piliers :
- Offres Directes PME (6 langues, essai Sandbox 14j) : Fisca Solo AE à 129 MAD HT/mois, Fisca Essentiel TPE à 390 MAD HT/mois et Fisca Croissance PME à 890 MAD HT/mois (2 mois offerts en annuel, Pack Mowakaba TPME à 18 000 MAD HT).
- Facturation Fiduciaire au Compteur par Dossier (3 langues) : Socle Cabinet Marque Blanche à 490 MAD HT/mois, plus facturation automatique par client actif au prorata journalier : 69 MAD (Simplifié/AE), 149 MAD (TPE) et 249 MAD (PME Complet), avec remise de 15 % dès 100 dossiers et Pack Mowakaba Cabinet à 45 000 MAD HT.
- Contrats Annuels Grands Comptes (3 langues, hors Mowakaba) : Enterprise Corporate à 58 000 MAD HT/an (jusqu'à 5 ICE) et Fisca Souverain Loi 05-20 DGSSI à 140 000 MAD HT/an (jusqu'à 10 ICE, hébergement et GPU au Maroc).
- Objectifs SLA & FinOps : Latence API inférieure à 50 ms au Maroc, extraction documentaire inférieure à 2,5 secondes, disponibilité de 99,95 %, et coût marginal d'infrastructure inférieur ou égal à 5 MAD HT/mois par PME active contre 50 000 EUR/an sur les déploiements IA classiques.
## Section 12 — Definition of Done Globale (v1.0.0)
La version v1.0.0 de Fisca ne peut être déclarée prête pour la production que lorsque les 10 jalons suivants sont intégralement vérifiés par le harnais automatisé :
- Provisionnement automatique d'une base SQLite D1 dédiée et onboarding ICE complet en moins de 90 secondes.
- Attribution séquentielle sans trou sous 50 requêtes simultanées, chaînage PIH SHA-256 et signature Loi 43-20 WebCrypto CSC v2 opérationnelle.
- Validation sans aucune erreur sur ph-ubl / PHIVE et xmllint de tous les flux UBL 2.1, SIMPL-TVA v4.0, SIMPL-IS v2.0.3, État 9421, DRVT, Loi 69-21 et FEC-MA 24 colonnes.
- Inaltérabilité matérielle prouvée du Grand Livre CGNC (rejet SQLite sur tentative d'UPDATE/DELETE d'une pièce POSTED) et scellement quotidien par Arbre de Merkle sur R2 juridiction UE.
- Fonctionnement prouvé du double mode cryptographique (Cloud Assisté et Zero-Knowledge E2EE avec enveloppes multi-acteurs, Blind Index HMAC et séquestre de Shamir 2-sur-3).
- Exécution conforme des 11 agents neuro-symboliques avec mémoire Hindsight et respect strict des 4 règles d'arrêt AI Crafters.
- Opérationnalité complète des connecteurs Odoo (l10n_ma_edi_clearance), Sage 100 (.NET 8 IPMEncoder et .PNM) et du serveur MCP / Meta Muse.
- Facturation automatique au prorata journalier des nouveaux dossiers fiduciaires reliée à Payzone, OTP Infobip (FISCA) et collecte @ingest.fisca.ma via Amazon SES.
- Conformité visuelle et responsive Mobile/Desktop du thème Mercury hybride (clair/sombre, tabular-nums, 44px/28px) avec respect strict de la séparation 6 langues (Astro/PME) vs 3 langues (Fiduciaire/Corporate).
- Suite complète de tests unitaires, fiscaux, XSD et E2E Playwright à 100 % au vert sans aucun code factice ni flottant monétaire dans le dépôt GitHub privé fisca.

## Section 13 — Pilier 5 : Fisca POS Tactile (SCE Art. 145 CGI) & Fisca POS Bridge

*(Précision sur la Section 10 : seule la fabrication de terminaux matériels propriétaires est exclue ; Fisca fournit l'intégralité du logiciel de caisse tactile multi-plateforme et les pilotes WebUSB/Bluetooth/IP universels).*

* **Caisse Tactile Offline-First (`apps/pos-pwa` + Capacitor) :** Encaissement tactile en moins de 100 ms sur tablette, PC tactile ou terminal Android, stockage local SQLite WASM résistant aux coupures réseau jusqu'à 72 heures, impression thermique ESC/POS (58/80 mm), lecture code-barres, gestion des tables/salles et écran cuisine KDS.
* **Chaînage Cryptographique des Tickets & Clôture Z :** Numérotation continue par terminal de caisse, chaînage SHA-256 anti-suppression conforme à l'Article 145 du CGI, gestion traçable des retours marchandises par avoir-ticket référencé, et génération du Ticket Z électronique alimentant l'E-Reporting B2C quotidien et le Grand Livre CGNC.
* **Portail QR de Conversion Ticket B2C vers Facture B2B xHub :** Chaque ticket comporte un QR Code unique permettant à un acheteur professionnel de saisir son ICE à 15 chiffres pour recevoir instantanément sa facture Factur-X certifiée xHub DGI, avec déduction automatique du montant de l'assiette B2C pour interdire toute double imposition TVA ou IS.
* **Réconciliation Télécollecte TPE & Plateformes de Livraison :** Rapprochement automatique entre les totaux cartes du Ticket Z (CMI, Payzone, NAPS, MarocPay) ou plateformes (Glovo) et les virements bancaires nets reçus, avec comptabilisation automatique des commissions HT et de la TVA récupérable à 10 % sur frais bancaires.
* **Fisca POS Bridge & Stock Temps Réel :** Connecteurs entrants pour caisses tierces (Odoo POS, Foodics, iGoodar, Shopify/WooCommerce) et décrémentation immédiate du stock magasin avec séparation entre stock virtuel réservé et stock physique plancher non négatif.
