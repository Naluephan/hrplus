/**
 * Leave management: leave-type configuration, submitting a request, and the
 * approve / reject decision path.
 *
 * The suite deliberately follows the order an HR team works in — configure a
 * leave type, then let an employee use it — so a failure points at the step
 * that broke rather than at a pile of unrelated fixtures.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';
import {
  createDepartment,
  createEmployee,
  createLeaveType,
  ensureWorkShift,
  grantEntitlement,
  requestLeave,
  type EmployeeFixture,
  type LeaveType,
} from '../support/factories';

describe('Leaves (e2e)', () => {
  let api: ApiClient;
  let employee: EmployeeFixture;
  let leaveType: LeaveType;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    // Leave calculation reads the tenant work shift, so it has to exist first.
    await ensureWorkShift(api);

    const department = await createDepartment(api);
    employee = await createEmployee(api, { departmentId: department.id });
    leaveType = await createLeaveType(api);

    // ...and a balance to draw the requests below from.
    await grantEntitlement(api, {
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      year: 2026,
      days: 20,
    });
  });

  afterAll(purgeTestTenantData);

  describe('leave types', () => {
    it('lists a newly created leave type', async () => {
      const response = await api.get('/leaves/type/list').expect(200);

      const items = Array.isArray(response.body) ? response.body : response.body.items;
      expect(items.map((item: { id: string }) => item.id)).toContain(leaveType.id);
    });

    it('renames a leave type', async () => {
      const created = await createLeaveType(api);
      const name = uniqueName('ลาพักร้อน (แก้ไข)');

      await api.put(`/leaves/type/${created.id}`).send({ name }).expect(200);

      const response = await api.get('/leaves/type/list').expect(200);
      const items = Array.isArray(response.body) ? response.body : response.body.items;
      const found = items.find((item: { id: string }) => item.id === created.id);
      expect(found.name).toBe(name);
    });

    it('rejects a leave type with no code', async () => {
      const response = await api.post('/leaves/type').send({ name: uniqueName('ไม่มีรหัส') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });
  });

  describe('submitting a request', () => {
    it('creates a pending leave request that appears in the leave list', async () => {
      const leave = await requestLeave(api, {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: '2026-04-06',
        endDate: '2026-04-07',
      });

      const response = await api
        .get('/leaves')
        .query({ employeeId: employee.id, limit: 100 })
        .expect(200);

      const found = listedLeaves(response.body).find((item) => item.id === leave.id);

      expect(found).toBeDefined();
      expect(found!.status).toBe('pending');
    });

    it('rejects a request whose employee id is not a UUID', async () => {
      const response = await api.post('/leaves/request').send({
        employeeId: 'not-a-uuid',
        leaveTypeId: leaveType.id,
        startDate: '2026-04-06',
        endDate: '2026-04-06',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeId');
    });

    it('rejects a request with no dates', async () => {
      const response = await api
        .post('/leaves/request')
        .send({ employeeId: employee.id, leaveTypeId: leaveType.id });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('startDate');
    });
  });

  describe('decisions', () => {
    it('marks a leave approved once HR approves it', async () => {
      const leave = await requestLeave(api, {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: '2026-05-04',
        endDate: '2026-05-04',
      });

      await api
        .post('/leaves/admin/approve')
        .send({ leaveId: leave.id, remark: 'อนุมัติโดยระบบทดสอบ' })
        .expect(201);

      const status = await readLeaveStatus(api, employee.id, leave.id);
      expect(status).toBe('approved');
    });

    it('marks a leave rejected once HR rejects it', async () => {
      const leave = await requestLeave(api, {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: '2026-05-11',
        endDate: '2026-05-11',
      });

      await api
        .post('/leaves/admin/reject')
        .send({ leaveId: leave.id, remark: 'ไม่อนุมัติโดยระบบทดสอบ' })
        .expect(201);

      const status = await readLeaveStatus(api, employee.id, leave.id);
      expect(status).toBe('rejected');
    });

    it('refuses to approve a leave that does not exist', async () => {
      const response = await api
        .post('/leaves/admin/approve')
        .send({ leaveId: '00000000-0000-4000-8000-00000000dead' });

      expect(response.status).toBe(404);
    });
  });
});

interface ListedLeave {
  id: string;
  status: string;
}

/** `GET /leaves` answers with a bare array; older builds wrapped it. */
function listedLeaves(body: unknown): ListedLeave[] {
  if (Array.isArray(body)) return body as ListedLeave[];
  const wrapper = body as { items?: ListedLeave[]; data?: ListedLeave[] };
  return wrapper.items ?? wrapper.data ?? [];
}

async function readLeaveStatus(
  api: ApiClient,
  employeeId: string,
  leaveId: string,
): Promise<string> {
  const response = await api.get('/leaves').query({ employeeId, limit: 100 }).expect(200);
  const found = listedLeaves(response.body).find((item) => item.id === leaveId);

  if (!found) {
    throw new Error(`Leave ${leaveId} not found in the tenant leave list`);
  }
  return found.status;
}
