/**
 * Employee lifecycle: create, read, filter, update, delete — plus the
 * validation and tenant-isolation rules that protect employee records.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';
import { createDepartment, createEmployee, createPosition } from '../support/factories';

describe('Employees (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  describe('POST /employees', () => {
    it('creates an employee and echoes back the submitted identity', async () => {
      const firstName = 'สมชาย';
      const lastName = uniqueName('ใจดี');

      const response = await api
        .post('/employees')
        .send({ firstName, lastName, email: `${Date.now()}@example.test` })
        .expect(201);

      expect(response.body).toMatchObject({ firstName, lastName });
      expect(response.body.id).toEqual(expect.any(String));
    });

    it('links the employee to a department and position', async () => {
      const department = await createDepartment(api);
      const position = await createPosition(api, department.id);

      const employee = await createEmployee(api, {
        departmentId: department.id,
        positionId: position.id,
      });

      const response = await api.get(`/employees/${employee.id}`).expect(200);
      expect(response.body.departmentId ?? response.body.department?.id).toBe(department.id);
      expect(response.body.positionId ?? response.body.position?.id).toBe(position.id);
    });

    it('rejects an employee with no name', async () => {
      const response = await api.post('/employees').send({ email: 'nameless@example.test' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('firstName');
    });

    it('rejects a malformed email address', async () => {
      const response = await api
        .post('/employees')
        .send({ firstName: 'ทดสอบ', lastName: 'อีเมลผิด', email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('email');
    });
  });

  describe('GET /employees', () => {
    it('returns the tenant employees with pagination metadata', async () => {
      const employee = await createEmployee(api);

      const response = await api.get('/employees').query({ page: 1, limit: 100 }).expect(200);

      expect(response.body).toMatchObject({ page: 1, limit: 100 });
      expect(response.body.total).toBeGreaterThan(0);
      expect(response.body.items.map((item: { id: string }) => item.id)).toContain(employee.id);
    });

    // KNOWN DEFECT — the global ValidationPipe runs with `whitelist: true`,
    // which strips the private `@Expose`-backed fields ListEmployeesDto uses to
    // accept both camelCase and snake_case query parameters. The getters then
    // read undefined, so every filter on this endpoint is silently ignored and
    // an invalid value is silently accepted. The two tests below are expected
    // to fail until the DTO and the pipe agree; delete the `.failing` marker
    // when they do.
    test.failing('filters by department, excluding employees of other departments', async () => {
      const wanted = await createDepartment(api);
      const other = await createDepartment(api);
      const inDepartment = await createEmployee(api, { departmentId: wanted.id });
      const elsewhere = await createEmployee(api, { departmentId: other.id });

      const response = await api
        .get('/employees')
        .query({ departmentId: wanted.id, limit: 100 })
        .expect(200);

      const ids = response.body.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(inDepartment.id);
      expect(ids).not.toContain(elsewhere.id);
    });

    it('finds an employee by last name via search', async () => {
      const employee = await createEmployee(api, { lastName: uniqueName('นามสกุลค้นหา') });

      const response = await api
        .get('/employees')
        .query({ search: employee.lastName, limit: 100 })
        .expect(200);

      expect(response.body.items.map((item: { id: string }) => item.id)).toContain(employee.id);
    });

    test.failing('rejects a departmentId that is not a UUID', async () => {
      await api.get('/employees').query({ departmentId: 'nope' }).expect(400);
    });

    it('honours the page size', async () => {
      // Created one at a time: concurrent creates collide on the generated
      // account-access username (see docs/TESTING.md, known defects).
      await createEmployee(api);
      await createEmployee(api);
      await createEmployee(api);

      const response = await api.get('/employees').query({ page: 1, limit: 2 }).expect(200);

      expect(response.body.items.length).toBeLessThanOrEqual(2);
      expect(response.body.limit).toBe(2);
    });
  });

  describe('GET /employees/:id', () => {
    it('returns 404 for an employee that does not exist', async () => {
      await api.get('/employees/00000000-0000-4000-8000-00000000dead').expect(404);
    });

    it('ignores a spoofed x-tenant-id header and serves the tenant in the token', async () => {
      const employee = await createEmployee(api);

      // A caller who points the tenant header at somebody else's tenant must
      // not be able to change which tenant the request reads from: the tenant
      // baked into the access token is the one that counts.
      const response = await api
        .as({ token: (await hrUser()).token, tenantId: '00000000-0000-4000-8000-0000000e2e99' })
        .get(`/employees/${employee.id}`)
        .expect(200);

      expect(response.body.id).toBe(employee.id);
    });
  });

  describe('PUT /employees/:id', () => {
    it('updates the employee and persists the change', async () => {
      const employee = await createEmployee(api);
      const nickname = uniqueName('ชื่อเล่น');

      await api.put(`/employees/${employee.id}`).send({ nickname }).expect(200);

      const fetched = await api.get(`/employees/${employee.id}`).expect(200);
      expect(fetched.body.nickname).toBe(nickname);
    });
  });

  describe('DELETE /employees/:id', () => {
    it('removes the employee from the tenant listing', async () => {
      const employee = await createEmployee(api);

      await api.delete(`/employees/${employee.id}`).expect(200);

      const response = await api.get('/employees').query({ limit: 100 }).expect(200);
      expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(
        employee.id,
      );
    });
  });
});
