import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_INDEX_NAMES,
  CONTROL_PLANE_MIGRATIONS,
  CONTROL_PLANE_SQL,
  CONTROL_PLANE_TABLE_NAMES,
  HUMAN_ROLE_CODES,
  TECHNICAL_ROLE_CODES,
} from '../src/control-plane.ts';
import { LATER, NOW, all, expectSqlError, openControlPlane, run, seedOrganization, seedUser } from './support.ts';

const REGISTRY_TABLES = [
  'pricing_catalog',
  'plan_entitlements',
  'subscriptions',
  'fiduciary_dossier_meters',
  'pos_terminal_meters',
  'prepaid_wallets',
  'organizations',
  'users',
  'user_oauth_accounts',
  'user_mfa_factors',
  'user_trusted_devices',
  'organization_memberships',
  'tenant_databases',
  'morocco_company_directory',
  'dynamic_fiscal_rules',
  'simpl_is_cell_rules',
  'pledged_invoices_registry',
  'archival_merkle_batches',
] as const;

const TICKET_EXTRA_TABLES = [
  'refresh_tokens',
  'passkey_credentials',
  'passkey_challenges',
  'oauth_transactions',
  'pending_oauth_links',
  'one_time_tokens',
  'mfa_challenge_states',
  'processed_queue_messages',
  'company_cpa_mandates',
] as const;

const HUMAN_ROLES = [
  'OWNER_GERANT',
  'COMMERCIAL_FACTURATION',
  'CAISSIER_POS',
  'ACHATS_BUYER',
  'MAGASINIER_BL',
  'DAF_TRESORIER',
  'AIDE_COMPTABLE',
  'CHEF_MISSION',
  'EXPERT_COMPTABLE_OEC',
  'AUDITEUR_CAC_DGI',
] as const;

function listObjects(db: DatabaseSync, type: 'table' | 'index' | 'trigger' | 'view'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) =>
    String(row['name']),
  );
}

function tenantFixture(db: DatabaseSync, companyId: string, organizationId: string, ice: string): void {
  run(
    db,
    `INSERT INTO tenant_databases (company_id, organization_id, ice, identifiant_fiscal, raison_sociale_fr, legal_form, vat_regime, vat_cadence,
       d1_database_uuid, ingest_email_alias, created_at)
     VALUES (?, ?, ?, '12345678', 'Atlas BTP', 'SARL', 'ENCAISSEMENT', 'MENSUELLE', ?, ?, ?)`,
    companyId,
    organizationId,
    ice,
    `d1-${companyId}`,
    `${companyId}@ingest.fisca.ma`,
    NOW,
  );
}

describe('migrations : forme, ordre et immuabilité', () => {
  it('versions strictement croissantes, nommées, sans doublon', () => {
    const versions = CONTROL_PLANE_MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    for (const migration of CONTROL_PLANE_MIGRATIONS) {
      expect(migration.name.length).toBeGreaterThan(0);
      expect(migration.upSqlStatements.length).toBeGreaterThan(0);
    }
  });

  it('la somme de contrôle SHA-256 déclarée est celle de upSqlStatements.join("\\n") (même calcul que ensureTenantSchemaUpToDate)', () => {
    for (const migration of CONTROL_PLANE_MIGRATIONS) {
      const digest = createHash('sha256').update(migration.upSqlStatements.join('\n'), 'utf8').digest('hex');
      expect(digest, `migration v${migration.version} (${migration.name}) altérée`).toBe(migration.expectedSha256Hex);
    }
  });

  it('chaque instruction est une instruction unique (un seul point-virgule final autorisé ; un trigger de la v4 porte ses instructions entre BEGIN et END)', () => {
    for (const migration of CONTROL_PLANE_MIGRATIONS) {
      for (const statement of migration.upSqlStatements) {
        const body = statement.trim().replace(/;$/, '');
        if (/^CREATE TRIGGER /.test(body)) {
          expect(body, statement).toMatch(/\bBEGIN\b[\s\S]*;\s*END$/);
          expect(body.slice(body.lastIndexOf('END') + 3).includes(';'), statement).toBe(false);
        } else {
          expect(body.includes(';'), statement).toBe(false);
        }
      }
    }
  });
});

describe('création du schéma', () => {
  it('toutes les tables du registre et du ticket se créent, dans un ordre déterministe', () => {
    const db = openControlPlane();
    const created = listObjects(db, 'table');
    expect(created).toEqual([...REGISTRY_TABLES, ...TICKET_EXTRA_TABLES].sort());
    expect([...CONTROL_PLANE_TABLE_NAMES].sort()).toEqual(created);
    expect(new Set(CONTROL_PLANE_TABLE_NAMES).size).toBe(CONTROL_PLANE_TABLE_NAMES.length);
  });

  it('deux créations successives donnent exactement le même sqlite_master', () => {
    const dump = (db: DatabaseSync): string =>
      all(db, `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid`)
        .map((row) => `${String(row['type'])}|${String(row['name'])}|${String(row['sql'])}`)
        .join('\n');
    expect(dump(openControlPlane())).toBe(dump(openControlPlane()));
  });

  it("l'ordre de création respecte les clés étrangères (aucune table référencée après son référent)", () => {
    const db = openControlPlane();
    const position = new Map(CONTROL_PLANE_TABLE_NAMES.map((name, index) => [name, index]));
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      for (const fk of all(db, `SELECT "table" AS parent FROM pragma_foreign_key_list(?)`, table)) {
        const parent = String(fk['parent']);
        expect(position.get(parent), `${table} -> ${parent}`).toBeLessThan(position.get(table) ?? -1);
      }
    }
  });

  it('les index nommés exportés existent tous, et seulement eux (hors index automatiques)', () => {
    const db = openControlPlane();
    const named = listObjects(db, 'index').filter((name) => !name.startsWith('sqlite_autoindex'));
    expect(named).toEqual([...CONTROL_PLANE_INDEX_NAMES].sort());
  });

  it("ne crée aucune vue ; Doc_06 § 02 ne définit aucun trigger, le seul est celui de la migration v4 (durée de vie des transactions OAuth, décision du pilote)", () => {
    const db = openControlPlane();
    expect(listObjects(db, 'trigger')).toEqual(['enforce_oauth_transaction_max_ttl']);
    expect(listObjects(db, 'view')).toEqual([]);
  });

  it("ne crée ni tenant_key_grants (T-S1B-02), ni tax_regimes_catalog, ni company_billing_meters (D-19)", () => {
    const names = CONTROL_PLANE_TABLE_NAMES;
    expect(names).not.toContain('tenant_key_grants');
    expect(names).not.toContain('tax_regimes_catalog');
    expect(names).not.toContain('company_billing_meters');
  });
});

describe('rôles (ERRATA D-02)', () => {
  it('10 rôles humains dont COMMERCIAL_FACTURATION, 2 identités techniques hors liste', () => {
    expect([...HUMAN_ROLE_CODES].sort()).toEqual([...HUMAN_ROLES].sort());
    expect(HUMAN_ROLE_CODES).toHaveLength(10);
    expect([...TECHNICAL_ROLE_CODES].sort()).toEqual(['AI_MCP_ACTOR', 'ERP_CONNECTOR_AGENT']);
  });

  it.each(HUMAN_ROLES)('organization_memberships accepte %s', (role) => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    seedUser(db, 'usr-1', 'a@fisca.ma');
    run(db, `INSERT INTO organization_memberships (id, organization_id, user_id, role_code, created_at) VALUES ('m1', 'org-1', 'usr-1', ?, ?)`, role, NOW);
    expect(all(db, `SELECT role_code FROM organization_memberships`)).toEqual([{ role_code: role }]);
  });

  it.each(['ERP_CONNECTOR_AGENT', 'AI_MCP_ACTOR', 'ROOT', '', 'owner_gerant'])('organization_memberships refuse %j', (role) => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    seedUser(db, 'usr-1', 'a@fisca.ma');
    expectSqlError(
      db,
      `INSERT INTO organization_memberships (id, organization_id, user_id, role_code, created_at) VALUES ('m1', 'org-1', 'usr-1', ?, ?)`,
      [role, NOW],
      /CHECK constraint failed/,
    );
  });

  it("unicité (organization_id, user_id) d'une appartenance", () => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    seedUser(db, 'usr-1', 'a@fisca.ma');
    const insert = `INSERT INTO organization_memberships (id, organization_id, user_id, role_code, created_at) VALUES (?, 'org-1', 'usr-1', 'OWNER_GERANT', ?)`;
    run(db, insert, 'm1', NOW);
    expectSqlError(db, insert, ['m2', NOW], /UNIQUE constraint failed/);
  });
});

describe('compteurs et abonnements (ERRATA D-06)', () => {
  function meterFixture(db: DatabaseSync): void {
    seedOrganization(db, 'cabinet-1');
    tenantFixture(db, 'co-1', 'cabinet-1', '001234567000089');
  }
  const insertMeter = (status: string): string =>
    `INSERT INTO fiduciary_dossier_meters (id, cabinet_org_id, client_company_id, dossier_tier, monthly_rate_ht_cents, activated_on_date, minimum_commitment_until, status)
     VALUES ('fm-1', 'cabinet-1', 'co-1', 'DOSSIER_TPE', 14900, '2026-11-01', '2026-12-01', '${status}')`;

  it.each(['ACTIVE', 'ARCHIVED'])('fiduciary_dossier_meters accepte le statut %s', (status) => {
    const db = openControlPlane();
    meterFixture(db);
    run(db, insertMeter(status));
    expect(all(db, `SELECT status FROM fiduciary_dossier_meters`)).toEqual([{ status }]);
  });

  it.each(['SUSPENDED', 'active', 'DECOMMISSIONED', ''])('fiduciary_dossier_meters refuse le statut %j', (status) => {
    const db = openControlPlane();
    meterFixture(db);
    expectSqlError(db, insertMeter(status), [], /CHECK constraint failed/);
  });

  it('statut par défaut ACTIVE et palier inconnu refusé', () => {
    const db = openControlPlane();
    meterFixture(db);
    run(
      db,
      `INSERT INTO fiduciary_dossier_meters (id, cabinet_org_id, client_company_id, dossier_tier, monthly_rate_ht_cents, activated_on_date, minimum_commitment_until)
       VALUES ('fm-1', 'cabinet-1', 'co-1', 'DOSSIER_SIMPLIFIE', 6900, '2026-11-01', '2026-12-01')`,
    );
    expect(all(db, `SELECT status FROM fiduciary_dossier_meters`)).toEqual([{ status: 'ACTIVE' }]);
    expectSqlError(db, insertMeter('ACTIVE').replace("'DOSSIER_TPE'", "'DOSSIER_GOLD'").replace("'fm-1'", "'fm-2'"), [], /CHECK constraint failed/);
  });

  it('client_company_id est unique et référence tenant_databases', () => {
    const db = openControlPlane();
    meterFixture(db);
    run(db, insertMeter('ACTIVE'));
    expectSqlError(db, insertMeter('ACTIVE').replace("'fm-1'", "'fm-2'"), [], /UNIQUE constraint failed/);
    expectSqlError(db, insertMeter('ACTIVE').replace("'co-1'", "'co-inconnu'").replace("'fm-1'", "'fm-3'"), [], /FOREIGN KEY constraint failed/);
  });

  it('pos_terminal_meters : statut ACTIVE ou DECOMMISSIONED seulement', () => {
    const db = openControlPlane();
    meterFixture(db);
    const insert = (status: string): string =>
      `INSERT INTO pos_terminal_meters (terminal_id, organization_id, company_id, device_fingerprint, monthly_rate_ht_cents, activated_on_date, status)
       VALUES ('t-${status}', 'cabinet-1', 'co-1', 'fp', 14900, '2026-11-01', '${status}')`;
    run(db, insert('ACTIVE'));
    run(db, insert('DECOMMISSIONED'));
    expectSqlError(db, insert('ARCHIVED'), [], /CHECK constraint failed/);
  });
});

describe('TVA stricte (ERRATA D-04) et montants entiers (Loi 1)', () => {
  const insertPlan = (rate: string, price: string): string =>
    `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, vat_rate_bps, updated_at)
     VALUES ('PLAN_${rate.replace(/\W/g, '')}_${price.replace(/\W/g, '')}', 'DIRECT_PME', 'MONTHLY', ${price}, ${rate}, '${NOW}')`;

  it.each(['2000', '1000', '0'])('pricing_catalog accepte vat_rate_bps = %s', (rate) => {
    const db = openControlPlane();
    run(db, insertPlan(rate, '9900'));
    expect(all(db, `SELECT vat_rate_bps FROM pricing_catalog`)).toEqual([{ vat_rate_bps: Number(rate) }]);
  });

  it.each(['700', '1400', '1200', '-2000', '2001', '20.5', "'2000x'"])('pricing_catalog refuse vat_rate_bps = %s', (rate) => {
    const db = openControlPlane();
    expectSqlError(db, insertPlan(rate, '9900'), [], /CHECK constraint failed/);
  });

  it('taux par défaut 2000 bps', () => {
    const db = openControlPlane();
    run(db, `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, updated_at) VALUES ('P', 'DIRECT_PME', 'MONTHLY', 0, '${NOW}')`);
    expect(all(db, `SELECT vat_rate_bps FROM pricing_catalog`)).toEqual([{ vat_rate_bps: 2000 }]);
  });

  it.each(['99.5', '-1', "'abc'", "'99.5'"])('pricing_catalog refuse un prix HT non entier ou négatif : %s', (price) => {
    const db = openControlPlane();
    expectSqlError(db, insertPlan('2000', price), [], /CHECK constraint failed/);
  });

  it('un montant non entier est refusé dans chaque colonne monétaire de chaque table', () => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    run(db, `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, updated_at) VALUES ('P', 'DIRECT_PME', 'MONTHLY', 100, '${NOW}')`);
    tenantFixture(db, 'co-1', 'org-1', '001234567000089');

    expectSqlError(
      db,
      `INSERT INTO subscriptions (id, organization_id, plan_code, cadence, status, locked_base_price_ht_cents, current_period_start, current_period_end, created_at)
       VALUES ('s1', 'org-1', 'P', 'MONTHLY', 'ACTIVE_PAID', 12.5, '2026-11-01', '2026-11-30', '${NOW}')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `INSERT INTO fiduciary_dossier_meters (id, cabinet_org_id, client_company_id, dossier_tier, monthly_rate_ht_cents, activated_on_date, minimum_commitment_until)
       VALUES ('f1', 'org-1', 'co-1', 'DOSSIER_TPE', 14900.5, '2026-11-01', '2026-12-01')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `INSERT INTO pos_terminal_meters (terminal_id, organization_id, company_id, device_fingerprint, monthly_rate_ht_cents, activated_on_date)
       VALUES ('t1', 'org-1', 'co-1', 'fp', 99.9, '2026-11-01')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `INSERT INTO prepaid_wallets (organization_id, mowakaba_dossier_credit_ht_cents, kyb_scoring_balance_ht_cents, updated_at) VALUES ('org-1', 1.5, 0, '${NOW}')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `INSERT INTO prepaid_wallets (organization_id, mowakaba_dossier_credit_ht_cents, kyb_scoring_balance_ht_cents, updated_at) VALUES ('org-1', 0, 1500.25, '${NOW}')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `INSERT INTO morocco_company_directory (ice, identifiant_fiscal, raison_sociale_fr, share_capital_cents, address_adc450, updated_at)
       VALUES ('001234567000089', '1', 'X', 100.5, 'Rabat', '${NOW}')`,
      [],
      /CHECK constraint failed/,
    );
    expectSqlError(
      db,
      `UPDATE tenant_databases SET share_capital_cents = ? WHERE company_id = 'co-1'`,
      [10.5],
      /CHECK constraint failed/,
    );
  });

  it('un entier valide passe dans chaque colonne monétaire (aucun faux positif)', () => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    tenantFixture(db, 'co-1', 'org-1', '001234567000089');
    run(db, `INSERT INTO prepaid_wallets (organization_id, mowakaba_dossier_credit_ht_cents, kyb_scoring_balance_ht_cents, updated_at) VALUES ('org-1', 4500000, 1500, '${NOW}')`);
    run(db, `UPDATE tenant_databases SET share_capital_cents = 10000000 WHERE company_id = 'co-1'`);
    expect(all(db, `SELECT kyb_scoring_balance_ht_cents AS v FROM prepaid_wallets`)).toEqual([{ v: 1500 }]);
  });

  it('aucune colonne REAL/FLOAT/DOUBLE/NUMERIC/DECIMAL ; toute colonne monétaire (cents, bps, milli, micro) est INTEGER', () => {
    const db = openControlPlane();
    const forbidden = /REAL|FLOA|DOUB|NUMERIC|DECIMAL/i;
    let moneyColumns = 0;
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      for (const column of all(db, `SELECT name, type FROM pragma_table_info(?)`, table)) {
        const name = String(column['name']);
        const type = String(column['type']);
        expect(forbidden.test(type), `${table}.${name} : ${type}`).toBe(false);
        if (/_(cents|bps|milli|micro)$/.test(name)) {
          moneyColumns += 1;
          expect(type, `${table}.${name}`).toBe('INTEGER');
        }
      }
    }
    expect(moneyColumns).toBeGreaterThanOrEqual(9);
  });

  it('chaque colonne monétaire porte un CHECK d\'entier dans le DDL', () => {
    const db = openControlPlane();
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      const sql = String(all(db, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table)[0]?.['sql']);
      for (const column of all(db, `SELECT name FROM pragma_table_info(?)`, table)) {
        const name = String(column['name']);
        if (/_(cents|bps|milli|micro)$/.test(name)) {
          expect(sql, `${table}.${name}`).toContain(`CHECK (${name} = CAST(${name} AS INTEGER))`);
        }
      }
    }
  });
});

describe('contraintes de Doc_06 § 02 et Doc_03 § 10', () => {
  it('plan_entitlements : clé composite et FK vers pricing_catalog', () => {
    const db = openControlPlane();
    run(db, `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, updated_at) VALUES ('P', 'DIRECT_PME', 'MONTHLY', 0, '${NOW}')`);
    run(db, `INSERT INTO plan_entitlements (plan_code, feature_key, bool_value, numeric_limit) VALUES ('P', 'api_rate_limit_rpm', 0, 600)`);
    expectSqlError(db, `INSERT INTO plan_entitlements (plan_code, feature_key) VALUES ('P', 'api_rate_limit_rpm')`, [], /UNIQUE constraint failed/);
    expectSqlError(db, `INSERT INTO plan_entitlements (plan_code, feature_key) VALUES ('ABSENT', 'x')`, [], /FOREIGN KEY constraint failed/);
  });

  it('subscriptions : statut, cadence, mode de paiement, une souscription par organisation, FK', () => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    run(db, `INSERT INTO pricing_catalog (plan_code, segment, billing_cadence, unit_price_ht_cents, updated_at) VALUES ('P', 'DIRECT_PME', 'MONTHLY', 0, '${NOW}')`);
    const insert = (id: string, org: string, status: string, plan = 'P', cadence = 'MONTHLY'): string =>
      `INSERT INTO subscriptions (id, organization_id, plan_code, cadence, status, locked_base_price_ht_cents, current_period_start, current_period_end, created_at)
       VALUES ('${id}', '${org}', '${plan}', '${cadence}', '${status}', 9900, '2026-11-01', '2026-11-30', '${NOW}')`;
    for (const [index, status] of ['TRIAL_SANDBOX_14D', 'ACTIVE_PAID', 'PAST_DUE_GRACE_14D', 'RESTRICTED_READ_ONLY', 'CANCELED_WORM_PRESERVED'].entries()) {
      const org = `org-s${index}`;
      seedOrganization(db, org);
      run(db, insert(`s${index}`, org, status));
    }
    expectSqlError(db, insert('x1', 'org-1', 'EXPIRED'), [], /CHECK constraint failed/);
    expectSqlError(db, insert('x2', 'org-1', 'ACTIVE_PAID', 'P', 'ONE_TIME'), [], /CHECK constraint failed/);
    expectSqlError(db, insert('x3', 'org-s0', 'ACTIVE_PAID'), [], /UNIQUE constraint failed/);
    expectSqlError(db, insert('x4', 'org-1', 'ACTIVE_PAID', 'ABSENT'), [], /FOREIGN KEY constraint failed/);
    expectSqlError(db, insert('x5', 'org-absente', 'ACTIVE_PAID'), [], /FOREIGN KEY constraint failed/);
    run(db, insert('ok', 'org-1', 'ACTIVE_PAID'));
    expect(all(db, `SELECT payment_method, extra_seats_count FROM subscriptions WHERE id = 'ok'`)).toEqual([
      { payment_method: 'PAYZONE_CARD', extra_seats_count: 0 },
    ]);
  });

  it('organizations : org_kind et ui_locale_policy contraints ; custom_hostname unique', () => {
    const db = openControlPlane();
    const insert = (id: string, kind: string, policy: string, host: string | null): void =>
      run(db, `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, custom_hostname, created_at) VALUES (?, 'n', ?, ?, ?, ?)`, id, kind, policy, host, NOW);
    insert('o1', 'FIDUCIAIRE_OEC', 'THREE_LOCALES_INSTITUTIONAL', 'compta.cabinet.ma');
    insert('o2', 'ENTERPRISE_GROUP', 'THREE_LOCALES_INSTITUTIONAL', null);
    insert('o3', 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', null);
    expectSqlError(db, `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('o4', 'n', 'ONG', 'SIX_LOCALES_PME', '${NOW}')`, [], /CHECK constraint failed/);
    expectSqlError(db, `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, created_at) VALUES ('o5', 'n', 'DIRECT_BUSINESS', 'TWO_LOCALES', '${NOW}')`, [], /CHECK constraint failed/);
    expectSqlError(db, `INSERT INTO organizations (id, name, org_kind, ui_locale_policy, custom_hostname, created_at) VALUES ('o6', 'n', 'DIRECT_BUSINESS', 'SIX_LOCALES_PME', 'compta.cabinet.ma', '${NOW}')`, [], /UNIQUE constraint failed/);
  });

  it('users : e-mail unique, téléphone unique, méthode MFA contrainte, valeurs par défaut', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    expect(all(db, `SELECT mfa_preferred_method, mfa_enabled, failed_login_count, preferred_locale, is_email_verified FROM users`)).toEqual([
      { mfa_preferred_method: 'NONE', mfa_enabled: 0, failed_login_count: 0, preferred_locale: 'fr', is_email_verified: 0 },
    ]);
    expectSqlError(db, `INSERT INTO users (id, email_normalized, full_name, created_at) VALUES ('u2', 'a@fisca.ma', 'x', '${NOW}')`, [], /UNIQUE constraint failed/);
    run(db, `UPDATE users SET phone_e164 = '+212600000000' WHERE id = 'u1'`);
    expectSqlError(db, `INSERT INTO users (id, email_normalized, phone_e164, full_name, created_at) VALUES ('u3', 'c@fisca.ma', '+212600000000', 'x', '${NOW}')`, [], /UNIQUE constraint failed/);
    expectSqlError(db, `UPDATE users SET mfa_preferred_method = 'SMS' WHERE id = 'u1'`, [], /CHECK constraint failed/);
    for (const method of ['TOTP_APP', 'INFOBIP_OTP', 'WEBAUTHN_PASSKEY', 'NONE']) {
      run(db, `UPDATE users SET mfa_preferred_method = '${method}' WHERE id = 'u1'`);
    }
  });

  it('tenant_databases : ICE, alias, UUID D1 uniques ; énumérations ; FK organisation', () => {
    const db = openControlPlane();
    seedOrganization(db, 'org-1');
    tenantFixture(db, 'co-1', 'org-1', '001234567000089');
    expect(all(db, `SELECT crypto_mode, storage_driver, schema_version, share_capital_cents FROM tenant_databases`)).toEqual([
      { crypto_mode: 'CLOUD_ASSISTED', storage_driver: 'CLOUDFLARE_D1_EU', schema_version: 1, share_capital_cents: 0 },
    ]);
    expectSqlError(db, `UPDATE tenant_databases SET vat_regime = 'FORFAIT'`, [], /CHECK constraint failed/);
    expectSqlError(db, `UPDATE tenant_databases SET vat_cadence = 'ANNUELLE'`, [], /CHECK constraint failed/);
    expectSqlError(db, `UPDATE tenant_databases SET crypto_mode = 'NONE'`, [], /CHECK constraint failed/);
    expectSqlError(db, `UPDATE tenant_databases SET storage_driver = 'S3'`, [], /CHECK constraint failed/);
    expect(() => tenantFixture(db, 'co-2', 'org-1', '001234567000089')).toThrow(/UNIQUE constraint failed: tenant_databases.ice/);
    expect(() => tenantFixture(db, 'co-3', 'org-absente', '001234567000090')).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("morocco_company_directory, dynamic_fiscal_rules, simpl_is_cell_rules : CHECK d'énumération et d'intervalle", () => {
    const db = openControlPlane();
    run(db, `INSERT INTO morocco_company_directory (ice, identifiant_fiscal, raison_sociale_fr, address_adc450, updated_at) VALUES ('001234567000089', '1', 'X', 'Rabat', '${NOW}')`);
    expect(all(db, `SELECT verified_count FROM morocco_company_directory`)).toEqual([{ verified_count: 1 }]);

    const rule = (id: string, scope: string, status: string): string =>
      `INSERT INTO dynamic_fiscal_rules (rule_id, cgi_article_ref, effective_from, target_scope, status, rule_ast_json, wiki_source_slug, created_at)
       VALUES ('${id}', 'art', '2026-01-01', '${scope}', '${status}', '{}', 'slug', '${NOW}')`;
    for (const [i, scope] of ['INVOICE_LINE', 'INVOICE_GLOBAL', 'JOURNAL_ENTRY', 'FEC_AUDIT'].entries()) {
      run(db, rule(`r${i}`, scope, 'ACTIVE'));
    }
    for (const [i, status] of ['PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE', 'SUPERSEDED'].entries()) {
      run(db, rule(`s${i}`, 'INVOICE_LINE', status));
    }
    expectSqlError(db, rule('bad1', 'OTHER', 'ACTIVE'), [], /CHECK constraint failed/);
    expectSqlError(db, rule('bad2', 'INVOICE_LINE', 'DRAFT'), [], /CHECK constraint failed/);

    const cell = (id: string, modele: number, edi: number, order: number): string =>
      `INSERT INTO simpl_is_cell_rules (id, modele_id, tableau_id, code_edi, eval_order, column_role, mapping_rule_json) VALUES ('${id}', ${modele}, 1, ${edi}, ${order}, 'DEBIT', '{}')`;
    run(db, cell('c1', 1, 100, 1));
    run(db, cell('c2', 4, 100, 4));
    expectSqlError(db, cell('c3', 0, 101, 1), [], /CHECK constraint failed/);
    expectSqlError(db, cell('c4', 5, 101, 1), [], /CHECK constraint failed/);
    expectSqlError(db, cell('c5', 1, 101, 0), [], /CHECK constraint failed/);
    expectSqlError(db, cell('c6', 1, 101, 5), [], /CHECK constraint failed/);
    expectSqlError(db, cell('c7', 1, 100, 2), [], /UNIQUE constraint failed/);
  });

  it('pledged_invoices_registry : statut contraint, xhub_uuid et invoice_sha256 uniques', () => {
    const db = openControlPlane();
    const pledge = (id: string, xhub: string, sha: string, status: string): string =>
      `INSERT INTO pledged_invoices_registry (id, xhub_uuid, invoice_sha256, seller_ice, buyer_ice, financier_partner_id, pledge_status, locked_at)
       VALUES ('${id}', '${xhub}', '${sha}', '001234567000089', '001234567000090', 'fin-1', '${status}', '${NOW}')`;
    for (const [i, status] of ['LOCKED_EVALUATION', 'FINANCED_SUBROGATED', 'SETTLED', 'RELEASED'].entries()) {
      run(db, pledge(`p${i}`, `x${i}`, `h${i}`, status));
    }
    expectSqlError(db, pledge('b1', 'x9', 'h9', 'PENDING'), [], /CHECK constraint failed/);
    expectSqlError(db, pledge('b2', 'x0', 'h8', 'SETTLED'), [], /UNIQUE constraint failed/);
    expectSqlError(db, pledge('b3', 'x8', 'h0', 'SETTLED'), [], /UNIQUE constraint failed/);
  });

  it('archival_merkle_batches : leaf_count > 0 et un lot par jour', () => {
    const db = openControlPlane();
    const batch = (id: string, date: string, leaves: number): string =>
      `INSERT INTO archival_merkle_batches (batch_id, batch_date, leaf_count, previous_batch_root_hash, merkle_root_sha256, chained_root_sha256, tsa_rfc3161_token_b64)
       VALUES ('${id}', '${date}', ${leaves}, 'p', 'm', 'c', 't')`;
    run(db, batch('b1', '2026-11-12', 3));
    expectSqlError(db, batch('b2', '2026-11-13', 0), [], /CHECK constraint failed/);
    expectSqlError(db, batch('b3', '2026-11-12', 1), [], /UNIQUE constraint failed/);
  });
});

describe('clés étrangères appliquées (PRAGMA foreign_keys = ON)', () => {
  it('rien ne référence une table absente et toutes les FK déclarées sont vérifiées', () => {
    const db = openControlPlane();
    expect(all(db, 'PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
    const tables = new Set<string>(CONTROL_PLANE_TABLE_NAMES);
    let count = 0;
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      for (const fk of all(db, `SELECT "table" AS parent FROM pragma_foreign_key_list(?)`, table)) {
        expect(tables.has(String(fk['parent']))).toBe(true);
        count += 1;
      }
    }
    expect(count).toBeGreaterThanOrEqual(15);
  });

  it.each([
    ['user_oauth_accounts', `INSERT INTO user_oauth_accounts (id, user_id, provider, provider_subject_id, provider_email, linked_at) VALUES ('a', 'absent', 'GOOGLE', 's', 'e', '${NOW}')`],
    ['user_mfa_factors', `INSERT INTO user_mfa_factors (user_id, updated_at) VALUES ('absent', '${NOW}')`],
    ['user_trusted_devices', `INSERT INTO user_trusted_devices (device_id, user_id, device_token_sha256, user_agent_summary, expires_at, created_at) VALUES ('d', 'absent', 'h', 'ua', '${NOW}', '${NOW}')`],
    ['organization_memberships', `INSERT INTO organization_memberships (id, organization_id, user_id, role_code, created_at) VALUES ('m', 'absent', 'absent', 'OWNER_GERANT', '${NOW}')`],
    ['refresh_tokens', `INSERT INTO refresh_tokens (token_hash, family_id, user_id, issued_at, expires_at) VALUES ('h', 'f', 'absent', '${NOW}', '${LATER}')`],
    ['passkey_credentials', `INSERT INTO passkey_credentials (credential_id, user_id, public_key_cose, algorithm, created_at) VALUES ('c', 'absent', 'k', -7, '${NOW}')`],
    ['pending_oauth_links', `INSERT INTO pending_oauth_links (id, user_id, provider, provider_subject_id, provider_email, has_password, email_proof_token_sha256, attempts_left, expires_at) VALUES ('l', 'absent', 'GOOGLE', 's', 'e', 0, 'h', 3, '${LATER}')`],
    ['one_time_tokens', `INSERT INTO one_time_tokens (token_hash, user_id, purpose, email_normalized, expires_at) VALUES ('h', 'absent', 'email-verify', 'e', '${LATER}')`],
    ['passkey_challenges', `INSERT INTO passkey_challenges (challenge, purpose, user_id, expires_at) VALUES ('c', 'REGISTRATION', 'absent', '${LATER}')`],
  ])('%s : un user_id inconnu est refusé par la FK', (_table, sql) => {
    const db = openControlPlane();
    expectSqlError(db, sql, [], /FOREIGN KEY constraint failed/);
  });

  it("supprimer un utilisateur référencé est refusé (pas de cascade silencieuse)", () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, `INSERT INTO user_oauth_accounts (id, user_id, provider, provider_subject_id, provider_email, linked_at) VALUES ('a', 'u1', 'GOOGLE', 's', 'e', '${NOW}')`);
    expectSqlError(db, `DELETE FROM users WHERE id = 'u1'`, [], /FOREIGN KEY constraint failed/);
  });
});

describe('comptes OAuth : un compte par sub', () => {
  it('UNIQUE(provider, provider_subject_id) ; même sub possible chez un autre fournisseur', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    seedUser(db, 'u2', 'b@fisca.ma');
    const link = (id: string, user: string, provider: string, sub: string): string =>
      `INSERT INTO user_oauth_accounts (id, user_id, provider, provider_subject_id, provider_email, linked_at) VALUES ('${id}', '${user}', '${provider}', '${sub}', 'e', '${NOW}')`;
    run(db, link('a1', 'u1', 'GOOGLE', 'sub-1'));
    expectSqlError(db, link('a2', 'u2', 'GOOGLE', 'sub-1'), [], /UNIQUE constraint failed: user_oauth_accounts.provider, user_oauth_accounts.provider_subject_id/);
    expectSqlError(db, link('a3', 'u1', 'GOOGLE', 'sub-1'), [], /UNIQUE constraint failed/);
    run(db, link('a4', 'u2', 'ENTRA_OIDC', 'sub-1'));
    expectSqlError(db, link('a5', 'u2', 'FACEBOOK', 'sub-9'), [], /CHECK constraint failed/);
  });
});

describe('lecture-suppression atomique (OAuth, liaisons, jetons, challenges)', () => {
  it('oauth_transactions : DELETE … RETURNING, la seconde lecture ne retourne rien', () => {
    const db = openControlPlane();
    run(db, CONTROL_PLANE_SQL.oauthTransactionSave, 'st-1', 'nonce-1', 'verifier-1', 1, '2026-11-13T10:10:00Z');
    const first = all(db, CONTROL_PLANE_SQL.oauthTransactionConsume, 'st-1');
    expect(first).toEqual([{ state: 'st-1', nonce: 'nonce-1', code_verifier: 'verifier-1', turnstile_verified: 1, expires_at: '2026-11-13T10:10:00Z' }]);
    expect(all(db, CONTROL_PLANE_SQL.oauthTransactionConsume, 'st-1')).toEqual([]);
    expect(all(db, 'SELECT COUNT(*) AS n FROM oauth_transactions')).toEqual([{ n: 0 }]);
  });

  it("oauth_transactions : state inconnu → rien ; state dupliqué refusé ; turnstile_verified booléen", () => {
    const db = openControlPlane();
    expect(all(db, CONTROL_PLANE_SQL.oauthTransactionConsume, 'inconnu')).toEqual([]);
    run(db, CONTROL_PLANE_SQL.oauthTransactionSave, 'st-1', 'n', 'v', 0, LATER);
    expectSqlError(db, CONTROL_PLANE_SQL.oauthTransactionSave, ['st-1', 'n2', 'v2', 0, LATER], /UNIQUE constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.oauthTransactionSave, ['st-2', 'n', 'v', 2, LATER], /CHECK constraint failed/);
  });

  it("oauth_transactions : la consommation d'une transaction expirée la supprime aussi (l'appelant juge l'expiration)", () => {
    const db = openControlPlane();
    run(db, CONTROL_PLANE_SQL.oauthTransactionSave, 'st-old', 'n', 'v', 1, '2020-01-01T00:00:00Z');
    expect(all(db, CONTROL_PLANE_SQL.oauthTransactionConsume, 'st-old')).toHaveLength(1);
    expect(all(db, CONTROL_PLANE_SQL.oauthTransactionConsume, 'st-old')).toEqual([]);
  });

  it('oauth_transactions : purge des expirées uniquement', () => {
    const db = openControlPlane();
    run(db, CONTROL_PLANE_SQL.oauthTransactionSave, 'old', 'n', 'v', 1, '2026-11-13T09:00:00Z');
    run(db, CONTROL_PLANE_SQL.oauthTransactionSave, 'new', 'n', 'v', 1, '2026-11-13T11:00:00Z');
    run(db, CONTROL_PLANE_SQL.oauthTransactionPurgeExpired, NOW);
    expect(all(db, 'SELECT state FROM oauth_transactions')).toEqual([{ state: 'new' }]);
  });

  it('pending_oauth_links : take atomique, une seule lecture réussit', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, CONTROL_PLANE_SQL.pendingLinkSave, 'pl-1', 'u1', 'GOOGLE', 'sub-1', 'a@gmail.com', 1, 'proof-sha', 3, LATER);
    const first = all(db, CONTROL_PLANE_SQL.pendingLinkTake, 'pl-1');
    expect(first).toEqual([
      {
        id: 'pl-1',
        user_id: 'u1',
        provider: 'GOOGLE',
        provider_subject_id: 'sub-1',
        provider_email: 'a@gmail.com',
        has_password: 1,
        email_proof_token_sha256: 'proof-sha',
        attempts_left: 3,
        expires_at: LATER,
      },
    ]);
    expect(all(db, CONTROL_PLANE_SQL.pendingLinkTake, 'pl-1')).toEqual([]);
  });

  it('pending_oauth_links : provider contraint, attempts_left >= 0, save remplace (re-save après décrément)', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    expectSqlError(db, CONTROL_PLANE_SQL.pendingLinkSave, ['pl', 'u1', 'FACEBOOK', 's', 'e', 0, 'h', 3, LATER], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.pendingLinkSave, ['pl', 'u1', 'GOOGLE', 's', 'e', 0, 'h', -1, LATER], /CHECK constraint failed/);
    run(db, CONTROL_PLANE_SQL.pendingLinkSave, 'pl', 'u1', 'GOOGLE', 's', 'e', 0, 'h', 3, LATER);
    run(db, CONTROL_PLANE_SQL.pendingLinkSave, 'pl', 'u1', 'GOOGLE', 's', 'e', 0, 'h', 2, LATER);
    expect(all(db, 'SELECT attempts_left FROM pending_oauth_links')).toEqual([{ attempts_left: 2 }]);
  });

  it('one_time_tokens : consume atomique, un seul jeton actif par (utilisateur, usage), usages indépendants', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, CONTROL_PLANE_SQL.oneTimeTokenSave, 'hash-1', 'u1', 'password-reset', 'a@fisca.ma', LATER);
    run(db, CONTROL_PLANE_SQL.oneTimeTokenSave, 'hash-v', 'u1', 'email-verify', 'a@fisca.ma', LATER);
    run(db, CONTROL_PLANE_SQL.oneTimeTokenSave, 'hash-2', 'u1', 'password-reset', 'a@fisca.ma', LATER);
    expect(all(db, 'SELECT token_hash FROM one_time_tokens ORDER BY token_hash')).toEqual([{ token_hash: 'hash-2' }, { token_hash: 'hash-v' }]);
    expect(all(db, CONTROL_PLANE_SQL.oneTimeTokenConsume, 'hash-1')).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.oneTimeTokenConsume, 'hash-2')).toEqual([
      { token_hash: 'hash-2', user_id: 'u1', purpose: 'password-reset', email_normalized: 'a@fisca.ma', expires_at: LATER },
    ]);
    expect(all(db, CONTROL_PLANE_SQL.oneTimeTokenConsume, 'hash-2')).toEqual([]);
    expectSqlError(db, CONTROL_PLANE_SQL.oneTimeTokenSave, ['h3', 'u1', 'magic-link', 'e', LATER], /CHECK constraint failed/);
  });

  it('passkey_challenges : consume atomique ; purpose contraint ; userId nul admis (passkey découvrable)', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, CONTROL_PLANE_SQL.passkeyChallengeSave, 'ch-1', 'AUTHENTICATION', null, LATER);
    run(db, CONTROL_PLANE_SQL.passkeyChallengeSave, 'ch-2', 'REGISTRATION', 'u1', LATER);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyChallengeSave, ['ch-3', 'LOGIN', null, LATER], /CHECK constraint failed/);
    expect(all(db, CONTROL_PLANE_SQL.passkeyChallengeConsume, 'ch-1')).toEqual([
      { challenge: 'ch-1', purpose: 'AUTHENTICATION', user_id: null, expires_at: LATER },
    ]);
    expect(all(db, CONTROL_PLANE_SQL.passkeyChallengeConsume, 'ch-1')).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.passkeyChallengeConsume, 'ch-2')).toHaveLength(1);
  });

  it('mfa_challenge_states : consume vrai une seule fois, y compris après des échecs ; compteur d\'échecs', () => {
    const db = openControlPlane();
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeFailureCount, 'jti-1')).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeRecordFailure, 'jti-1', LATER)).toEqual([{ failure_count: 1 }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeRecordFailure, 'jti-1', LATER)).toEqual([{ failure_count: 2 }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeIsConsumed, 'jti-1')).toEqual([{ consumed: 0 }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeConsume, 'jti-1', LATER, NOW)).toEqual([{ jti: 'jti-1' }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeConsume, 'jti-1', LATER, NOW)).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeIsConsumed, 'jti-1')).toEqual([{ consumed: 1 }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeConsume, 'jti-neuf', LATER, NOW)).toEqual([{ jti: 'jti-neuf' }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaChallengeConsume, 'jti-neuf', LATER, NOW)).toEqual([]);
  });

  it("user_mfa_factors : un code de secours ne se consomme qu'une fois, les autres restent", () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, `INSERT INTO user_mfa_factors (user_id, recovery_codes_hashes_json, updated_at) VALUES ('u1', '["h1","h2","h3"]', '${NOW}')`);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h2', LATER)).toEqual([{ user_id: 'u1' }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h2', LATER)).toEqual([]);
    expect(all(db, `SELECT recovery_codes_hashes_json AS j FROM user_mfa_factors`)).toEqual([{ j: '["h1","h3"]' }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h1', LATER)).toHaveLength(1);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h3', LATER)).toHaveLength(1);
    expect(all(db, `SELECT recovery_codes_hashes_json AS j FROM user_mfa_factors`)).toEqual([{ j: '[]' }]);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h1', LATER)).toEqual([]);
  });

  it('user_mfa_factors : sans codes (NULL) la consommation ne retourne rien', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, `INSERT INTO user_mfa_factors (user_id, updated_at) VALUES ('u1', '${NOW}')`);
    expect(all(db, CONTROL_PLANE_SQL.mfaRecoveryCodeConsume, 'u1', 'h1', LATER)).toEqual([]);
  });
});

describe('refresh_tokens (RefreshTokenStore, RefreshFamilyIndex)', () => {
  function insertToken(db: DatabaseSync, hash: string, family: string, user = 'u1', mfa: string | null = null, amr = '["pwd"]'): void {
    run(db, CONTROL_PLANE_SQL.refreshTokenInsert, hash, family, user, NOW, '2026-12-13T10:00:00Z', mfa, amr);
  }

  it("le jeton en clair n'a aucune colonne : seule l'empreinte, et les colonnes exigées existent", () => {
    const db = openControlPlane();
    const columns = all(db, `SELECT name FROM pragma_table_info('refresh_tokens')`).map((row) => String(row['name']));
    expect(columns).toEqual(
      expect.arrayContaining(['token_hash', 'family_id', 'user_id', 'issued_at', 'expires_at', 'rotated_at', 'revoked_at', 'mfa_verified_at', 'amr']),
    );
    expect(columns.filter((name) => name === 'token' || name === 'refresh_token' || name === 'token_plain')).toEqual([]);
  });

  it('markRotated est un compare-and-set : un seul gagnant', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insertToken(db, 'h1', 'f1', 'u1', NOW);
    expect(all(db, CONTROL_PLANE_SQL.refreshTokenMarkRotated, 'h1', NOW)).toEqual([{ token_hash: 'h1' }]);
    expect(all(db, CONTROL_PLANE_SQL.refreshTokenMarkRotated, 'h1', LATER)).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.refreshTokenMarkRotated, 'absent', LATER)).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.refreshTokenFindByHash, 'h1')).toEqual([
      {
        token_hash: 'h1',
        family_id: 'f1',
        user_id: 'u1',
        issued_at: NOW,
        expires_at: '2026-12-13T10:00:00Z',
        rotated_at: NOW,
        revoked_at: null,
        mfa_verified_at: NOW,
        amr: '["pwd"]',
      },
    ]);
  });

  it('revokeFamily révoque toute la famille, sans réécrire une révocation antérieure, et épargne les autres familles', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insertToken(db, 'h1', 'f1');
    insertToken(db, 'h2', 'f1');
    insertToken(db, 'h3', 'f2');
    run(db, CONTROL_PLANE_SQL.refreshFamilyRevoke, 'f1', NOW);
    run(db, CONTROL_PLANE_SQL.refreshFamilyRevoke, 'f1', LATER);
    expect(all(db, 'SELECT token_hash, revoked_at FROM refresh_tokens ORDER BY token_hash')).toEqual([
      { token_hash: 'h1', revoked_at: NOW },
      { token_hash: 'h2', revoked_at: NOW },
      { token_hash: 'h3', revoked_at: null },
    ]);
  });

  it("listFamilyIds : familles distinctes de l'utilisateur seulement", () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    seedUser(db, 'u2', 'b@fisca.ma');
    insertToken(db, 'h1', 'f1');
    insertToken(db, 'h2', 'f1');
    insertToken(db, 'h3', 'f2');
    insertToken(db, 'h4', 'f3', 'u2');
    expect(all(db, CONTROL_PLANE_SQL.refreshFamilyListByUser, 'u1')).toEqual([{ family_id: 'f1' }, { family_id: 'f2' }]);
  });

  it('empreinte unique et expiration postérieure à l\'émission', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insertToken(db, 'h1', 'f1');
    expect(() => insertToken(db, 'h1', 'f9')).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    expectSqlError(db, CONTROL_PLANE_SQL.refreshTokenInsert, ['h5', 'f1', 'u1', LATER, NOW, null, '[]'], /CHECK constraint failed/);
  });

  it('purge des jetons expirés', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    run(db, CONTROL_PLANE_SQL.refreshTokenInsert, 'old', 'f1', 'u1', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', null, '[]');
    insertToken(db, 'new', 'f2');
    run(db, CONTROL_PLANE_SQL.refreshTokenPurgeExpired, NOW);
    expect(all(db, 'SELECT token_hash FROM refresh_tokens')).toEqual([{ token_hash: 'new' }]);
  });
});

describe('passkey_credentials (PasskeyCredentialStore)', () => {
  const insert = (db: DatabaseSync, id: string, user: string, algorithm: number, be = 1, bs = 0, prf = 1): void =>
    run(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, id, user, 'cose-b64url', algorithm, 0, '["internal","hybrid"]', be, bs, prf, NOW);

  it('enregistre clé COSE, algorithme, compteur, transports, backup_*, prf_enabled', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insert(db, 'c1', 'u1', -7);
    expect(all(db, CONTROL_PLANE_SQL.passkeyCredentialFindById, 'c1')).toEqual([
      {
        credential_id: 'c1',
        user_id: 'u1',
        public_key_cose: 'cose-b64url',
        algorithm: -7,
        sign_count: 0,
        transports: '["internal","hybrid"]',
        backup_eligible: 1,
        backup_state: 0,
        prf_enabled: 1,
        created_at: NOW,
      },
    ]);
    insert(db, 'c2', 'u1', -8);
    expect(all(db, CONTROL_PLANE_SQL.passkeyCredentialListByUser, 'u1').map((row) => row['credential_id'])).toEqual(['c1', 'c2']);
  });

  it('algorithme limité à ES256 (-7) et EdDSA (-8) ; booléens 0/1 ; état de sauvegarde exige l\'éligibilité', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -257, 0, '[]', 1, 0, 0, NOW], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -7, 0, '[]', 2, 0, 0, NOW], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -7, 0, '[]', 1, 2, 0, NOW], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -7, 0, '[]', 0, 1, 0, NOW], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -7, 0, '[]', 1, 0, 3, NOW], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c', 'u1', 'k', -7, -1, '[]', 1, 0, 0, NOW], /CHECK constraint failed/);
  });

  it('insert refuse un doublon de credential_id (le port renvoie false sur cette contrainte)', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insert(db, 'c1', 'u1', -7);
    expectSqlError(db, CONTROL_PLANE_SQL.passkeyCredentialInsert, ['c1', 'u1', 'k', -7, 0, '[]', 1, 0, 0, NOW], /UNIQUE constraint failed|PRIMARY KEY/);
    expect(all(db, CONTROL_PLANE_SQL.passkeyCredentialInsertIgnore, 'c1', 'u1', 'k', -7, 0, '[]', 1, 0, 0, NOW)).toEqual([]);
  });

  it('updateSignCount est un compare-and-set sur la valeur précédente', () => {
    const db = openControlPlane();
    seedUser(db, 'u1', 'a@fisca.ma');
    insert(db, 'c1', 'u1', -7);
    expect(all(db, CONTROL_PLANE_SQL.passkeyCredentialUpdateSignCount, 'c1', 0, 5, 1)).toEqual([{ credential_id: 'c1' }]);
    expect(all(db, CONTROL_PLANE_SQL.passkeyCredentialUpdateSignCount, 'c1', 0, 6, 0)).toEqual([]);
    expect(all(db, `SELECT sign_count, backup_state FROM passkey_credentials`)).toEqual([{ sign_count: 5, backup_state: 1 }]);
  });
});

describe('processed_queue_messages (ERRATA D-19, Doc_04 § 06)', () => {
  it('revendication atomique : le premier consommateur gagne, le rejeu est ignoré ; par file', () => {
    const db = openControlPlane();
    const sha = 'a'.repeat(64);
    expect(all(db, CONTROL_PLANE_SQL.queueMessageClaim, 'fisca-notifications', 'evt-1', sha, NOW, '2026-11-16T10:00:00Z')).toEqual([{ event_id: 'evt-1' }]);
    expect(all(db, CONTROL_PLANE_SQL.queueMessageClaim, 'fisca-notifications', 'evt-1', sha, LATER, '2026-11-16T10:15:00Z')).toEqual([]);
    expect(all(db, CONTROL_PLANE_SQL.queueMessageClaim, 'fisca-xhub-clearance', 'evt-1', sha, NOW, '2026-11-16T10:00:00Z')).toEqual([{ event_id: 'evt-1' }]);
  });

  it('empreinte SHA-256 en 64 hexadécimaux minuscules, rétention strictement postérieure', () => {
    const db = openControlPlane();
    expectSqlError(db, CONTROL_PLANE_SQL.queueMessageClaim, ['q', 'e', 'court', NOW, '2026-11-16T10:00:00Z'], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.queueMessageClaim, ['q', 'e', 'A'.repeat(64), NOW, '2026-11-16T10:00:00Z'], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.queueMessageClaim, ['q', 'e', 'a'.repeat(64), NOW, NOW], /CHECK constraint failed/);
  });

  it('purge : supprime seulement les entrées dont la rétention de 72 h est échue', () => {
    const db = openControlPlane();
    const sha = 'b'.repeat(64);
    run(db, CONTROL_PLANE_SQL.queueMessageClaim, 'q', 'old', sha, '2026-11-01T10:00:00Z', '2026-11-04T10:00:00Z');
    run(db, CONTROL_PLANE_SQL.queueMessageClaim, 'q', 'new', sha, NOW, '2026-11-16T10:00:00Z');
    run(db, CONTROL_PLANE_SQL.queueMessagePurgeExpired, NOW);
    expect(all(db, 'SELECT event_id FROM processed_queue_messages')).toEqual([{ event_id: 'new' }]);
  });
});

describe('horodatages des tables ajoutées par le ticket', () => {
  it('refusent un format qui n\'est pas YYYY-MM-DDTHH:MM:SSZ', () => {
    const db = openControlPlane();
    expectSqlError(db, CONTROL_PLANE_SQL.oauthTransactionSave, ['s', 'n', 'v', 0, '2026-11-13 10:00:00'], /CHECK constraint failed/);
    expectSqlError(db, CONTROL_PLANE_SQL.oauthTransactionSave, ['s', 'n', 'v', 0, '1763028000'], /CHECK constraint failed/);
  });
});

describe('aucun objet hors périmètre ni valeur fiscale en dur', () => {
  it("le DDL ne contient aucun taux ni seuil fiscal : aucune ligne n'est insérée par les migrations", () => {
    const db = openControlPlane();
    for (const table of CONTROL_PLANE_TABLE_NAMES) {
      expect(all(db, `SELECT COUNT(*) AS n FROM "${table}"`), table).toEqual([{ n: 0 }]);
    }
    for (const migration of CONTROL_PLANE_MIGRATIONS) {
      for (const statement of migration.upSqlStatements) {
        expect(/^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement), statement).toBe(false);
      }
    }
  });
});
