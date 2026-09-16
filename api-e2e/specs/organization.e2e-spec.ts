/**
 * Departments and positions — the organisation structure everything else
 * hangs off. Covers the full CRUD lifecycle, listing behaviour and the
 * validation rules the DTOs declare.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueCode, uniqueName } from '../support/db';
import { createDepartment, createPosition } from '../support/factories';

describe('Organisation structure (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  describe('departments', () => {
    it('creates a department and returns it by id', async () => {
      const code = uniqueCode();
      const nameTh = uniqueName('ฝ่ายบุคคล');

      const created = await api.post('/departments').send({ code, nameTh }).expect(201);

      expect(created.body).toMatchObject({ code, nameTh });
      expect(created.body.id).toEqual(expect.any(String));

      const fetched = await api.get(`/departments/${created.body.id}`).expect(200);
      expect(fetched.body).toMatchObject({ id: created.body.id, code, nameTh });
    });

    it('lists departments of the current tenant with pagination metadata', async () => {
      const department = await createDepartment(api);

      const response = await api.get('/departments').query({ page: 1, limit: 100 }).expect(200);

      expect(response.body).toMatchObject({ page: 1, limit: 100 });
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.map((item: { id: string }) => item.id)).toContain(department.id);
    });

    it('finds a department by its Thai name via search', async () => {
      const department = await createDepartment(api);

      const response = await api
        .get('/departments')
        .query({ search: department.nameTh })
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].id).toBe(department.id);
    });

    it('updates a department', async () => {
      const department = await createDepartment(api);
      const nameTh = uniqueName('ฝ่ายบุคคล (แก้ไข)');

      await api.put(`/departments/${department.id}`).send({ nameTh }).expect(200);

      const fetched = await api.get(`/departments/${department.id}`).expect(200);
      expect(fetched.body.nameTh).toBe(nameTh);
    });

    it('deletes a department so it no longer appears in the list', async () => {
      const department = await createDepartment(api);

      await api.delete(`/departments/${department.id}`).expect(200);

      const response = await api.get('/departments').query({ limit: 100 }).expect(200);
      expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(
        department.id,
      );
    });

    it('rejects a code longer than the DTO allows', async () => {
      const response = await api
        .post('/departments')
        .send({ code: 'TOOLONG', nameTh: uniqueName('รหัสยาวเกิน') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });

    // KNOWN DEFECT — CreateDepartmentDto accepts `Length(1, 3)` but
    // `departments.code` is `varchar(2)`, so a three-character code is
    // accepted and then silently truncated on write. This test is expected to
    // fail; it will start failing loudly (as an unexpected pass) once the
    // column and the DTO agree, which is the signal to delete it.
    test.failing('stores a three-character code without truncating it', async () => {
      const code = 'XYZ';

      const created = await api
        .post('/departments')
        .send({ code, nameTh: uniqueName('รหัสสามตัว') })
        .expect(201);

      const fetched = await api.get(`/departments/${created.body.id}`).expect(200);
      expect(fetched.body.code).toBe(code);
    });

    it('rejects a department with no Thai name', async () => {
      await api.post('/departments').send({ code: uniqueCode() }).expect(400);
    });
  });

  describe('positions', () => {
    it('creates a position under a department and lists it by department', async () => {
      const department = await createDepartment(api);
      const position = await createPosition(api, department.id);

      const response = await api.get(`/positions/by-department/${department.id}`).expect(200);

      const items = Array.isArray(response.body) ? response.body : response.body.items;
      expect(items.map((item: { id: string }) => item.id)).toContain(position.id);
    });

    it('rejects a position whose department id is not a UUID', async () => {
      const response = await api
        .post('/positions')
        .send({ code: uniqueCode(), nameTh: uniqueName('ตำแหน่ง'), departmentId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('departmentId');
    });

    it('updates and then deletes a position', async () => {
      const department = await createDepartment(api);
      const position = await createPosition(api, department.id);
      const nameTh = uniqueName('ตำแหน่ง (แก้ไข)');

      await api.put(`/positions/${position.id}`).send({ nameTh }).expect(200);
      const updated = await api.get(`/positions/${position.id}`).expect(200);
      expect(updated.body.nameTh).toBe(nameTh);

      await api.delete(`/positions/${position.id}`).expect(200);
      await api.get(`/positions/${position.id}`).expect(404);
    });
  });
});
