/**
 * Jeu de tests de contrat de FiscaInfrastructureAdapter, rejoué par chaque adaptateur
 * (mémoire de test, Cloudflare, standby VPS). Sans dépendance : le lanceur de tests est injecté
 * (`{ describe, it }` de vitest convient tel quel).
 */
import {
  InfrastructureError,
  sha256Hex,
  type FiscaInfrastructureAdapter,
  type InfrastructureErrorCode,
  type SignedReplicationDelta,
} from './infra-adapter.ts';

export interface InfrastructureContractFixture {
  readonly adapter: FiscaInfrastructureAdapter;
  /** Provisionne la base d'une société (hors contrat de l'adaptateur). */
  provisionCompany(companyId: string): Promise<void>;
  /** Nombre de messages en attente dans une file. */
  queueDepth(queueName: string): Promise<number>;
}

export interface ContractRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void>): void;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`CONTRAT_ADAPTATEUR: ${message}`);
}

async function expectCode(action: () => Promise<unknown>, code: InfrastructureErrorCode, what: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    check(error instanceof InfrastructureError, `${what} : erreur typée InfrastructureError attendue.`);
    if (error instanceof InfrastructureError) {
      check(error.code === code, `${what} : code ${code} attendu, reçu ${error.code}.`);
      check(error.message.startsWith(`${code}:`), `${what} : le message doit commencer par le code.`);
    }
    return;
  }
  throw new Error(`CONTRAT_ADAPTATEUR: ${what} : une erreur ${code} était attendue.`);
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
}

function text(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

const FUTURE_RETENTION = '2099-01-01T00:00:00.000Z';
const PAST_RETENTION = '2000-01-01T00:00:00.000Z';
const HEX64 = 'a'.repeat(64);

function delta(companyId: string, sequence: number): SignedReplicationDelta {
  return {
    deltaId: `delta-${companyId}-${sequence}`,
    companyId,
    sequenceMonotonic: sequence,
    originProvider: 'CLOUDFLARE_EDGE',
    sqlBatchEncryptedB64: 'AAAA',
    r2AipKeysAdded: [`${companyId}/aip/${sequence}.bin`],
    latestJournalHashes: { VT: HEX64 },
    hmacSignatureHex: HEX64,
  };
}

export function runInfrastructureAdapterContract(
  runner: ContractRunner,
  suiteName: string,
  createFixture: () => Promise<InfrastructureContractFixture>,
): void {
  runner.describe(`Contrat FiscaInfrastructureAdapter : ${suiteName}`, () => {
    runner.it('déclare un mode connu et une juridiction de coffre cohérente (R2 jurisdiction=eu en mode Cloudflare)', async () => {
      const { adapter } = await createFixture();
      check(
        adapter.providerMode === 'CLOUDFLARE_EDGE' || adapter.providerMode === 'SOVEREIGN_MOROCCO_VPS',
        'providerMode inconnu.',
      );
      const jurisdiction = adapter.getLegalVault().jurisdiction;
      check(
        adapter.providerMode === 'CLOUDFLARE_EDGE' ? jurisdiction === 'eu' : jurisdiction === 'ma',
        `juridiction du coffre incohérente avec ${adapter.providerMode} : ${jurisdiction}.`,
      );
    });

    runner.it('isole le plan de contrôle et chaque base société', async () => {
      const fx = await createFixture();
      await fx.provisionCompany('soc-a');
      await fx.provisionCompany('soc-b');
      const a = await fx.adapter.getTenantDb('soc-a');
      const b = await fx.adapter.getTenantDb('soc-b');
      const control = fx.adapter.getControlPlaneDb();
      check(a.tenantId === 'soc-a' && b.tenantId === 'soc-b', 'tenantId doit être le companyId.');
      check(control.tenantId === 'control-plane', 'le plan de contrôle a son propre tenantId.');
      await a.executeBatchAtomically([
        { sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)', params: [] },
        { sql: 'INSERT INTO notes (id, body) VALUES (?, ?)', params: ['1', 'secret A'] },
      ]);
      await expectCode(() => b.query({ sql: 'SELECT id FROM notes', params: [] }), 'INFRA_SQL_REJECTED', 'lecture inter-sociétés');
      await expectCode(
        () => control.query({ sql: 'SELECT id FROM notes', params: [] }),
        'INFRA_SQL_REJECTED',
        'lecture depuis le plan de contrôle',
      );
      await b.executeBatchAtomically([{ sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)', params: [] }]);
      const rowsB = await b.query<{ id: string }>({ sql: 'SELECT id FROM notes', params: [] });
      check(rowsB.length === 0, 'la base B ne doit jamais voir les lignes de la base A.');
      const rowsA = await a.query<{ body: string }>({ sql: 'SELECT body FROM notes WHERE id = ?', params: ['1'] });
      check(rowsA.length === 1 && rowsA[0]?.body === 'secret A', 'la base A conserve ses lignes.');
    });

    runner.it('refuse une société inconnue ou un identifiant invalide', async () => {
      const { adapter } = await createFixture();
      await expectCode(() => adapter.getTenantDb('soc-inconnue'), 'INFRA_TENANT_NOT_FOUND', 'société inconnue');
      for (const bad of ['', '../x', 'a b', 'control-plane']) {
        await expectCode(() => adapter.getTenantDb(bad), 'INFRA_INVALID_COMPANY_ID', `identifiant « ${bad} »`);
      }
    });

    runner.it('exécute un lot de façon atomique : tout ou rien', async () => {
      const fx = await createFixture();
      await fx.provisionCompany('soc-a');
      const db = await fx.adapter.getTenantDb('soc-a');
      await db.executeBatchAtomically([{ sql: 'CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL)', params: [] }]);
      const ok = await db.executeBatchAtomically([
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 1000] },
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e2', 2000] },
      ]);
      check(ok.totalChanges === 2, 'totalChanges doit compter les lignes modifiées.');
      await expectCode(
        () =>
          db.executeBatchAtomically([
            { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e3', 3000] },
            { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 1] },
          ]),
        'INFRA_BATCH_ROLLED_BACK',
        'lot avec doublon de clé',
      );
      const rows = await db.query<{ id: string }>({ sql: 'SELECT id FROM ledger', params: [] });
      check(rows.length === 2 && !rows.some((r) => r.id === 'e3'), 'aucune instruction du lot échoué ne doit subsister.');
    });

    runner.it('applique un verrou optimiste : UPDATE ... WHERE état = attendu', async () => {
      const fx = await createFixture();
      await fx.provisionCompany('soc-a');
      const db = await fx.adapter.getTenantDb('soc-a');
      await db.executeBatchAtomically([
        { sql: 'CREATE TABLE invoices (id TEXT PRIMARY KEY, status TEXT NOT NULL)', params: [] },
        { sql: 'INSERT INTO invoices (id, status) VALUES (?, ?)', params: ['i1', 'DRAFT'] },
      ]);
      const first = await db.executeBatchAtomically([
        { sql: 'UPDATE invoices SET status = ? WHERE id = ? AND status = ?', params: ['SENT', 'i1', 'DRAFT'] },
      ]);
      const second = await db.executeBatchAtomically([
        { sql: 'UPDATE invoices SET status = ? WHERE id = ? AND status = ?', params: ['SENT', 'i1', 'DRAFT'] },
      ]);
      check(first.totalChanges === 1 && second.totalChanges === 0, 'la seconde application ne doit rien modifier.');
    });

    runner.it('coffre WORM : écriture, relecture, copie défensive, non-écrasement', async () => {
      const { adapter } = await createFixture();
      const vault = adapter.getLegalVault();
      const bytes = ascii('chiffre');
      const options = {
        retentionUntilIso: FUTURE_RETENTION,
        sha256Hex: await sha256Hex(bytes),
        customMetadata: { 'x-company': 'soc-a' },
      };
      const put = await vault.putImmutableObject('soc-a/aip/1.bin', bytes, options);
      check(put.etag.length > 0, 'etag non vide attendu.');
      const read = await vault.getObjectBytes('soc-a/aip/1.bin');
      check(read !== null && read.metadata['x-company'] === 'soc-a', 'métadonnées relues.');
      check(read !== null && text(read.bytes) === 'chiffre', 'octets relus.');
      if (read) read.bytes[0] = 0;
      const again = await vault.getObjectBytes('soc-a/aip/1.bin');
      check(again !== null && text(again.bytes) === 'chiffre', 'la modification d\'une lecture ne doit pas altérer le coffre.');
      await expectCode(
        () => vault.putImmutableObject('soc-a/aip/1.bin', bytes, options),
        'INFRA_VAULT_IMMUTABLE',
        'écrasement d\'un objet WORM',
      );
      check((await vault.getObjectBytes('soc-a/aip/absent.bin')) === null, 'objet absent : null.');
    });

    runner.it('coffre WORM : refuse hash incohérent, rétention invalide ou passée, clé invalide', async () => {
      const { adapter } = await createFixture();
      const vault = adapter.getLegalVault();
      const bytes = ascii('x');
      const good = { retentionUntilIso: FUTURE_RETENTION, sha256Hex: await sha256Hex(bytes), customMetadata: {} };
      await expectCode(
        () => vault.putImmutableObject('k/1', bytes, { ...good, sha256Hex: HEX64 }),
        'INFRA_VAULT_HASH_MISMATCH',
        'hash incohérent',
      );
      await expectCode(
        () => vault.putImmutableObject('k/2', bytes, { ...good, retentionUntilIso: 'demain' }),
        'INFRA_VAULT_INVALID_RETENTION',
        'rétention mal formée',
      );
      await expectCode(
        () => vault.putImmutableObject('k/3', bytes, { ...good, retentionUntilIso: PAST_RETENTION }),
        'INFRA_VAULT_INVALID_RETENTION',
        'rétention passée',
      );
      for (const bad of ['', '/abs', 'a/../b']) {
        await expectCode(() => vault.putImmutableObject(bad, bytes, good), 'INFRA_INVALID_OBJECT_KEY', `clé « ${bad} »`);
      }
      check((await vault.getObjectBytes('k/1')) === null, 'une écriture refusée ne laisse aucun objet.');
    });

    runner.it('files : noms D-08 seulement, idempotence par clé, délai entier', async () => {
      const fx = await createFixture();
      const queue = fx.adapter.getQueue();
      await queue.enqueueIdempotent('fisca-xhub-clearance', 'inv-1', { invoiceId: 'inv-1' });
      await queue.enqueueIdempotent('fisca-xhub-clearance', 'inv-1', { invoiceId: 'inv-1' });
      await queue.enqueueIdempotent('fisca-xhub-clearance', 'inv-2', { invoiceId: 'inv-2' }, 30);
      await queue.enqueueIdempotent('dlq-fisca-xhub-clearance', 'inv-1', { invoiceId: 'inv-1' });
      check((await fx.queueDepth('fisca-xhub-clearance')) === 2, 'une clé d\'idempotence ne produit qu\'un message.');
      check((await fx.queueDepth('dlq-fisca-xhub-clearance')) === 1, 'la file d\'erreurs a sa propre idempotence.');
      await expectCode(() => queue.enqueueIdempotent('fisca-ocr', 'k', {}), 'INFRA_UNKNOWN_QUEUE', 'file hors registre');
      await expectCode(() => queue.enqueueIdempotent('fisca-notifications', ' ', {}), 'INFRA_INVALID_QUEUE_ARGUMENT', 'clé vide');
      await expectCode(() => queue.enqueueIdempotent('fisca-notifications', 'k', {}, -1), 'INFRA_INVALID_QUEUE_ARGUMENT', 'délai négatif');
      await expectCode(() => queue.enqueueIdempotent('fisca-notifications', 'k', {}, 1.5), 'INFRA_INVALID_QUEUE_ARGUMENT', 'délai flottant');
    });

    runner.it('miroir souverain : séquences strictement croissantes par société, relecture ordonnée', async () => {
      const { adapter } = await createFixture();
      const mirror = adapter.getSovereignMirror();
      const r1 = await mirror.pushDelta(delta('soc-a', 1));
      check(r1.acceptedSequence === 1, 'séquence acceptée renvoyée.');
      await mirror.pushDelta(delta('soc-a', 2));
      await mirror.pushDelta(delta('soc-b', 1));
      await expectCode(() => mirror.pushDelta(delta('soc-a', 2)), 'INFRA_MIRROR_SEQUENCE_REJECTED', 'rejeu de séquence');
      await expectCode(() => mirror.pushDelta(delta('soc-a', 1)), 'INFRA_MIRROR_SEQUENCE_REJECTED', 'séquence antérieure');
      const afterZero = await mirror.readDeltasAfter('soc-a', 0);
      check(afterZero.map((d) => d.sequenceMonotonic).join(',') === '1,2', 'relecture ordonnée complète.');
      const afterOne = await mirror.readDeltasAfter('soc-a', 1);
      check(afterOne.length === 1 && afterOne[0]?.sequenceMonotonic === 2, 'relecture après séquence 1.');
      check((await mirror.readDeltasAfter('soc-b', 0)).length === 1, 'isolation par société.');
      check((await mirror.readDeltasAfter('soc-c', 0)).length === 0, 'société sans delta : liste vide.');
    });

    runner.it('miroir souverain : refuse une enveloppe invalide', async () => {
      const { adapter } = await createFixture();
      const mirror = adapter.getSovereignMirror();
      const base = delta('soc-a', 1);
      await expectCode(() => mirror.pushDelta({ ...base, sequenceMonotonic: 0 }), 'INFRA_MIRROR_INVALID_DELTA', 'séquence 0');
      await expectCode(() => mirror.pushDelta({ ...base, sequenceMonotonic: 1.5 }), 'INFRA_MIRROR_INVALID_DELTA', 'séquence flottante');
      await expectCode(() => mirror.pushDelta({ ...base, hmacSignatureHex: 'zz' }), 'INFRA_MIRROR_INVALID_DELTA', 'signature mal formée');
      await expectCode(
        () => mirror.pushDelta({ ...base, latestJournalHashes: { VT: 'abc' } }),
        'INFRA_MIRROR_INVALID_DELTA',
        'empreinte de journal mal formée',
      );
      await expectCode(() => mirror.pushDelta({ ...base, deltaId: ' ' }), 'INFRA_MIRROR_INVALID_DELTA', 'deltaId vide');
    });
  });
}
