---
name: fisca-dgi-xsd-and-ubl-clearance
description: Génération et validation stricte des flux Fisca : XML OASIS UBL 2.1, Factur-X PDF/A-3, signature Loi 43-20, Merkle/WORM, EDI SIMPL (TVA, IS, 9421, DRVT, FEC), régime provisoire DGI/xHub. À utiliser pour XSD, xmllint, PHIVE, clearance, télédéclaration.
---

# fisca-dgi-xsd-and-ubl-clearance

Méthode de génération, de signature, d'archivage et de validation des flux de facturation électronique et de télédéclaration de Fisca.

## 1. Clearance & Signature Loi 43-20

Valider l'UBL 2.1 avec ph-ubl / PHIVE et générer le PDF/A-3 bilingue avec Mustangproject. Implémenter `Loi4320SignatureEngine` nativement en WebCrypto (`crypto.subtle`) via protocole CSC API v2.0 (`/csc/v2/signatures/signHash`) et jeton RFC 3161, en vérifiant la correspondance entre l'OID du certificat X.509 et l'ICE émetteur.

## 2. Coffre WORM & Merkle

Empaqueter chaque pièce en archive AIP chiffrée AES-256-GCM sur R2 (`jurisdiction = "eu"`) et regrouper tous les hash quotidiens dans un Arbre de Merkle unique pour n'utiliser qu'un seul jeton TSA par jour.

## 3. Contraintes XSD DGI

Tester chaque XML avec `xmllint`.

- SIMPL-TVA v4.0 : placer `<prorata>` exactement entre `<tx>` et `<mp>`.
- Liasse SIMPL-IS v2.0.3 : l'équilibrer via une balance à 6 colonnes où Actif Net = Cellule Brut - Cellule Amort.
- État 9421 (année civile, `.xml` non zippé) : placer `<numPPR/>` entre `<numCE/>` et `<numCNSS>`, et `<listSalariesCFC/>` dans la racine avec paiements ES, CH ou SIR.
- DRVT v2.0.3 : produire les 3 flux, incluant les loyers.
- FEC-MA : 24 colonnes, précédé du journal AN.



## 4. Régime provisoire tant que la DGI et xHub n'ont pas publié (ERRATA B-13 révisé, 2026-11-13)

Constat daté : le décret d'application de l'article 145-IX du CGI n'est pas paru au Bulletin officiel, et ni la DGI ni xHub n'ont publié de profil UBL marocain, de XSD, de Schematron ou d'API pour la facturation électronique. Les XSD des télédéclarations SIMPL existent mais ne sont pas dans le dépôt, et `tax.gov.ma` refuse le bac à sable. Aucune de ces absences ne bloque un ticket.

- **Facture électronique.** Valide contre ce qui est officiel et public : XSD OASIS UBL 2.1 (`docs.oasis-open.org`) et règles EN 16931 embarquées dans PHIVE. Les règles propres au Maroc décrites dans Doc_07 vont dans un profil séparé et remplaçable, `packages/ubl-xades/profiles/cius-ma-provisional/`, jamais mêlées au code du générateur.
- **Passerelle.** L'échange avec la plateforme passe par l'interface `ClearanceGateway`. Seul le pilote `simulated` est livré et testé. Le pilote `live` s'écrira quand l'API sera publiée : n'invente ni point d'accès, ni en-tête, ni code retour au-delà de ce que Doc_07 pose comme hypothèse, et marque chaque hypothèse comme telle.
- **SIMPL.** Si un XSD officiel est présent dans `docs/reference/dgi/`, utilise-le tel quel. Sinon, écris un XSD provisoire dérivé strictement de Doc_07 § 08 à § 10 dans `packages/edi-simpl/xsd/provisional/`, avec en tête le commentaire `PROVISOIRE — dérivé de Doc_07, non publié par la DGI`.
- **Un seul point de choix.** `resolveSchema(kind, version)` rend le schéma officiel s'il existe, le provisoire sinon ; `pnpm test:xsd` imprime lequel a servi. Le remplacement se fait sans toucher aux générateurs.
- **Registre.** Chaque contrat concerné s'inscrit avec le statut `PROVISIONAL` et la mention « conformité officielle non vérifiée » ; il garde ce statut à la barrière.
- **Interdits.** Présenter un schéma provisoire comme officiel ; écrire qu'un flux est « conforme », « homologué » ou « certifié » par la DGI ou xHub (l'état `--status-cleared` s'affiche « Validation simulée ») ; coder une date d'obligation ou un seuil de chiffre d'affaires de la réforme : ce sont des lignes datées des tables D1, vides tant que le décret n'est pas paru.
- **À la parution d'un texte officiel.** Procédure de remplacement dans `docs/reference/dgi/README.md`.

## Acquis vérifiés P2-A (2026-11-13, dépôt prime)
- Maven : com.helger.phive:phive-api/phive-xml 12.2.0 ; com.helger.phive.rules:phive-rules-en16931 4.6.4 (groupe .rules) ; org.glassfish.jaxb:jaxb-runtime 4.0.9 indispensable (sinon échec SVRL) ; org.mustangproject:library 2.26.0 ; jeux EN 16931 v1.3.17 (VID_UBL_INVOICE_1317 / CREDIT_NOTE_1317). mvn exige JAVA_HOME Java 21.
- XSD OASIS UBL 2.1 vendorisés dans packages/ubl-xades/xsd (SOURCE.md avec SHA-256).
- Décisions du pilote (provisoires) : mapping Doc_07 MA:ICE/MA:IF/MA:RC|TP|CNSS conservé dans cius-ma-provisional ; écarts PHIVE connus en constante unique KNOWN_PHIVE_DEVIATIONS (BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24), le contrôle croisé affirme exactement cette liste ; type 383 émis en racine Invoice (InvoiceTypeCode 383), retenue refusée seulement sur 381 ; PIH en text/plain et ICV dans cbc:UUID = hypothèses ; tuple PIH aligné sur les colonnes invoices (total_ht_cents hors débours, total_ttc_cents débours inclus), via buildPihFieldsFromInvoiceRow ; genèse PIH 45 caractères (colonnes sans CHECK), genèse POS 64 zéros.
- Comportements EN 16931 réels : débours/timbre en catégorie O mêlés à des lignes taxées → BR-O-11/BR-O-12 ; retenue réduisant PayableAmount → BR-CO-16 ; UBLExtensions → warning UBL-CR-001.
- XAdES : UBL-XAdESv132-2.1.xsd ne définit pas SigningCertificateV2 → défaut xades:SigningCertificate (SHA-256 + X509IssuerSerial) ; xmllint refuse X509SerialNumber > ~20 chiffres décimaux (limite libxml2), à surveiller avec les certificats Barid eSign. Canonisation c14n11 maison validée octet pour octet contre le JDK ; WebCrypto ne signe pas un condensé brut (signataire de test via openssl pkeyutl, tests seulement).
- PAdES : xref classique seulement (échec fermé sinon) ; vérifiable par BouncyCastle 1.80, openssl cms -verify -noverify, pdfsig.



## Mise à jour du 2026-11-15 : ce que la vague 2 a construit et fixé (prime sur ce qui précède)

- **Réalisé (P2-A, PR n° 17), régime PROVISOIRE (ERRATA B-13)** : générateur UBL (`packages/ubl-xades/src/generator`), profil remplaçable `packages/ubl-xades/profiles/cius-ma-provisional/`, XSD OASIS UBL 2.1 vendorisés (`packages/ubl-xades/xsd/`, `pnpm test:xsd`, 32 documents valides à G2), signature XAdES avec clés de test (`SigningCertificate` V1 par défaut, client CSC v2.0, `assertCertificateMatchesEmitter`), jeton RFC 3161 au contrôle PARTIEL (jamais « qualifié »), Factur-X PDF/A-3b via `containers/fiscal-java` (`POST /facturx`, UBL embarqué avec `fx:ConformanceLevel=UBL21-PROVISIONAL`, jamais « Factur-X conforme »), `DgiClearanceWorkflow` (1 envoi + 8 réessais, passerelle `simulated`, « Validation simulée »), coffre OAIS, racine de Merkle quotidienne globale.
- **Écarts PHIVE connus** : BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24 (`KNOWN_PHIVE_DEVIATIONS`, `packages/ubl-xades/src/known-phive-deviations.ts`) ; le contrôle croisé échoue sur toute autre règle ; `FISCA_REQUIRE_PHIVE=1` et Java 21 à une barrière. La note de débit 383 est émise comme `Invoice` de type 383.
- **PIH** : tuple `FISCA_INV_PIH_V1` à 13 éléments (`totalHtCents` hors débours, `totalTtcCents` les engage) ; genèse de 45 caractères `GENESIS_HASH_` + 32 zéros ; empreinte d'or `0ec5abda…a797`.
- **SIMPL (vague 3, P3-A)** : aucun code ; **directive D-23** : si les XSD officiels sont absents de `docs/reference/dgi/`, ne pas bloquer ; XSD structurels stricts dérivés de Doc_07 §§ 08 à 10 dans `packages/edi-simpl/xsd/provisional/`, marqués `PROVISIONAL_STRUCTURAL_XSD_PENDING_OFFICIAL_DGI_PACK`, validés par xmllint ; un seul point de résolution du schéma (patron `resolveSchema`) ; jamais d'homologation DGI. Les `codeEdi` SIMPL-IS et la table de plus de 1 500 cellules ne sont pas dans le dépôt : sous-ensemble documenté. FEC : 18 colonnes standard (ordre confirmé par le propriétaire) + 6 extensions, mention « Profil Fisca Art. 211 CGI en attente d'arrêté technique DGI ».
- **À lire avant P3-A** : `docs/orchestration/preparation-vague-3.md` § 3.
