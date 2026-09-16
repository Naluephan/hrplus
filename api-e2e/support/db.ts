/**
 * Database-side helpers for e2e suites.
 *
 * Two jobs only:
 *   1. guarantee the tenant the suites operate in exists;
 *   2. remove the rows a suite created, in foreign-key-safe order.
 *
 * Business data is created through the HTTP API (see `factories/`), never by
 * inserting rows here — a fixture that bypasses the API can drift from what
 * the API actually produces, and then the tests stop meaning anything.
 */
import { DataSource } from 'typeorm';

import { loadTestEnv } from './env';
import { getTestContext } from './test-app';

export async function getDataSource(): Promise<DataSource> {
  return (await getTestContext()).dataSource;
}

/**
 * Inserts the test tenant if it is not already there.
 * Idempotent, so every suite may call it from `beforeAll`.
 */
export async function ensureTestTenant(): Promise<string> {
  return ensureTenant(loadTestEnv().tenantId);
}

/** Inserts the given tenant if it is not already there. Idempotent. */
export async function ensureTenant(tenantId: string, name = 'E2E Test Tenant'): Promise<string> {
  const dataSource = await getDataSource();

  const existing = await dataSource.query('SELECT id FROM tenants WHERE id = ?', [tenantId]);
  if (existing.length === 0) {
    await dataSource.query(
      'INSERT INTO tenants (id, name, status, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [tenantId, name, 'active'],
    );
  }

  return tenantId;
}

/**
 * Deletes every row the worker's test tenant owns, across every table that has
 * a `tenant_id` column. See purgeTenantData.
 *
 * Call it from both `beforeAll` and `afterAll`: the `afterAll` keeps the
 * database tidy, and the `beforeAll` means a previous run that crashed
 * mid-suite cannot poison this one.
 */
export async function purgeTestTenantData(): Promise<void> {
  await purgeTenantData(loadTestEnv().tenantId);
}

/**
 * Deletes every row a tenant owns.
 *
 * The table list is discovered from the schema rather than hard-coded, so a
 * new module cannot quietly start leaving rows behind. Foreign-key checks are
 * suspended for the duration, which removes the need to get delete order right.
 *
 * Everything runs on one pinned connection. `SET FOREIGN_KEY_CHECKS` is
 * per-connection; issued through the pool, it can land on one connection while
 * the deletes run on others with checks still enabled.
 *
 * Caution for UUID tenant ids: in the integer `tenant_id` columns a UUID
 * compares equal to 0, so purging one UUID tenant also removes those rows for
 * every other UUID tenant. Worker tenants are numeric for exactly this reason.
 */
export async function purgeTenantData(tenantId: string): Promise<void> {
  const dataSource = await getDataSource();
  const tables = await tenantScopedTables(dataSource);

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tables) {
      await runner.query(`DELETE FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]);
    }
  } finally {
    await runner.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
    await runner.release();
  }
}

let tenantScopedTablesCache: string[] | undefined;

async function tenantScopedTables(dataSource: DataSource): Promise<string[]> {
  tenantScopedTablesCache ??= (
    await dataSource.query(
      `SELECT TABLE_NAME AS name
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND COLUMN_NAME = 'tenant_id'`,
    )
  ).map((row: { name: string }) => row.name);

  return tenantScopedTablesCache!;
}

/**
 * Code for the `code` columns of departments and positions.
 *
 * Two characters, not three: the DTOs accept `Length(1, 3)` but the columns
 * are `varchar(2)`, so a three-character code is silently truncated. See the
 * regression test in organization.e2e-spec.ts that documents that mismatch.
 */
let codeCounter = 0;
export function uniqueCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const n = codeCounter++ + Math.floor(Math.random() * 676);
  return alphabet[Math.floor(n / 26) % 26] + alphabet[n % 26];
}

/** Readable, unique-per-run name so assertions can target exactly one record. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
