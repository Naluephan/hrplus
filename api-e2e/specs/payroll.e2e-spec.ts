/**
 * Payroll: the dashboard aggregates, the worktime summaries that feed them,
 * and payslip access.
 *
 * Payroll answers questions about money and about individual people's pay, so
 * the two properties worth testing are: are the numbers internally consistent,
 * and is any of it reachable by someone who should not see it.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData } from '../support/db';

/** A tenant with real payroll data, for reading aggregates. */
const SEEDED_TENANT_ID = '3';

describe('Payroll (e2e)', () => {
  let api: ApiClient;
  let seeded: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    const actor = await hrUser();
    seeded = api.as({ token: actor.token, tenantId: SEEDED_TENANT_ID });
  });

  afterAll(purgeTestTenantData);

  describe('GET /payroll/dashboard/summary', () => {
    it('returns a summary whose totals add up', async () => {
      const response = await seeded.get('/payroll/dashboard/summary').expect(200);

      const { summary } = response.body;
      expect(summary).toBeDefined();
      expect(summary.totalIncome).toEqual(expect.any(Number));
      expect(summary.totalDeductions).toEqual(expect.any(Number));

      // Net pay is what the company actually transfers; if it disagrees with
      // income minus deductions, one of the three numbers is wrong.
      const net = summary.netTotal ?? summary.netPay ?? summary.totalNet;
      if (typeof net === 'number') {
        expect(net).toBeCloseTo(summary.totalIncome - summary.totalDeductions, 2);
      }
    });

    it('never reports more employees with salary than employees in total', async () => {
      const response = await seeded.get('/payroll/dashboard/summary').expect(200);

      const { summary } = response.body;
      expect(summary.employeesWithSalary).toBeLessThanOrEqual(summary.totalEmployees);
    });

    it('rejects a month outside 1-12', async () => {
      const response = await seeded
        .get('/payroll/dashboard/summary')
        .query({ month: 13, year: 2026 });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a tenant that has no salary period yet', async () => {
      // Worth a second look during design review: a brand-new tenant has no
      // salary period, so its payroll dashboard 404s on day one rather than
      // showing an empty state. The API is consistent about it, so the test
      // records the contract as it stands instead of asserting a preference.
      const response = await api.get('/payroll/dashboard/summary');

      expect(response.status).toBe(404);
    });
  });

  describe('payroll dashboard breakdowns', () => {
    const breakdowns = [
      '/payroll/dashboard/statistics',
      '/payroll/dashboard/expenses-by-department',
      '/payroll/dashboard/expenses-by-position',
      '/payroll/dashboard/components-breakdown',
      '/payroll/dashboard/deductions-breakdown',
    ];

    it.each(breakdowns)('answers %s without failing', async (route) => {
      const response = await seeded.get(route);
      expect(response.status).toBe(200);
    });

    it('reports department expenses that do not exceed the overall total', async () => {
      const [summary, byDepartment] = await Promise.all([
        seeded.get('/payroll/dashboard/summary').expect(200),
        seeded.get('/payroll/dashboard/expenses-by-department').expect(200),
      ]);

      const rows: Array<{ totalExpense?: number; total?: number }> =
        byDepartment.body.data ?? byDepartment.body.items ?? byDepartment.body ?? [];
      if (!Array.isArray(rows) || rows.length === 0) return;

      const summed = rows.reduce(
        (total, row) => total + (row.totalExpense ?? row.total ?? 0),
        0,
      );

      // Departments partition the workforce, so their expenses cannot add up
      // to more than the company-wide figure (small rounding aside).
      expect(summed).toBeLessThanOrEqual(summary.body.summary.totalIncome + 1);
    });
  });

  describe('GET /payroll-worktime', () => {
    it('lists worktime summaries for a period', async () => {
      const response = await seeded
        .get('/payroll-worktime')
        .query({ month: 1, year: 2027 })
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('rejects a month outside 1-12', async () => {
      const response = await seeded.get('/payroll-worktime').query({ month: 0, year: 2027 });

      expect(response.status).toBe(400);
    });
  });

  describe('payslips are private', () => {
    it('refuses an anonymous payslip lookup', async () => {
      await api
        .anonymous()
        .post('/salary-slip/check')
        .send({ employeeId: 'anyone', month: 1, year: 2027 })
        .expect(401);
    });

    it('refuses to stream a payslip file without credentials', async () => {
      await api
        .anonymous()
        .get('/salary-slip/file')
        .query({ url: 'https://example.test/slip.pdf' })
        .expect(401);
    });
  });

  describe('exposure', () => {
    // KNOWN DEFECT (security) — neither PayrollDashboardController nor
    // PayrollWorktimeController carries a guard; they take the tenant from the
    // `x-tenant-id` header alone. Anyone who can reach the API and guess a
    // tenant id can read that company's salary totals, headcount and
    // deductions. Expected to fail until the controllers are guarded.
    const unguarded = [
      '/payroll/dashboard/summary',
      '/payroll/dashboard/statistics',
      '/payroll/dashboard/expenses-by-department',
      '/payroll-worktime',
    ];

    test.failing.each(unguarded)('refuses an anonymous caller on %s', async (route) => {
      const response = await api
        .as({ tenantId: SEEDED_TENANT_ID })
        .get(route)
        .query({ month: 1, year: 2027 });

      expect(response.status).toBe(401);
    });
  });
});
