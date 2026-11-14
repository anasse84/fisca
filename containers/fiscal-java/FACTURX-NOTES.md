# FACTURX-NOTES : ce que le conteneur produit réellement (ticket T-P2A-06)

**Libellé à utiliser partout : « PDF/A-3b avec facture UBL embarquée, profil provisoire ».** Ce document n'est **pas** un Factur-X conforme, et rien ici ne vaut conformité, homologation ni certification DGI ou xHub (ERRATA B-13).

## 1. Écart central avec le standard Factur-X : UBL au lieu de CII

- Le standard Factur-X (FNFE-MPE / FeRD) exige que la pièce embarquée soit un XML **CII** (Cross Industry Invoice, `rsm:CrossIndustryInvoice`), nommé `factur-x.xml`, avec un profil parmi MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED.
- Fisca embarque de l'**UBL 2.1** (décision de Doc_07 § 07). C'est un écart assumé avec le standard : un lecteur Factur-X qui cherche `factur-x.xml` en CII ne lira pas cette facture.
- Aucune conversion UBL vers CII n'est faite ici (hors ticket).

## 2. Comportement RÉEL de Mustangproject 2.26.0 (vérifié par `FacturXAssemblerTest`)

| Constat | Détail |
|---|---|
| `ZUGFeRDExporterFromA3.setXML(byte[])` refuse l'UBL | `RuntimeException` : le XML doit contenir `rsm:CrossIndustry` (ou Order-X / despatch). Test `mustangRefuseNativementUnXmlUblCarIlExigeDuCii`. |
| Nommage par défaut | Mustang nomme la pièce `factur-x.xml` et écrit dans le XMP `fx:DocumentFileName=factur-x.xml`, `fx:ConformanceLevel=EN 16931`, `fx:DocumentType=INVOICE`, `fx:Version=1.0`. Pour de l'UBL, ce serait **trompeur** (déclarer un format que le XML n'est pas). Test `lenommageParDefautDeMustangDeclareFacturXEn16931PourDuUblCeQuiEstTrompeur` (le PDF reste valide PDF/A-3b : la validité PDF/A ne dit rien de la nature de la pièce). |
| Mode retenu par défaut (`UBL_PROVISIONAL`) | Fournisseur XML dédié (`IXMLProvider`) qui rend l'UBL tel quel ; pièce nommée **`ubl-invoice.xml`** (aucun nom normalisé n'existe pour de l'UBL) ; XMP : `fx:DocumentFileName=ubl-invoice.xml`, `fx:DocumentType=INVOICE`, `fx:Version=1.0`, `fx:ConformanceLevel=UBL21-PROVISIONAL` (valeur **non standard**, hors énumération Factur-X) ; `pdfaid:part=3`, `pdfaid:conformance=B`. |
| Espace de noms XMP | Mustang écrit l'espace `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#` (préfixe `fx`) et le schéma d'extension PDF/A correspondant, même pour l'UBL. Conservé tel quel (nécessaire pour déclarer les propriétés `fx:` en PDF/A) ; à revoir quand le format marocain sera publié. |
| Mode d'embarquement | Fichier joint (`/EmbeddedFiles` + `/AF` du catalogue), `AFRelationship` = `Alternative` par défaut (`Data` accepté par la requête, `attachmentRelationship`), sous-type `text/xml`, flux **non compressé**, octets identiques au XML fourni (testé). Le standard Factur-X emploie `Alternative` pour EN 16931 et `Data` seulement pour MINIMUM / BASIC WL. |
| Niveau PDF/A | Mustang écrit `A`/`U`/`B` selon `setConformanceLevel` ; fixé à `BASIC` (B). Profil colorimétrique sRGB ajouté (`sRGB.icc` du jar Mustang) si absent. |
| Xref | Mustang enregistre par `save(..., NO_COMPRESSION)` : table xref classique, sans flux d'objets. **Piège observé** : si le PDF de base a été écrit avec flux xref, la sortie contient une table classique **et** un trailer qui garde `/Type /XRef /W /Index /Filter` (hybride, valide pour veraPDF). `PresentationPdfBuilder` écrit donc le PDF de base sans compression ; test `unPdfDeBaseCompresse...`. |
| Métadonnées | `xmp:CreateDate`, `dc:date`, dates `/Info` : heure d'exécution (`Calendar.getInstance()`), donc les octets du PDF **diffèrent d'un appel à l'autre** ; seuls le texte et les arrêtés sont déterministes. Aucun `dc:title` n'est écrit. |

## 3. Validité PDF/A-3b

- Outil : **veraPDF** `org.verapdf:validation-model:1.30.4` (Maven Central, analyseur Greenfield), profil **PDF/A-3B** (`PDFAFlavour.PDFA_3_B`), en scope test.
- Résultat : **0 violation** sur le PDF assemblé (sortie de `/facturx` et des tests `FacturXAssemblerTest`, y compris `Relationship.DATA` et le nommage Mustang par défaut). Contrôle négatif : le PDF de présentation seul (sans XMP PDF/A ni profil colorimétrique) est **refusé** par veraPDF.
- PDFBox Preflight 3.0.8 (transitif de Mustang) n'a pas été utilisé : il ne cible que PDF/A-1b ; veraPDF était disponible.
- Non vérifié : ouverture dans Acrobat ou d'autres lecteurs, validation par un autre validateur que veraPDF.
- Polices : Geist (latin) et IBM Plex Sans Arabic (arabe), SIL OFL, **intégrées en sous-ensemble** (test `lePdfEstUnA4...` : toutes les polices `isEmbedded`).
- Limite : le texte arabe est dessiné en formes de présentation Unicode (FE70 à FEFC) ; `ToUnicode` renvoie ces formes, donc l'extraction de texte du PDF donne des formes de présentation et non les lettres logiques. PDF non balisé : niveau A (accessibilité) non revendiqué.

## 4. Mise en forme arabe

ICU4J 79.1 `ArabicShaping` (formes contextuelles, ligature lam-alef) puis `Bidi` (UAX #9, paragraphe RTL, parenthèses en miroir) ; les suites latines et numériques (dates, ICE, « UBL 2.1 ») sont isolées en gauche-à-droite. Rendu vérifié visuellement sur rasterisation 300 dpi ; non relu par un locuteur natif.

## 5. QR de vérification

QR ISO/IEC 18004 (ZXing core 3.5.4, correction M) dessiné en vectoriel (modules fusionnés par ligne, zone de silence de 4 modules). Contenu : `<baseUrl>/api/v1/public/verify/<xhubUuid>` (route du ticket T-P2A-09 ; `baseUrl` HTTPS fourni par la requête, jamais en dur). Légende imprimée : « QR provisoire, non publié par la DGI/xHub ». Le format du QR officiel DGI/xHub est **absent** (B-13). Le conteneur n'appelle jamais l'URL. Décodage vérifié depuis le PDF rasterisé (tests).

## 6. Signature PAdES (item « test Mustang Factur-X non réalisé » du pilote)

`preparePadesSignature` du paquet `@fisca/ubl-xades` **accepte** le PDF/A-3b produit (xref classique, catalogue et page sans flux d'objets, ni `/AcroForm`, ni `/Annots` indirect). `signPades` (clés éphémères de TEST, TSA de test non qualifiée) ajoute l'incrément, l'original reste intact octet pour octet, et le CMS se vérifie avec `openssl cms -verify -noverify` (`tests/facturx-java-e2e.test.ts`). **Le code PAdES n'a pas été modifié.** L'échec fermé existant se déclencherait sur un PDF à flux xref : voir le piège de la section 2. Non vérifié : validité PDF/A-3b **après** signature (veraPDF n'a pas été rejoué sur le PDF signé), validation de la signature par un lecteur PDF.

## 7. Arrêtés en toutes lettres

Source de vérité unique : `packages/ubl-xades/tests/golden/amount-in-words.vectors.json`, rejoué par vitest et par `AmountInWordsTest`. Le conteneur **recalcule** les arrêtés depuis le TTC en centimes ; le TypeScript peut joindre `expectedAmountInWords`, le conteneur répond 422 `AMOUNT_IN_WORDS_MISMATCH` si l'un des deux textes diffère. Tous les vecteurs sont à l'état **PROVISOIRE — orthographe à faire relire par un locuteur natif** (ERRATA section E).
