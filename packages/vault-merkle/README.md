# @fisca/vault-merkle : coffre probant (AIP, Merkle, RFC 3161, LTA)

Ticket T-P2A-07. Ce paquet assemble des paquets d'archivage (AIP), un arbre de Merkle quotidien (RFC 6962), un ancrage par jeton
d'horodatage RFC 3161 et un ré-horodatage périodique chaîné (LTA).

## Statut : profil PROVISOIRE

- Le format d'AIP (`FISCA-AIP-OAIS-PROVISIONAL`) s'inspire d'OAIS (ISO 14721) et de PREMIS, avec des métadonnées minimales. Il est
  provisoire et susceptible d'évoluer.
- Ce paquet **ne vaut ni conformité ISO 14641, ni certification, ni qualification** d'un service d'archivage ou d'horodatage.

## Contenu

| Module | Rôle |
| --- | --- |
| `merkle.ts` | Arbre RFC 6962 (préfixes 0x00 / 0x01), preuves d'inclusion, vecteurs de référence |
| `aip.ts` | Construction, sérialisation canonique, vérification et écriture d'un AIP ; manifeste `chemin\|taille\|sha256` |
| `aip-cipher.ts` | Scellement AES-256-GCM (`@fisca/crypto-e2ee`), AAD `companyId\|tableName\|recordId\|columnName` |
| `daily.ts` | Lot quotidien : feuilles = empreintes d'AIP triées par `aipId` |
| `anchor.ts` | Ancrage idempotent par jour dans `archival_merkle_batches` + coffre WORM |
| `lta.ts` | `planLtaRenewal` (pure, horloge injectée, 24 mois par défaut) et `renewTimestamp` (append-only) |
| `timestamp-chain.ts` | Contrôle structurel de la chaîne de jetons (ancien jeton + racine) |
| `evidence.ts` | `verifyArchiveEvidence` : un rapport par maillon, échecs distincts |

Le coffre s'utilise via l'interface `WormVaultDriver` de `@fisca/shared-types` (`putImmutableObject`, `getObjectBytes`, plus la
propriété `jurisdiction`). La durée de rétention est un paramètre ; `DEFAULT_RETENTION_DAYS = 3653` reprend le contrat CTR-BND-02.

## Granularité

**Une racine par société et par jour n'est pas ce qui est implémenté** : la table `archival_merkle_batches` n'a ni colonne de
société et `batch_date` y est `UNIQUE`. Le paquet produit donc **une racine par jour pour la plateforme** (étiquette de portée
`companyScope`, un second lot de portée différente le même jour est refusé). Une racine par société et par jour exigerait une
évolution du schéma.

## Ce qui est testé, et ce qui ne l'est pas

- Pilote mémoire de test (`tests/support/in-memory-worm-vault.ts`), non exporté de `src/`, et pilote `InMemoryInfrastructureAdapter`
  de `@fisca/shared-types` : ils vérifient la logique du paquet, pas un vrai Object Lock.
- **R2 réel et Object Lock ne sont pas testés** (pas de Cloudflare dans le bac à sable). Le contrat de test
  `runWormVaultDriverContractTests` (`tests/support/worm-vault-contract.ts`) est prévu pour être rejoué sur un vrai pilote.
- TSA de test locale (`packages/ubl-xades/tests/support/test-pki.ts`) : jetons non qualifiés signés par une clé éphémère.
- **Contrôle RFC 3161 partiel** : structure, condensé et `genTime` seulement. Signature de la TSA, chaîne de certification et
  révocation **ne sont pas évaluées** (`trust: 'NOT_EVALUATED'`).

## Limites connues

- Seul le condensé SHA-256 est pris en charge pour les jetons (limite de `TimestampProvider`).
- Aucune colonne ne porte le `genTime` du premier jeton : l'échéance LTA initiale part du début du jour du lot (plus prudent).
- L'enveloppement de la clé de chiffrement (DEK) par la clé maîtresse société n'est pas du ressort de ce paquet.
