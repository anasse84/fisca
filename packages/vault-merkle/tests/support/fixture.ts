import { InMemoryInfrastructureAdapter } from '@fisca/shared-types';
import type { AipPackage, AipPayloadCipher } from '../../src/index.ts';
import { buildAip } from '../../src/index.ts';
import { createTestTimestampProvider, type TestTimestampProvider } from '../../../ubl-xades/tests/support/test-pki.ts';

/** Matériel de TEST uniquement : TSA de test (jetons signés par une clé éphémère, non qualifiés) et coffre/SQL en mémoire. */
export const CREATE_BATCHES_DDL = `CREATE TABLE archival_merkle_batches (
    batch_id TEXT PRIMARY KEY,
    batch_date TEXT NOT NULL UNIQUE,
    leaf_count INTEGER NOT NULL CHECK (leaf_count > 0),
    previous_batch_root_hash TEXT NOT NULL,
    merkle_root_sha256 TEXT NOT NULL,
    chained_root_sha256 TEXT NOT NULL,
    tsa_rfc3161_token_b64 TEXT NOT NULL,
    last_lta_renewal_at TEXT,
    lta_renewal_token_b64 TEXT
)`;

export interface TestClock {
  readonly now: () => Date;
  readonly nowIso: () => string;
  set(iso: string): void;
}

export function createClock(startIso: string): TestClock {
  let current = Date.parse(startIso);
  return {
    now: () => new Date(current),
    nowIso: () => `${new Date(current).toISOString().slice(0, 19)}Z`,
    set(iso: string) {
      current = Date.parse(iso);
    },
  };
}

export interface AnchorFixture {
  readonly adapter: InMemoryInfrastructureAdapter;
  readonly clock: TestClock;
  readonly tsa: TestTimestampProvider;
}

export async function createAnchorFixture(startIso: string): Promise<AnchorFixture> {
  const clock = createClock(startIso);
  const adapter = new InMemoryInfrastructureAdapter({ acknowledgeTestOnly: 'NOT_FOR_PRODUCTION', providerMode: 'CLOUDFLARE_EDGE', nowIso: clock.nowIso });
  await adapter.getControlPlaneDb().executeBatchAtomically([{ sql: CREATE_BATCHES_DDL, params: [] }]);
  const tsa = await createTestTimestampProvider({ now: clock.now });
  return { adapter, clock, tsa };
}

/** Scelleur de test réversible (XOR d'un octet) : suffit à exercer le chemin « paquet scellé » sans dépendre d'une clé. */
export const testCipher: AipPayloadCipher = {
  algorithm: 'test-xor',
  async seal(plain) {
    return plain.map((byte) => byte ^ 0x5a);
  },
  async open(sealed) {
    return sealed.map((byte) => byte ^ 0x5a);
  },
};

const encoder = new TextEncoder();

export async function makeInvoiceAip(companyId: string, index: number, createdAtIso: string): Promise<AipPackage> {
  const id = String(index).padStart(3, '0');
  return buildAip({
    aipId: `aip_${id}`,
    companyId,
    createdAtIso,
    producer: 'fisca-archiver',
    rights: 'Art. 211 CGI : conservation',
    contents: [
      { relativePath: `invoices/inv-${id}.xml`, bytes: encoder.encode(`<Invoice n="${id}"/>`), amountCents: 12_000 + index },
      { relativePath: `invoices/inv-${id}.pdf`, bytes: encoder.encode(`pdf-${id}`) },
    ],
  });
}
