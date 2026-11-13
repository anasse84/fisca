import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_TENANT_ID,
  InMemoryInfrastructureAdapter,
  InfrastructureError,
  assertValidCompanyId,
  runInfrastructureAdapterContract,
  type AsyncQueueDriver,
  type FiscaInfrastructureAdapter,
  type InfrastructureContractFixture,
  type InfrastructureProviderMode,
  type SovereignMirrorDriver,
  type TenantSqlDriver,
  type WormVaultDriver,
} from '@fisca/shared-types';
import { createD1TenantDriver } from '../src/index.ts';
import { FakeD1Database } from './fake-d1.ts';
import { PgSandbox } from './pg-sandbox.ts';

/**
 * Adaptateur de test : le SQL vient des pilotes D1 / PostgreSQL, le coffre WORM, les files et le miroir viennent du pilote
 * mémoire de shared-types (ces trois volets relèvent des tickets P4). La suite de contrat s'exécute donc en entier, et prouve
 * le volet SQL de nos deux pilotes.
 */
class SqlBackedContractAdapter implements FiscaInfrastructureAdapter {
  readonly providerMode: InfrastructureProviderMode;
  private readonly tenants = new Map<string, TenantSqlDriver>();

  constructor(
    private readonly rest: InMemoryInfrastructureAdapter,
    private readonly control: TenantSqlDriver,
    private readonly open: (companyId: string) => TenantSqlDriver,
  ) {
    this.providerMode = rest.providerMode;
  }

  provision(companyId: string): void {
    assertValidCompanyId(companyId);
    this.tenants.set(companyId, this.open(companyId));
  }

  getControlPlaneDb(): TenantSqlDriver {
    return this.control;
  }

  async getTenantDb(companyId: string): Promise<TenantSqlDriver> {
    assertValidCompanyId(companyId);
    const driver = this.tenants.get(companyId);
    if (!driver) {
      throw new InfrastructureError('INFRA_TENANT_NOT_FOUND', `aucune base pour la société ${companyId}.`);
    }
    return driver;
  }

  getLegalVault(): WormVaultDriver {
    return this.rest.getLegalVault();
  }

  getQueue(): AsyncQueueDriver {
    return this.rest.getQueue();
  }

  getSovereignMirror(): SovereignMirrorDriver {
    return this.rest.getSovereignMirror();
  }
}

function memoryRest(mode: InfrastructureProviderMode): InMemoryInfrastructureAdapter {
  return new InMemoryInfrastructureAdapter({ acknowledgeTestOnly: 'NOT_FOR_PRODUCTION', providerMode: mode, nowIso: () => '2026-11-13T10:00:00.000Z' });
}

const runner = {
  describe: (name: string, body: () => void): void => {
    describe(name, body);
  },
  it: (name: string, body: () => Promise<void>): void => {
    it(name, body);
  },
};

runInfrastructureAdapterContract(runner, 'pilote D1 (faux D1 sur node:sqlite)', async () => {
  const rest = memoryRest('CLOUDFLARE_EDGE');
  const adapter = new SqlBackedContractAdapter(rest, createD1TenantDriver(CONTROL_PLANE_TENANT_ID, new FakeD1Database()), (id) =>
    createD1TenantDriver(id, new FakeD1Database()),
  );
  const fixture: InfrastructureContractFixture = {
    adapter,
    provisionCompany: async (id) => adapter.provision(id),
    queueDepth: async (queue) => rest.queueDepth(queue),
  };
  return fixture;
});

describe('suite de contrat sur PostgreSQL 16 réel : un schéma temporaire par base', () => {
  const sandbox = new PgSandbox();
  beforeAll(async () => {
    await sandbox.open();
  });
  afterAll(async () => {
    await sandbox.close();
  });

  it('la suite de contrat complète (volet SQL) passe avec le pilote PostgreSQL', async () => {
    const { PgSchemaFarm } = await import('./pg-schema-farm.ts');
    const farm = new PgSchemaFarm(sandbox);
    const failures: string[] = [];
    const collected: { name: string; body: () => Promise<void> }[] = [];
    runInfrastructureAdapterContract(
      {
        describe: (_name, body) => body(),
        it: (name, body) => {
          collected.push({ name, body });
        },
      },
      'pilote PostgreSQL',
      async () => {
        await farm.reset();
        const rest = memoryRest('SOVEREIGN_MOROCCO_VPS');
        const adapter = new SqlBackedContractAdapter(rest, farm.driver(CONTROL_PLANE_TENANT_ID), (id) => farm.driver(id));
        return { adapter, provisionCompany: async (id) => adapter.provision(id), queueDepth: async (q) => rest.queueDepth(q) };
      },
    );
    for (const { name, body } of collected) {
      try {
        await body();
      } catch (error) {
        failures.push(`${name} : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(collected.length).toBeGreaterThanOrEqual(9);
    expect(failures).toEqual([]);
  });
});
