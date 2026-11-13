# AGENTS.md — `containers/` (Java, Python, .NET isolés)

Précise la constitution racine (`/AGENTS.md`). Lire aussi `docs/specs/ERRATA.md` (B-07, B-13, B-14) et Doc_07, Doc_11.

## Règles locales

- **Isolation** : `fiscal-java` (Java 21, Maven), `docling-python` (Python 3.12, pytest), `camel-bridge`, et le projet .NET 8 de `connectors/sage100-dotnet` (xUnit) ont chacun leurs dépendances. Aucun ne lit la base d'un autre ni ne partage son code.
- **Tests par le code, pas par `docker build`** : le bac à sable n'a pas Docker (B-07). On teste par Maven, pytest et xUnit. MinIO n'est pas simulé : le contrat `WormVaultDriver` se teste sur un pilote mémoire.
- **Régime provisoire (B-13)** : au 2026-11-13, aucun schéma officiel de facturation électronique n'est publié. Validation réelle contre UBL 2.1 d'OASIS et les règles EN 16931 de PHIVE ; règles marocaines dans le profil remplaçable `cius-ma-provisional` (`packages/ubl-xades/profiles/`). L'échange passe par `ClearanceGateway`, seul pilote livré : `simulated`. Aucun point d'accès, en-tête ni code retour de xHub n'est inventé au-delà de ce que Doc_07 pose comme hypothèse, marquée comme telle.
- **XSD SIMPL** : un XSD officiel présent dans `docs/reference/dgi/` s'utilise tel quel. Sinon XSD provisoire dérivé de Doc_07 § 08 à § 10, avec en tête `PROVISOIRE — dérivé de Doc_07, non publié par la DGI`. Le choix du schéma passe par le seul point `resolveSchema(kind, version)`. Contrats inscrits `PROVISIONAL`, « conformité officielle non vérifiée ». Ne jamais le présenter comme officiel ni écrire « conforme DGI ».
- **Balises sensibles** (positions décrites en Doc_15 § 09, à recouper avec Doc_07 ; provisoires) : `<prorata>` entre `<tx>` et `<mp>` en SIMPL-TVA v4.0 ; `<numPPR/>` entre `<numCE/>` et `<numCNSS>`, et `<listSalariesCFC/>` dans la racine, en État 9421 ; omission des codes 11501 à 11504 en SIMPL-IS v2.0.3 ; journal AN équilibré en tête du FEC-MA à 24 colonnes. Aucune balise hors schéma.
- **Sage 100 (B-14)** : lecture `WITH (NOLOCK)` ; écriture par `.PNM` de 108 caractères ASCII + CRLF ou par `IPMEncoder`. `Objets100cLib` vit derrière `ISageWriter`, dans un projet `net8.0-windows` exclu de la solution construite sous Linux. Le générateur `.PNM` et le garde SQL se testent sous Linux.
- **Montants** : entiers (`long`, `BigInteger`, `int` en Python), jamais `double`, `float` ni `Decimal` flottant ; division arrondie demi-supérieur explicite.
- **PII** : aucune donnée personnelle en clair dans les journaux ; anonymiseur avec motifs CIN, IF et CNSS (D-12).
- **Registre d'images** : paramètre `FISCA_IMAGE_REGISTRY`, jamais un registre en dur (D-15).

## Vérifier

`mvn test`, `pytest`, `dotnet test` selon le conteneur, puis `pnpm verify:fast`. Un test XML nomme le schéma utilisé, officiel ou provisoire.
