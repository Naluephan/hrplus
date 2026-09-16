/**
 * Authenticated actors for the e2e suites.
 *
 * The suites authenticate the way the product does: an HR user posts to
 * `/auth/login` and gets a real access token back. Only the very first
 * account has to be seeded directly into the database — there is no API for
 * creating your own credentials from nothing, and bootstrapping it through
 * the API would be a lie about how the system is used anyway.
 *
 * Note on the system token (`JWT_SECRET` sent as a bearer): TenantScopeMiddleware
 * pins those requests to the hard-coded tenant `'3'`, ignoring `x-tenant-id`.
 * That makes it unusable for tenant-scoped fixtures, so suites use a real
 * logged-in HR user instead.
 */
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { Actor, apiClient, type ApiClient } from './api-client';
import { ensureTenant, getDataSource } from './db';
import { loadTestEnv } from './env';

/** Password used for every seeded account. Long enough for the login DTO. */
const HR_USER_PASSWORD = 'E2ePassword!2026';

/** Role name the leave/admin endpoints recognise as an administrator. */
const HR_ADMIN_ROLE_NAME = 'HR_ADMIN';

const cachedActors = new Map<string, Promise<Actor>>();

/**
 * An HR admin of the worker's test tenant, logged in through `/auth/login`.
 * Cached per Jest worker so the suites pay the bcrypt cost once.
 */
export async function hrUser(): Promise<Actor> {
  return hrUserFor(loadTestEnv().tenantId);
}

/** Convenience: an API client already carrying the HR user's credentials. */
export async function hrApi(): Promise<ApiClient> {
  return apiClient(await hrUser());
}

/**
 * An HR admin of an arbitrary tenant. For suites that need two tenants side by
 * side — isolation checks — rather than the worker's own.
 */
export async function hrUserFor(tenantId: string): Promise<Actor> {
  let actor = cachedActors.get(tenantId);
  if (!actor) {
    actor = seedAndLogin(tenantId);
    cachedActors.set(tenantId, actor);
  }
  return actor;
}

async function seedAndLogin(tenantId: string): Promise<Actor> {
  await ensureTenant(tenantId);

  const username = `e2e.admin@${tenantId.replace(/[^0-9a-z]/gi, '').slice(-12)}.test`;
  await seedLoginAccount(tenantId, username);

  // LoginDto validates tenantId as a UUID. Numeric tenants are sent without it;
  // the username is unique per tenant, so the API still resolves the right one.
  const body: Record<string, string> = { username, password: HR_USER_PASSWORD };
  if (UUID_PATTERN.test(tenantId)) body.tenantId = tenantId;

  const anonymous = await apiClient({});
  const response = await anonymous.post('/auth/login').send(body);

  if (response.status >= 300 || !response.body?.accessToken) {
    throw new Error(
      `Could not log the e2e HR user in for tenant ${tenantId} (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { token: response.body.accessToken, tenantId };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Creates the employee and its login row if they are not already present. */
async function seedLoginAccount(tenantId: string, username: string): Promise<void> {
  const dataSource = await getDataSource();

  const existing = await dataSource.query(
    'SELECT employee_id FROM employee_logins WHERE tenant_id = ? AND username = ?',
    [tenantId, username],
  );
  if (existing.length > 0) return;

  const employeeId = randomUUID();
  const passwordHash = await bcrypt.hash(HR_USER_PASSWORD, 10);

  await dataSource.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [employeeId, tenantId, 'E2E-ADMIN', 'E2E', 'Administrator', username],
  );

  await dataSource.query(
    `INSERT INTO employee_logins (tenant_id, employee_id, email, username, password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [tenantId, employeeId, username, username, passwordHash],
  );

  await grantHrAdminRole(tenantId, employeeId);
}

/**
 * Gives the seeded account the HR_ADMIN role, so it can reach the
 * administrative endpoints (approving leave on someone's behalf, for example).
 * Roles are global rather than tenant-scoped, so the role row is reused.
 */
async function grantHrAdminRole(tenantId: string, employeeId: string): Promise<void> {
  const dataSource = await getDataSource();

  const roleId = await findOrCreateHrAdminRole();

  await dataSource.query(
    `INSERT INTO employee_role_assignments (id, tenant_id, employee_id, role_id, created_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [randomUUID(), tenantId, employeeId, roleId],
  );
}

export { HR_USER_PASSWORD };

/**
 * Returns the HR_ADMIN role id, creating the role if it does not exist.
 *
 * Roles are global, and parallel workers all reach this on start-up at the same
 * moment. A plain check-then-insert would let two of them both see "missing" and
 * both insert. A MySQL named lock serialises the check and the insert; it is
 * taken on one pinned connection because GET_LOCK belongs to the connection that
 * acquired it, and a pooled query could otherwise release it on another.
 */
async function findOrCreateHrAdminRole(): Promise<string> {
  const runner = (await getDataSource()).createQueryRunner();
  await runner.connect();
  try {
    await runner.query("SELECT GET_LOCK('e2e_hr_admin_role', 30)");

    const [existing] = await runner.query(
      'SELECT id FROM roles WHERE name = ? ORDER BY created_at LIMIT 1',
      [HR_ADMIN_ROLE_NAME],
    );
    if (existing?.id) return existing.id;

    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, name, description, status, type, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'general', NOW(), NOW())`,
      [roleId, HR_ADMIN_ROLE_NAME, 'HR administrator (created by the e2e suite)'],
    );
    return roleId;
  } finally {
    await runner.query("SELECT RELEASE_LOCK('e2e_hr_admin_role')").catch(() => undefined);
    await runner.release();
  }
}
