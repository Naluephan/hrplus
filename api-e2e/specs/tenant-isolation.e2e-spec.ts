/**
 * Tenant isolation at the storage layer.
 *
 * `tenants.id` is char(36), and the product addresses tenants by UUID (LoginDto
 * validates `tenantId` as one). Eight tenant-scoped tables nonetheless declare
 * `tenant_id` as an integer:
 *
 *   work_shifts, work_shift_days, holiday_years, holiday_year_days,
 *   notifications, notification_recipients, role_permissions, position_role
 *
 * MySQL is not running in strict mode, so a UUID written to one of those
 * columns is silently stored as 0, and in a WHERE clause every UUID compares
 * equal to 0. Two different UUID tenants therefore read, overwrite and delete
 * the very same rows. For role_permissions that means one company's permission
 * changes apply to every other UUID company.
 *
 * The suite uses two UUID tenants of its own and never touches the numeric
 * worker tenants, which store correctly and are unaffected.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrUserFor } from '../support/auth';
import { ensureTenant, getDataSource, purgeTenantData, uniqueName } from '../support/db';

const TENANT_A = '00000000-0000-4000-8000-00000000a11a';
const TENANT_B = '00000000-0000-4000-8000-00000000b22b';

/** Monday–Friday, 08:00–17:00. Weekdays are 1–7. */
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorkingDay: weekday <= 5,
  workStartTime: '08:00',
  workEndTime: '17:00',
}));

const INTEGER_TENANT_TABLES = [
  'holiday_years',
  'holiday_year_days',
  'notifications',
  'notification_recipients',
  'position_role',
  'role_permissions',
  'work_shifts',
  'work_shift_days',
];

describe('Tenant isolation (e2e)', () => {
  let tenantA: ApiClient;
  let tenantB: ApiClient;

  beforeAll(async () => {
    await ensureTenant(TENANT_A, 'E2E Isolation Tenant A');
    await ensureTenant(TENANT_B, 'E2E Isolation Tenant B');
    await purgeTenantData(TENANT_A);
    await purgeTenantData(TENANT_B);

    tenantA = await apiClient(await hrUserFor(TENANT_A));
    tenantB = await apiClient(await hrUserFor(TENANT_B));
  });

  afterAll(async () => {
    await purgeTenantData(TENANT_A);
    await purgeTenantData(TENANT_B);
  });

  const listed = (body: any): any[] =>
    Array.isArray(body) ? body : (body.items ?? body.data ?? []);

  it('declares every tenant_id column with the same type as tenants.id', async () => {
    // The root cause, stated directly: this is the one line to fix in a
    // migration. Kept as a passing test that pins the current, known-wrong set,
    // so a new integer tenant_id column fails here instead of shipping quietly.
    const dataSource = await getDataSource();
    const rows: Array<{ t: string }> = await dataSource.query(
      `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'
          AND DATA_TYPE NOT IN ('char', 'varchar')
        ORDER BY TABLE_NAME`,
    );

    expect(rows.map((row) => row.t)).toEqual(INTEGER_TENANT_TABLES);
  });

  // KNOWN DEFECT (data isolation) — see the file header.
  test.failing('does not show tenant A its neighbour\'s work shift', async () => {
    const name = uniqueName('กะของบริษัท B');
    await tenantB
      .post('/work-shifts')
      .send({
        code: `ISO${Date.now().toString(36).slice(-4)}`,
        name,
        shiftType: 'morning',
        attendanceCondition: 'by_shift_time',
        latePolicyType: 'grace_period',
        lateGraceMinutes: 10,
        isActive: true,
        days: WEEK,
      })
      .expect(201);

    const seenByA = await tenantA.get('/work-shifts').expect(200);

    expect(listed(seenByA.body).map((shift) => shift.name)).not.toContain(name);
  });

  // KNOWN DEFECT (data isolation) — the consequence that hurts most in practice.
  test.failing('does not store a UUID tenant\'s rows under tenant 0', async () => {
    const dataSource = await getDataSource();
    await tenantA
      .post('/work-shifts')
      .send({
        code: `ISA${Date.now().toString(36).slice(-4)}`,
        name: uniqueName('กะของบริษัท A'),
        shiftType: 'morning',
        attendanceCondition: 'by_shift_time',
        latePolicyType: 'grace_period',
        lateGraceMinutes: 10,
        isActive: true,
        days: WEEK,
      })
      .expect(201);

    const collapsed = await dataSource.query('SELECT COUNT(*) AS n FROM work_shifts WHERE tenant_id = 0');

    expect(Number(collapsed[0].n)).toBe(0);
  });
});
