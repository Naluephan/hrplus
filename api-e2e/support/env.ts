/**
 * Test environment loading and safety guards.
 *
 * E2E suites talk to a REAL database. To make that safe, this module:
 *   1. loads `.env.test` (preferred) falling back to `.env`;
 *   2. refuses to run against a database whose name does not look like a
 *      test database, unless the operator opts out explicitly.
 *
 * Nothing else in the test tree should read `process.env` directly.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { config as loadDotEnv } from 'dotenv';

export interface TestEnv {
  /** Database the suites will read from and write to. */
  databaseName: string;
  /** Value of JWT_SECRET — doubles as the system bypass token (see auth.ts). */
  jwtSecret: string;
  /** Global route prefix the app is mounted under, e.g. `api/v1`. */
  apiPrefix: string;
  /** Tenant every suite scopes its data to. */
  tenantId: string;
}

const ROOT = join(__dirname, '..', '..');

/** Database names we accept without an explicit override. */
const SAFE_DATABASE_PATTERN = /(^|[_-])test($|[_-])/i;

let cached: TestEnv | undefined;

export function loadTestEnv(): TestEnv {
  if (cached) return cached;

  const testEnvFile = join(ROOT, '.env.test');
  loadDotEnv({ path: existsSync(testEnvFile) ? testEnvFile : join(ROOT, '.env') });

  const databaseName =
    process.env.DB_DATABASE ?? process.env.DB_NAME ?? '';
  const jwtSecret = (process.env.JWT_SECRET ?? '').trim();

  assertSafeDatabase(databaseName);

  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET must be set for e2e tests — it is the system token the suites authenticate with.',
    );
  }

  cached = {
    databaseName,
    jwtSecret,
    apiPrefix: buildApiPrefix(),
    tenantId: resolveWorkerTenantId(),
  };
  return cached;
}

/**
 * One tenant per Jest worker.
 *
 * Suites purge their tenant before and after they run. With several workers
 * sharing a tenant, one worker's purge would delete the rows another worker is
 * in the middle of asserting on, so each worker gets its own.
 *
 * The ids are digits, not UUIDs, on purpose. Eight tenant-scoped tables
 * (work_shifts, holiday_years, notifications, role_permissions, ...) declare
 * `tenant_id` as an integer while `tenants.id` is char(36). MySQL is not in
 * strict mode here, so a UUID written to those columns silently becomes 0 —
 * every UUID tenant then shares one set of rows, and one worker's purge wipes
 * another's work shift. Numeric ids are stored faithfully in both column
 * types, so the workers stay isolated. The defect itself is asserted in
 * specs/tenant-isolation.e2e-spec.ts rather than hidden by this choice.
 *
 * TEST_TENANT_ID is the numeric base; worker N gets `<base>0N`.
 */
function resolveWorkerTenantId(): string {
  const base = (process.env.TEST_TENANT_ID ?? '9000').trim();
  if (!/^[0-9]+$/.test(base)) {
    throw new Error(
      `TEST_TENANT_ID must be digits (got "${base}"). UUID tenant ids collapse to 0 in the ` +
        'integer tenant_id columns, so parallel workers would delete the data of other workers.',
    );
  }
  const worker = Number(process.env.JEST_WORKER_ID ?? '1');
  return `${base}${String(worker).padStart(2, '0')}`;
}

function assertSafeDatabase(databaseName: string): void {
  if (process.env.ALLOW_UNSAFE_TEST_DB === '1') return;
  if (SAFE_DATABASE_PATTERN.test(databaseName)) return;

  throw new Error(
    [
      `Refusing to run e2e tests against database "${databaseName}".`,
      'E2E suites create and delete rows. Point DB_DATABASE at a dedicated',
      'test database (a name containing "test", e.g. hr_system_test) in .env.test,',
      'or set ALLOW_UNSAFE_TEST_DB=1 if you truly mean to use this one.',
    ].join('\n'),
  );
}

function buildApiPrefix(): string {
  const sanitize = (value: string | undefined) =>
    (value ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');

  const segments = [sanitize(process.env.API_PREFIX), sanitize(process.env.API_VERSION)].filter(
    (segment) => segment.length > 0,
  );

  return segments.length > 0 ? segments.join('/') : 'api/v1';
}
