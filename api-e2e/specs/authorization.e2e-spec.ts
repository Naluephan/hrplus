/**
 * Which endpoints let an unauthenticated caller in.
 *
 * The individual module suites test what each endpoint *does*. This one asks a
 * single question of the whole surface: can someone who has never logged in
 * read or change a tenant's data by supplying nothing but a tenant id?
 *
 * Keeping the answer in one place means a new module that forgets its guard
 * shows up here as one obvious line, rather than being missed because nobody
 * thought to test for the absence of something.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';

/** A tenant with real data behind it — the point is what leaks, not what 404s. */
const SEEDED_TENANT_ID = '3';

/**
 * Endpoints that are reachable with no credentials at all. Every one of these
 * was confirmed against a running server, not inferred from the source.
 */
const UNGUARDED_READS = [
  '/roles',
  '/roles/permissions',
  '/payroll/dashboard/summary',
  '/payroll/dashboard/statistics',
  '/payroll-worktime',
  '/announcements',
  '/issue-reports',
  '/issue-report-categories',
  '/hr-stock',
  '/hr-stock/movements',
  '/birthday-gifts',
  '/birthday-gift-categories',
  '/birthday-gift-selections',
  '/equipment-requisitions',
  '/equipment-category-config',
  '/probation/employees',
  '/e-training',
  '/company-documents',
];

/** Endpoints that correctly refuse an anonymous caller — the control group. */
const GUARDED_READS = [
  '/employees',
  '/notifications/my',
  '/tenants/3/cleanup/preview',
  '/tenants/3/diagnostics/leave-approval',
  '/salary-access/approvers',
  '/salary-access/settings',
  '/salary-access/me',
  '/organization-settings',
];

describe('Authorization surface (e2e)', () => {
  let api: ApiClient;
  let anonymous: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    api = await apiClient();
    // No token, but a tenant id — exactly what an outsider can put together.
    anonymous = api.as({ tenantId: SEEDED_TENANT_ID });
  });

  afterAll(purgeTestTenantData);

  describe('endpoints that already require credentials', () => {
    it.each(GUARDED_READS)('refuses an anonymous caller on %s', async (route) => {
      const response = await anonymous.get(route);
      expect(response.status).toBe(401);
    });
  });

  describe('endpoints that do not require credentials', () => {
    // KNOWN DEFECT (security) — none of these controllers declares a guard.
    // They resolve the tenant from the `x-tenant-id` header alone, so anyone
    // who can reach the API and guess a tenant id can read that company's
    // announcements, payroll figures, stock, staff issue reports, probation
    // records and role permissions.
    //
    // Each is listed separately on purpose: as guards are added one module at a
    // time, each fixed endpoint turns this into a failing "unexpectedly passed"
    // line naming exactly what to delete from the list.
    test.failing.each(UNGUARDED_READS)('refuses an anonymous caller on %s', async (route) => {
      const response = await anonymous.get(route);
      expect(response.status).toBe(401);
    });
  });

  describe('anonymous writes to sensitive configuration', () => {
    // Guarded since 2026-09-15 — before that SalaryAccessController and
    // OrganizationSettingsController declared no guard, so a stranger could
    // remove every salary approver, switch off the salary page idle timeout, or
    // rewrite the company OT policy. Runs against the worker's own test tenant.
    it('refuses to replace the salary-access approvers without credentials', async () => {
      const actor = await hrUser();
      const response = await api
        .as({ tenantId: actor.tenantId })
        .put('/salary-access/approvers')
        .send({ employeeIds: [] });

      expect(response.status).toBe(401);
    });

    it('refuses to change the salary page idle timeout without credentials', async () => {
      const actor = await hrUser();
      const response = await api
        .as({ tenantId: actor.tenantId })
        .put('/salary-access/settings')
        .send({ idleTimeoutMinutes: 0 });

      expect(response.status).toBe(401);
    });

    it('refuses to change organization settings without credentials', async () => {
      const actor = await hrUser();
      const response = await api
        .as({ tenantId: actor.tenantId })
        .patch('/organization-settings')
        .send({ otCutoffTime: '17:00' });

      expect(response.status).toBe(401);
    });
  });

  describe('what an anonymous caller can actually see', () => {
    // KNOWN DEFECT (security) — spells out the consequence rather than just the
    // status code, so the risk is legible without running the request yourself.
    test.failing('does not hand a company payroll totals to a stranger', async () => {
      const response = await anonymous.get('/payroll/dashboard/summary');

      if (response.status === 401) return; // fixed — this test should now pass
      expect(response.body?.summary?.totalIncome).toBeUndefined();
    });

    test.failing('does not hand a company staff issue reports to a stranger', async () => {
      // Proven with data this suite creates, so the result does not depend on
      // what happens to be seeded: file a report as an authenticated HR user,
      // then try to read it back with no credentials at all.
      const hr = await hrApi();
      const category = await hr
        .post('/issue-report-categories')
        .send({ name: uniqueName('หมวดทดสอบสิทธิ์') })
        .expect(201);

      const description = uniqueName('เรื่องร้องเรียนที่ไม่ควรหลุด');
      await hr
        .post('/issue-reports')
        .send({ categoryId: String(category.body.id), description })
        .expect(201);

      const actor = await hrUser();
      const response = await api.as({ tenantId: actor.tenantId }).get('/issue-reports');

      if (response.status === 401) return; // fixed — this test should now pass

      const items = Array.isArray(response.body)
        ? response.body
        : (response.body.items ?? response.body.data ?? []);
      expect(items.map((item: { description?: string }) => item.description)).not.toContain(
        description,
      );
    });
  });
});
