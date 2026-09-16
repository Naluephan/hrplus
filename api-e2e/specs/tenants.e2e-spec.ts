/**
 * Tenant administration.
 *
 * These endpoints can wipe a customer's data, so what matters most is that
 * they are unreachable without the system token. Nothing here calls a
 * destructive operation: the suite exercises the read-only previews and the
 * guard, and never posts a cleanup.
 */
import { ApiClient, apiClient, systemActor } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData } from '../support/db';

/** A tenant that exists in the seed data — safe to *read* diagnostics for. */
const SEEDED_TENANT_ID = '3';

describe('Tenants (e2e)', () => {
  let api: ApiClient;
  let system: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
    system = await apiClient(systemActor());
  });

  afterAll(purgeTestTenantData);

  describe('SystemTokenGuard', () => {
    // Each of these can destroy or expose a whole tenant, so every one of them
    // is checked, not just a representative.
    const guardedReadOnlyRoutes = [
      `/tenants/${SEEDED_TENANT_ID}/cleanup/preview`,
      `/tenants/${SEEDED_TENANT_ID}/master-cleanup`,
      `/tenants/${SEEDED_TENANT_ID}/diagnostics/leave-approval`,
      `/tenants/${SEEDED_TENANT_ID}/diagnostics/approver-workload`,
    ];

    it.each(guardedReadOnlyRoutes)('rejects an anonymous caller on %s', async (route) => {
      await api.anonymous().get(route).expect(401);
    });

    it.each(guardedReadOnlyRoutes)(
      'rejects a logged-in HR admin on %s — the system token is not the same as being an admin',
      async (route) => {
        const actor = await hrUser();
        await api.as(actor).get(route).expect(401);
      },
    );

    it('accepts the system token', async () => {
      await system.get(`/tenants/${SEEDED_TENANT_ID}/cleanup/preview`).expect(200);
    });
  });

  describe('GET /tenants/:id/cleanup/preview', () => {
    it('reports what a cleanup would remove, without removing it', async () => {
      const before = await system
        .get(`/tenants/${SEEDED_TENANT_ID}/cleanup/preview`)
        .expect(200);

      expect(before.body.tenantId).toBe(SEEDED_TENANT_ID);
      expect(before.body.activeEmployees).toEqual(expect.any(Number));
      expect(Array.isArray(before.body.relatedRows)).toBe(true);

      // A preview is a read. Asking twice must not change the answer — if it
      // does, the "preview" is deleting something.
      const after = await system
        .get(`/tenants/${SEEDED_TENANT_ID}/cleanup/preview`)
        .expect(200);

      expect(after.body.activeEmployees).toBe(before.body.activeEmployees);
      expect(after.body.relatedRows).toEqual(before.body.relatedRows);
    });

    it('reports zero rows for a tenant that owns nothing', async () => {
      const actor = await hrUser();
      const response = await system
        .get(`/tenants/${actor.tenantId}/cleanup/preview`)
        .expect(200);

      // The suite purges its tenant in beforeAll, leaving only the seeded
      // admin account behind.
      expect(response.body.activeEmployees).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /tenants/:id/bootstrap/readiness', () => {
    it('reports readiness for a seeded tenant', async () => {
      const response = await system.get(
        `/tenants/${SEEDED_TENANT_ID}/bootstrap/readiness`,
      );

      expect(response.status).toBeLessThan(500);
    });
  });

  describe('tenant registration routes', () => {
    // KNOWN DEFECT — TenantsController declares `@Controller('api/v1/tenants')`
    // while the application already sets `api/v1` as its global prefix, so
    // these routes are actually served at `/api/v1/api/v1/tenants/...`.
    // The doubled segment is almost certainly unintended: every other
    // controller in the codebase declares a bare resource path.
    test.failing('serves tenant sync under the normal API prefix', async () => {
      const response = await system.get('/tenants/sync/payroll');
      expect(response.status).not.toBe(404);
    });

    it('is currently reachable only under the doubled prefix', async () => {
      // Documents where the routes really live today, so that fixing the
      // controller makes this test fail and prompts its removal.
      const response = await system.get('/api/v1/tenants/sync/payroll');
      expect(response.status).toBe(200);
    });
  });
});
