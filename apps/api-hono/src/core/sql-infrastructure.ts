/**
 * Composition SQL de FiscaInfrastructureAdapter (Doc_04 § 10, loi 11, D-16) pour les modes CLOUDFLARE_EDGE et
 * SOVEREIGN_MOROCCO_VPS : plan de contrôle + résolution côté serveur de la base d'une société.
 *
 * PÉRIMÈTRE : bases SQL seulement. Le coffre WORM (R2 / MinIO), les files (Queues / BullMQ) et le miroir souverain restent aux
 * tickets P4 : cette classe n'implémente donc PAS l'interface complète `FiscaInfrastructureAdapter` mais sa partie SQL
 * (`SqlInfrastructure`), que l'adaptateur complet réutilisera.
 *
 * La résolution lit `tenant_databases` (plan de contrôle) avec le `companyId` en paramètre lié. Ce `companyId` vient de la
 * session authentifiée et du contrôle d'appartenance (D-16) ; il n'est jamais lu d'un en-tête ou d'un outil IA ici.
 */
import {
  CONTROL_PLANE_MIGRATIONS,
  TENANT_MIGRATIONS,
  controlPlaneMigrationPostgresStatements,
  createD1TenantDriver,
  createPostgresTenantDriver,
  ensureTenantSchemaUpToDate,
  tenantMigrationPostgresStatements,
  type D1DatabaseLike,
  type PgConnectionSource,
} from '@fisca/db-schema';
import {
  CONTROL_PLANE_TENANT_ID,
  InfrastructureError,
  assertValidCompanyId,
  type InfrastructureProviderMode,
  type TenantSqlDriver,
} from '@fisca/shared-types';

/** Valeurs du CHECK de `tenant_databases.storage_driver` (Doc_06 § 02). */
export type TenantStorageDriver = 'CLOUDFLARE_D1_EU' | 'HYPERDRIVE_MAROC_PG';

export interface TenantDatabaseRoute {
  readonly companyId: string;
  readonly d1DatabaseUuid: string;
  readonly storageDriver: TenantStorageDriver;
}

/**
 * Comment joindre physiquement une base à partir de sa route. Le mécanisme (binding D1 dynamique, API HTTP D1, Hyperdrive,
 * pool PostgreSQL au Maroc) relève de l'exploitation : il est injecté, jamais décidé ici.
 */
export interface SqlBackendOpeners {
  openD1(route: TenantDatabaseRoute): D1DatabaseLike;
  openPostgres(route: TenantDatabaseRoute): PgConnectionSource;
}

export type SqlEngine = 'sqlite' | 'postgres';

export interface SqlInfrastructureOptions {
  readonly providerMode: InfrastructureProviderMode;
  /** Pilote du plan de contrôle et moteur sous-jacent (choisit la traduction des migrations). */
  readonly controlPlane: { readonly driver: TenantSqlDriver; readonly engine: SqlEngine };
  readonly openers: SqlBackendOpeners;
  readonly nowIso?: () => string;
}

interface ResolvedTenant {
  readonly driver: TenantSqlDriver;
  readonly engine: SqlEngine;
}

interface RouteRow {
  readonly company_id: string;
  readonly d1_database_uuid: string;
  readonly storage_driver: string;
}

function isStorageDriver(value: string): value is TenantStorageDriver {
  return value === 'CLOUDFLARE_D1_EU' || value === 'HYPERDRIVE_MAROC_PG';
}

export class SqlInfrastructure {
  readonly providerMode: InfrastructureProviderMode;

  constructor(private readonly options: SqlInfrastructureOptions) {
    this.providerMode = options.providerMode;
  }

  getControlPlaneDb(): TenantSqlDriver {
    return this.options.controlPlane.driver;
  }

  /** La base est résolue côté serveur : société inconnue ou route invalide refusées (D-16). */
  async getTenantDb(companyId: string): Promise<TenantSqlDriver> {
    return (await this.resolve(companyId)).driver;
  }

  /**
   * Résolution puis migration à la volée (Doc_04 § 04, Just-in-Time) : le middleware appelle ceci avant toute requête métier.
   * Les migrations tenant sont appliquées avec la traduction du moteur de la base ; l'empreinte reste celle du DDL SQLite.
   */
  async getTenantDbUpToDate(companyId: string): Promise<TenantSqlDriver> {
    const { driver, engine } = await this.resolve(companyId);
    await ensureTenantSchemaUpToDate(this.options.controlPlane.driver, driver, companyId, TENANT_MIGRATIONS, {
      ...(engine === 'postgres' ? { statementsFor: tenantMigrationPostgresStatements } : {}),
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {}),
    });
    return driver;
  }

  /** Migre le plan de contrôle lui-même (provisionnement, démarrage). */
  async ensureControlPlaneUpToDate(): Promise<{ readonly currentVersion: number; readonly appliedCount: number }> {
    const { driver, engine } = this.options.controlPlane;
    return ensureTenantSchemaUpToDate(null, driver, CONTROL_PLANE_TENANT_ID, CONTROL_PLANE_MIGRATIONS, {
      ...(engine === 'postgres' ? { statementsFor: controlPlaneMigrationPostgresStatements } : {}),
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {}),
    });
  }

  private async lookupRoute(companyId: string): Promise<TenantDatabaseRoute> {
    const rows = await this.options.controlPlane.driver.query<RouteRow>({
      sql: 'SELECT company_id, d1_database_uuid, storage_driver FROM tenant_databases WHERE company_id = ?',
      params: [companyId],
    });
    const row = rows[0];
    if (!row) {
      throw new InfrastructureError('INFRA_TENANT_NOT_FOUND', `aucune base pour la société ${companyId}.`);
    }
    if (!isStorageDriver(row.storage_driver)) {
      throw new InfrastructureError('INFRA_TENANT_NOT_FOUND', `route invalide pour la société ${companyId} : storage_driver inconnu.`);
    }
    return { companyId: row.company_id, d1DatabaseUuid: row.d1_database_uuid, storageDriver: row.storage_driver };
  }

  private async resolve(companyId: string): Promise<ResolvedTenant> {
    assertValidCompanyId(companyId);
    const route = await this.lookupRoute(companyId);
    // En mode souverain (VPS Maroc, bascule PRA), D1 n'existe plus : les données sont sur PostgreSQL quelle que soit la route.
    const useD1 = this.providerMode === 'CLOUDFLARE_EDGE' && route.storageDriver === 'CLOUDFLARE_D1_EU';
    if (useD1) {
      return { driver: createD1TenantDriver(companyId, this.options.openers.openD1(route)), engine: 'sqlite' };
    }
    return { driver: createPostgresTenantDriver(companyId, this.options.openers.openPostgres(route)), engine: 'postgres' };
  }
}
