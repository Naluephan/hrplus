/**
 * The configuration catalogues behind the HR Settings screens: benefits,
 * employment types, levels, tags, the settings view of departments, menu
 * permissions and per-employee check-in areas, plus the standalone catalogues
 * the rest of the product picks from — work shifts, holiday years and their
 * days, employee statuses, rejection reasons, application sources, tag groups.
 *
 * Every catalogue is asserted on the same four properties, because that is
 * what the screens promise: a created item appears in its list, a rename is
 * visible on reread, a delete removes it (and a second delete is a 404), and
 * nothing created here is visible to another tenant.
 *
 * Three things shape the suite:
 *
 *   1. The modules disagree about where the tenant comes from. Most read the
 *      request context (`resolveTenantIdOrThrow`), `/settings/benefits` reads
 *      a `tenantId` query parameter on its list, and the holiday endpoints
 *      read it out of the request body. Where that lets one tenant act on
 *      another's rows, the test asserts the correct behaviour and is marked
 *      `test.failing`.
 *   2. Several bodies are plain TypeScript types rather than decorated DTO
 *      classes, so the global ValidationPipe has no metadata and validates
 *      nothing. Those cases are marked `test.failing` too.
 *   3. Import and export are deliberately out of scope — see the note at the
 *      bottom of this file.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUserFor } from '../support/auth';
import {
  ensureTestTenant,
  purgeTenantData,
  purgeTestTenantData,
  uniqueCode,
  uniqueName,
} from '../support/db';
import { loadTestEnv } from '../support/env';
import { createDepartment, createEmployee, type EmployeeFixture } from '../support/factories';

/** An id of the right shape that no record has. */
const MISSING_UUID = '00000000-0000-4000-8000-00000000dead';
/** The numeric equivalent, for the catalogues keyed by a bigint. */
const MISSING_NUMERIC_ID = 999999999;

describe('Settings catalogues (e2e)', () => {
  let api: ApiClient;
  /** The worker's own tenant — several endpoints want it in the request. */
  const tenantId = loadTestEnv().tenantId;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  // ─── local fixtures ────────────────────────────────────────────────────────
  // These live in the spec rather than in support/factories because this is the
  // only suite that configures these catalogues.

  /** Fails loudly with the server's own body, so one broken fixture does not
   *  become a dozen confusing failures further down. */
  const created = (response: { status: number; body: any }, what: string) => {
    if (response.status >= 300 || response.body?.id === undefined) {
      throw new Error(
        `Could not create a ${what} fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return response.body;
  };

  const createBenefit = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      name: uniqueName('สวัสดิการทดสอบ'),
      benefitType: 'required',
      // `status` is only optional on paper — see the defect test below. Every
      // fixture sends it so one backend bug does not fail this whole suite.
      status: 'active',
      ...overrides,
    };
    const response = await api.post('/settings/benefits').send(payload);
    return { id: String(created(response, 'benefit').id), payload };
  };

  /**
   * The benefits list is the one endpoint here that ignores the request tenant
   * and reads `?tenantId` instead, so every read has to carry it. The defect
   * itself is pinned by its own test below.
   */
  const listBenefits = async (query: Record<string, unknown> = {}) =>
    (await api.get('/settings/benefits').query({ tenantId, limit: 200, ...query }).expect(200)).body;

  const createEmploymentType = async (overrides: Record<string, unknown> = {}) => {
    const payload = { nameTh: uniqueName('ประเภทจ้างทดสอบ'), ...overrides };
    const response = await api.post('/settings/employment-types').send(payload);
    return { id: String(created(response, 'employment type').id), payload };
  };

  const createLevel = async (overrides: Record<string, unknown> = {}) => {
    const payload = { nameTh: uniqueName('ระดับทดสอบ'), level: 1, ...overrides };
    const response = await api.post('/settings/levels').send(payload);
    return { id: String(created(response, 'level').id), payload };
  };

  const createTag = async (overrides: Record<string, unknown> = {}) => {
    const payload = { name: uniqueName('ป้ายทดสอบ'), ...overrides };
    const response = await api.post('/settings/tags').send(payload);
    return { id: String(created(response, 'tag').id), payload };
  };

  const createSettingsDepartment = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      code: uniqueCode(),
      nameTh: uniqueName('แผนกตั้งค่าทดสอบ'),
      nameEn: uniqueName('Settings Department'),
      ...overrides,
    };
    const response = await api.post('/settings/departments').send(payload);
    return { id: String(created(response, 'settings department').id), payload };
  };

  /** Monday–Friday working, 08:00–17:00 with an hour for lunch. */
  const STANDARD_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    isWorkingDay: weekday <= 5,
    workStartTime: '08:00',
    workEndTime: '17:00',
    breakStartTime: '12:00',
    breakEndTime: '13:00',
  }));

  const createWorkShift = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      code: `E2E${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 100)}`,
      name: uniqueName('กะทดสอบ'),
      shiftType: 'morning',
      attendanceCondition: 'by_shift_time',
      latePolicyType: 'grace_period',
      lateGraceMinutes: 15,
      isActive: true,
      days: STANDARD_WEEK,
      ...overrides,
    };
    const response = await api.post('/work-shifts').send(payload);
    return { id: Number(created(response, 'work shift').id), payload };
  };

  /**
   * Holiday years and days are keyed by a numeric tenant and take it from the
   * request body rather than from the request context, so the caller has to
   * send it explicitly.
   */
  const numericTenantId = Number(tenantId);

  const createHolidayYear = async (overrides: Record<string, unknown> = {}) => {
    const payload = { tenantId: numericTenantId, year: 2094, ...overrides };
    const response = await api.post('/holiday-years').send(payload);
    return { id: Number(created(response, 'holiday year').id), payload };
  };

  const createHolidayDay = async (holidayYearId: number, overrides: Record<string, unknown> = {}) => {
    const payload = {
      tenantId: numericTenantId,
      holidayYearId,
      name: uniqueName('วันหยุดทดสอบ'),
      dateStart: '2094-04-13',
      dateEnd: '2094-04-15',
      ...overrides,
    };
    const response = await api.post('/holiday-year-days').send(payload);
    return { id: Number(created(response, 'holiday day').id), payload };
  };

  const listHolidayDays = async (holidayYearId: number) =>
    (
      await api
        .post('/holiday-year-days/by-year')
        .send({ tenantId: numericTenantId, holidayYearId })
        .expect(201)
    ).body as Array<{ id: string; name: string }>;

  const createEmployeeStatus = async (overrides: Record<string, unknown> = {}) => {
    const payload = { name: uniqueName('สถานะทดสอบ'), ...overrides };
    const response = await api.post('/employee-statuses').send(payload);
    return { id: String(created(response, 'employee status').id), payload };
  };

  const createRejectionReason = async (overrides: Record<string, unknown> = {}) => {
    const payload = { reason: uniqueName('เหตุผลทดสอบ'), order: 1, ...overrides };
    const response = await api.post('/rejection-reasons').send(payload);
    return { id: String(created(response, 'rejection reason').id), payload };
  };

  const createSourceOption = async (overrides: Record<string, unknown> = {}) => {
    const payload = { label: uniqueName('ช่องทางทดสอบ'), order: 1, ...overrides };
    const response = await api.post('/application-source-options').send(payload);
    return { id: String(created(response, 'application source option').id), payload };
  };

  const idsOf = (rows: Array<{ id: string | number }>) => rows.map((row) => String(row.id));

  // ───────────────────────────────────────────────────────────────────────────
  describe('benefits', () => {
    test.failing('creates a benefit without being told a status', async () => {
      // Defect: `benefits.status` is NOT NULL, but SettingsBenefitsService.create
      // writes `null` whenever the caller omits `status`
      // (settings-benefits.service.ts: `typeof dto.status === 'string' ? ... : null`),
      // so the request dies as a 500 with raw SQL instead of defaulting to
      // 'active' the way the controller's own tenant bootstrap does.
      const response = await api
        .post('/settings/benefits')
        .send({ name: uniqueName('สวัสดิการไม่ระบุสถานะ'), benefitType: 'required' });

      expect(response.status).toBeLessThan(300);
    });

    it('creates a benefit that the list shows back', async () => {
      const { id, payload } = await createBenefit();

      const body = await listBenefits();

      const found = body.items.find((item: { id: string }) => item.id === id);
      expect(found).toMatchObject({ name: payload.name, benefitType: 'required' });
    });

    it('renames a benefit and the change sticks', async () => {
      const { id } = await createBenefit();
      const renamed = uniqueName('เปลี่ยนชื่อสวัสดิการ');

      await api.put(`/settings/benefits/${id}`).send({ name: renamed }).expect(200);

      const body = await listBenefits();
      expect(body.items.find((item: { id: string }) => item.id === id).name).toBe(renamed);
    });

    it('changes the benefit type', async () => {
      const { id } = await createBenefit({ benefitType: 'required' });

      const response = await api
        .put(`/settings/benefits/${id}`)
        .send({ benefitType: 'optional' })
        .expect(200);

      expect(response.body.benefitType).toBe('optional');
    });

    it('filters the list by benefit type', async () => {
      const required = await createBenefit({ benefitType: 'required' });
      const optional = await createBenefit({ benefitType: 'optional' });

      const body = await listBenefits({ benefitType: 'optional' });

      expect(idsOf(body.items)).toContain(optional.id);
      expect(idsOf(body.items)).not.toContain(required.id);
    });

    it('deletes a benefit, and a second delete answers 404', async () => {
      const { id } = await createBenefit();

      await api.delete(`/settings/benefits/${id}`).expect(200);

      const body = await listBenefits();
      expect(idsOf(body.items)).not.toContain(id);
      expect((await api.delete(`/settings/benefits/${id}`)).status).toBe(404);
    });

    it('answers 404 when updating a benefit that does not exist', async () => {
      const response = await api.put(`/settings/benefits/${MISSING_UUID}`).send({ name: 'x' });

      expect(response.status).toBe(404);
    });

    it('refuses a benefit with no name', async () => {
      const response = await api.post('/settings/benefits').send({ benefitType: 'required' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('name');
    });

    it('refuses a benefit type outside the allowed pair', async () => {
      const response = await api
        .post('/settings/benefits')
        .send({ name: uniqueName('ผิดประเภท'), benefitType: 'mandatory' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('benefitType');
    });

    test.failing('lists the benefits of the calling tenant without a query parameter', async () => {
      // Defect: SettingsBenefitsController.list reads the tenant only from
      // `?tenantId` / `?tenant_id` and returns an empty page when it is absent,
      // ignoring the authenticated tenant that every other endpoint in the
      // module uses. A caller who omits the parameter is told, with a 200, that
      // the tenant has no benefits at all.
      const { id } = await createBenefit();

      const response = await api.get('/settings/benefits').query({ limit: 200 }).expect(200);

      expect(idsOf(response.body.items)).toContain(id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('employment types', () => {
    it('creates an employment type that the list shows back', async () => {
      const { id, payload } = await createEmploymentType();

      const response = await api.get('/settings/employment-types').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id)).toMatchObject({
        nameTh: payload.nameTh,
        // The DTO leaves status optional and the service defaults it to active.
        status: 1,
      });
    });

    it('reads one employment type by id', async () => {
      const { id, payload } = await createEmploymentType();

      const response = await api.get(`/settings/employment-types/${id}`).expect(200);

      expect(response.body.nameTh).toBe(payload.nameTh);
    });

    it('renames an employment type and the change sticks', async () => {
      const { id } = await createEmploymentType();
      const renamed = uniqueName('เปลี่ยนชื่อประเภทจ้าง');

      await api.put(`/settings/employment-types/${id}`).send({ nameTh: renamed }).expect(200);

      expect((await api.get(`/settings/employment-types/${id}`).expect(200)).body.nameTh).toBe(
        renamed,
      );
    });

    it('deletes an employment type, and a second delete answers 404', async () => {
      const { id } = await createEmploymentType();

      await api.delete(`/settings/employment-types/${id}`).expect(200);

      expect((await api.get(`/settings/employment-types/${id}`)).status).toBe(404);
      expect((await api.delete(`/settings/employment-types/${id}`)).status).toBe(404);
    });

    it('refuses an employment type with no Thai name', async () => {
      const response = await api.post('/settings/employment-types').send({ nameEn: 'No Thai name' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('nameTh');
    });

    it('refuses a code longer than the column holds', async () => {
      // `code` is MaxLength(2) in the DTO because the column is varchar(2).
      const response = await api
        .post('/settings/employment-types')
        .send({ nameTh: uniqueName('รหัสยาว'), code: 'ABCD' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });

    test.failing('refuses a second employment type with a name already in use', async () => {
      // Defect: the table carries a unique index on (tenant_id, name_th)
      // — IDX_employment_types_tenant_name_unique — but
      // SettingsEmploymentTypesService.create neither checks for the clash nor
      // catches the QueryFailedError, so the duplicate surfaces as a 500 with a
      // raw SQL message instead of a 400/409 the settings screen can show.
      const { payload } = await createEmploymentType();

      const response = await api.post('/settings/employment-types').send({ nameTh: payload.nameTh });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('levels', () => {
    it('creates a level that the list shows back', async () => {
      const { id, payload } = await createLevel({ level: 5 });

      const response = await api.get('/settings/levels').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id)).toMatchObject({
        nameTh: payload.nameTh,
        level: 5,
      });
    });

    it('attaches benefits to a level and returns them split by type', async () => {
      const required = await createBenefit({ benefitType: 'required' });
      const optional = await createBenefit({ benefitType: 'optional' });

      const response = await api
        .post('/settings/levels')
        .send({
          nameTh: uniqueName('ระดับพร้อมสวัสดิการ'),
          level: 6,
          benefitIds: [required.id, optional.id],
        })
        .expect(201);

      expect(idsOf(response.body.benefits.required)).toEqual([required.id]);
      expect(idsOf(response.body.benefits.optional)).toEqual([optional.id]);
    });

    it('renames a level and the change sticks', async () => {
      const { id } = await createLevel({ level: 7 });
      const renamed = uniqueName('เปลี่ยนชื่อระดับ');

      await api.put(`/settings/levels/${id}`).send({ nameTh: renamed }).expect(200);

      const response = await api.get('/settings/levels').expect(200);
      expect(response.body.find((row: { id: string }) => row.id === id).nameTh).toBe(renamed);
    });

    it('reorders the levels, and the list comes back in the new order', async () => {
      // The list is ordered by `level`, which is what the settings screen drags
      // around, so a reorder has to be visible on the very next read.
      const first = await createLevel({ level: 20 });
      const second = await createLevel({ level: 21 });

      await api
        .put('/settings/levels/reorder')
        .send({
          items: [
            { id: first.id, level: 21 },
            { id: second.id, level: 20 },
          ],
        })
        .expect(200);

      const response = await api.get('/settings/levels').expect(200);
      const ordered = response.body
        .filter((row: { id: string }) => row.id === first.id || row.id === second.id)
        .map((row: { id: string }) => row.id);
      expect(ordered).toEqual([second.id, first.id]);
    });

    it('answers 404 when the reorder names a level that does not exist', async () => {
      const response = await api
        .put('/settings/levels/reorder')
        .send({ items: [{ id: MISSING_UUID, level: 3 }] });

      expect(response.status).toBe(404);
    });

    it('refuses a reorder that names the same level twice', async () => {
      const { id } = await createLevel({ level: 22 });

      const response = await api.put('/settings/levels/reorder').send({
        items: [
          { id, level: 1 },
          { id, level: 2 },
        ],
      });

      // Two positions for one level is ambiguous — the last write would win
      // silently otherwise.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('Duplicate');
    });

    it('refuses an empty reorder', async () => {
      const response = await api.put('/settings/levels/reorder').send({ items: [] });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('items');
    });

    it('deletes a level, and a second delete answers 404', async () => {
      const { id } = await createLevel({ level: 23 });

      await api.delete(`/settings/levels/${id}`).expect(200);

      const response = await api.get('/settings/levels').expect(200);
      expect(idsOf(response.body)).not.toContain(id);
      expect((await api.delete(`/settings/levels/${id}`)).status).toBe(404);
    });

    it('answers 404 when updating a level that does not exist', async () => {
      const response = await api.put(`/settings/levels/${MISSING_UUID}`).send({ level: 2 });

      expect(response.status).toBe(404);
    });

    it('refuses a level with no rank', async () => {
      const response = await api.post('/settings/levels').send({ nameTh: uniqueName('ไม่มีลำดับ') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('level');
    });

    it('refuses a rank outside 0–255', async () => {
      const response = await api
        .post('/settings/levels')
        .send({ nameTh: uniqueName('ลำดับเกิน'), level: 300 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('level');
    });

    it('answers 404 for a benefit id that belongs to no tenant', async () => {
      const response = await api
        .post('/settings/levels')
        .send({ nameTh: uniqueName('สวัสดิการไม่มีจริง'), level: 24, benefitIds: [MISSING_UUID] });

      expect(response.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('tags', () => {
    it('creates a tag that the list shows back', async () => {
      const { id, payload } = await createTag({ color: '#ff0000' });

      const response = await api.get('/settings/tags').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id)).toMatchObject({
        name: payload.name,
        color: '#ff0000',
      });
    });

    it('renames a tag and the change sticks', async () => {
      const { id } = await createTag();
      const renamed = uniqueName('เปลี่ยนชื่อป้าย');

      await api.put(`/settings/tags/${id}`).send({ name: renamed }).expect(200);

      const response = await api.get('/settings/tags').expect(200);
      expect(response.body.find((row: { id: string }) => row.id === id).name).toBe(renamed);
    });

    it('deletes a tag, and a second delete answers 404', async () => {
      const { id } = await createTag();

      await api.delete(`/settings/tags/${id}`).expect(200);

      const response = await api.get('/settings/tags').expect(200);
      expect(idsOf(response.body)).not.toContain(id);
      expect((await api.delete(`/settings/tags/${id}`)).status).toBe(404);
    });

    it('answers 404 when updating a tag that does not exist', async () => {
      const response = await api.put(`/settings/tags/${MISSING_UUID}`).send({ name: 'x' });

      expect(response.status).toBe(404);
    });

    it('refuses a rename to an empty name', async () => {
      const { id } = await createTag();

      const response = await api.put(`/settings/tags/${id}`).send({ name: '   ' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('name');
    });

    it('refuses a tag with no name', async () => {
      const response = await api.post('/settings/tags').send({ color: '#123456' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('name');
    });

    it('answers 404 for a tag group that does not exist', async () => {
      const response = await api
        .post('/settings/tags')
        .send({ name: uniqueName('กลุ่มไม่มีจริง'), tagGroupId: MISSING_UUID });

      expect(response.status).toBe(404);
    });

    it('lists tag groups', async () => {
      // Tag groups are a read-only catalogue here — there is no create endpoint
      // — so the only promise is that the screen can load the list at all.
      const response = await api.get('/tag-groups').expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('departments (the settings variant)', () => {
    it('creates a department with its positions and lists both back', async () => {
      const positionCode = uniqueCode();
      const { id, payload } = await createSettingsDepartment({
        positions: [{ code: positionCode, nameTh: uniqueName('ตำแหน่งในแผนก') }],
      });

      const response = await api.get('/settings/departments').query({ limit: 200 }).expect(200);

      const found = response.body.items.find((row: { id: string }) => row.id === id);
      expect(found).toMatchObject({ code: payload.code, nameTh: payload.nameTh });
      expect(found.positions.map((position: { code: string }) => position.code)).toContain(
        positionCode,
      );
    });

    it('renames a department and the change sticks', async () => {
      const { id } = await createSettingsDepartment();
      const renamed = uniqueName('เปลี่ยนชื่อแผนก');

      await api.put(`/settings/departments/${id}`).send({ nameTh: renamed }).expect(200);

      const response = await api.get('/settings/departments').query({ limit: 200 }).expect(200);
      expect(response.body.items.find((row: { id: string }) => row.id === id).nameTh).toBe(renamed);
    });

    it('finds a department by its code through search', async () => {
      const { id, payload } = await createSettingsDepartment();

      const response = await api
        .get('/settings/departments')
        .query({ search: payload.code })
        .expect(200);

      expect(idsOf(response.body.items)).toContain(id);
    });

    it('deletes a department with its positions, and a second delete answers 404', async () => {
      const { id } = await createSettingsDepartment({
        positions: [{ code: uniqueCode(), nameTh: uniqueName('ตำแหน่งที่ถูกลบ') }],
      });

      await api.delete(`/settings/departments/${id}`).expect(200);

      const response = await api.get('/settings/departments').query({ limit: 200 }).expect(200);
      expect(idsOf(response.body.items)).not.toContain(id);
      expect((await api.delete(`/settings/departments/${id}`)).status).toBe(404);
    });

    it('refuses a second department with a code already in use', async () => {
      const { payload } = await createSettingsDepartment();

      const response = await api
        .post('/settings/departments')
        .send({ code: payload.code, nameTh: uniqueName('รหัสซ้ำ') });

      // The code is what payroll and attendance exports key on, so a duplicate
      // would make two departments indistinguishable downstream.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(payload.code);
    });

    it('refuses a second department with a Thai name already in use', async () => {
      const { payload } = await createSettingsDepartment();

      const response = await api
        .post('/settings/departments')
        .send({ code: uniqueCode(), nameTh: payload.nameTh });

      expect(response.status).toBe(400);
    });

    it('answers 404 when updating a department that does not exist', async () => {
      const response = await api.put(`/settings/departments/${MISSING_UUID}`).send({ nameTh: 'x' });

      expect(response.status).toBe(404);
    });

    it('refuses a department with no code', async () => {
      const response = await api
        .post('/settings/departments')
        .send({ nameTh: uniqueName('ไม่มีรหัส') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });

    it('refuses a code longer than three characters', async () => {
      const response = await api
        .post('/settings/departments')
        .send({ code: 'ABCD', nameTh: uniqueName('รหัสยาวเกิน') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });

    it('answers 404 when removing a position that is not in the department', async () => {
      const { id } = await createSettingsDepartment();

      const response = await api
        .put(`/settings/departments/${id}`)
        .send({ removedPositionIds: [MISSING_UUID] });

      expect(response.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('menu permissions by role', () => {
    /**
     * The menu-permission screen is for system administrators only:
     * RoleMenuAccessController.assertAdmin admits a system token, the tenant
     * owner, or a SYSTEM_ADMIN role code. The suite's HR admin is none of
     * those, and driving the happy path would mean writing grants into the
     * seeded tenant the system token is pinned to — so what is asserted here is
     * the guard itself, which is the part the product depends on.
     */
    it('lists the HR menu registry the screen renders', async () => {
      const response = await api.get('/settings/menu-registry').expect(200);

      expect(Array.isArray(response.body.menus)).toBe(true);
      expect(response.body.menus.length).toBeGreaterThan(0);
      expect(response.body.menus[0]).toHaveProperty('menuKey');
    });

    it('refuses to show the grants to an HR admin who is not a system admin', async () => {
      const response = await api.get('/settings/role-menu-access');

      expect(response.status).toBe(403);
    });

    it('refuses to let a non-system-admin save a menu grant', async () => {
      const response = await api
        .put('/settings/role-menu-access')
        .send({ menuKey: 'employees', roleCodes: ['HR_ADMIN'] });

      expect(response.status).toBe(403);
    });

    it('refuses to let a non-system-admin reset a menu grant', async () => {
      const response = await api.delete('/settings/role-menu-access/menu/employees');

      expect(response.status).toBe(403);
    });

    it('refuses an anonymous caller', async () => {
      const response = await api.anonymous().get('/settings/role-menu-access');

      expect(response.status).toBe(401);
    });

    it('answers the cached role catalogue', async () => {
      const response = await api.get('/settings/role-menu-access/roles').expect(200);

      // The catalogue is synced from central and is legitimately empty on a
      // test database; the shape is the contract the screen relies on.
      expect(Array.isArray(response.body.roles)).toBe(true);
      expect(response.body).toHaveProperty('catalogSyncedAt');
    });

    it('refuses an anonymous role-catalogue refresh', async () => {
      const response = await api.anonymous().post('/settings/role-menu-access/refresh-roles').send({});

      expect(response.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('per-employee check-in areas', () => {
    let employee: EmployeeFixture;

    beforeAll(async () => {
      const department = await createDepartment(api);
      employee = await createEmployee(api, { departmentId: department.id });
    });

    it('lists the tenant employees with their current policy', async () => {
      // The list pages at 200 rows ordered by employee code, so the fixture is
      // located by name search rather than by reading the whole first page.
      const response = await api
        .get('/settings/employee-checkin-geofences')
        .query({ search: employee.firstName })
        .expect(200);

      const found = response.body.items.find((row: { id: string }) => row.id === employee.id);
      expect(found).toBeDefined();
      // Nothing configured yet means the employee follows the department, which
      // is the bottom of the employee → department → company chain.
      expect(found.attendanceCheckinGeofencePolicy).toBe('inherit');
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('saves a custom area for one employee and reads it back', async () => {
      const response = await api
        .put(`/settings/employee-checkin-geofences/${employee.id}`)
        .send({
          attendanceCheckinGeofencePolicy: 'custom',
          attendanceCheckinGeofences: [
            {
              name: 'โรงงาน',
              mode: 'circle',
              circleCenter: { lat: 13.7563, lng: 100.5018 },
              circleRadiusMeters: 150,
            },
          ],
        })
        .expect(200);

      expect(response.body.attendanceCheckinGeofencePolicy).toBe('custom');
      expect(response.body.attendanceCheckinGeofences[0]).toMatchObject({
        name: 'โรงงาน',
        mode: 'circle',
        circleRadiusMeters: 150,
      });

      const list = await api
        .get('/settings/employee-checkin-geofences')
        .query({ search: employee.firstName })
        .expect(200);
      const found = list.body.items.find((row: { id: string }) => row.id === employee.id);
      expect(found.attendanceCheckinGeofences).toHaveLength(1);
    });

    it('drops the stored areas when the policy stops being custom', async () => {
      const other = await createEmployee(api);
      await api
        .put(`/settings/employee-checkin-geofences/${other.id}`)
        .send({
          attendanceCheckinGeofencePolicy: 'custom',
          attendanceCheckinGeofences: [
            { name: 'สำนักงาน', mode: 'circle', circleCenter: { lat: 13.7, lng: 100.5 }, circleRadiusMeters: 80 },
          ],
        })
        .expect(200);

      const response = await api
        .put(`/settings/employee-checkin-geofences/${other.id}`)
        .send({ attendanceCheckinGeofencePolicy: 'disabled' })
        .expect(200);

      // Areas left behind under a non-custom policy would reappear the moment
      // someone switched back, which is not what they chose.
      expect(response.body.attendanceCheckinGeofences).toEqual([]);
    });

    it('answers 404 for an employee of no tenant', async () => {
      const response = await api
        .put(`/settings/employee-checkin-geofences/${MISSING_UUID}`)
        .send({ attendanceCheckinGeofencePolicy: 'disabled' });

      expect(response.status).toBe(404);
    });

    test.failing('refuses an unusable check-in area', async () => {
      // Defect: the controller types its body as a plain object and
      // `normalizeGeofenceAreas` repairs whatever it is given rather than
      // rejecting it — a circle with no centre and no radius is stored as an
      // enabled area with `circleCenter: null`. `isValidGeofenceArea` already
      // knows such an area is unusable, but nothing calls it on the way in, so
      // the employee ends up on a custom policy that can never match a check-in.
      const target = await createEmployee(api);

      const response = await api
        .put(`/settings/employee-checkin-geofences/${target.id}`)
        .send({
          attendanceCheckinGeofencePolicy: 'custom',
          attendanceCheckinGeofences: [{ name: 'ไม่มีพิกัด', mode: 'circle' }],
        });

      expect(response.status).toBe(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('work shifts', () => {
    it('creates a shift with its week and lists it back', async () => {
      const { id, payload } = await createWorkShift();

      const response = await api.get('/work-shifts').query({ limit: 200 }).expect(200);

      const found = response.body.items.find((row: { id: string }) => Number(row.id) === id);
      expect(found).toMatchObject({ code: payload.code, name: payload.name, isActive: true });
    });

    it('reads one shift with its seven days in weekday order', async () => {
      const { id } = await createWorkShift();

      const response = await api.get(`/work-shifts/${id}`).expect(200);

      expect(response.body.days).toHaveLength(7);
      expect(response.body.days.map((day: { weekday: number }) => day.weekday)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it('renames a shift and the change sticks', async () => {
      const { id } = await createWorkShift();
      const renamed = uniqueName('เปลี่ยนชื่อกะ');

      await api.patch(`/work-shifts/${id}`).send({ name: renamed }).expect(200);

      expect((await api.get(`/work-shifts/${id}`).expect(200)).body.name).toBe(renamed);
    });

    it('replaces the week when new days are sent', async () => {
      const { id } = await createWorkShift();

      const response = await api
        .patch(`/work-shifts/${id}`)
        .send({
          days: [
            { weekday: 1, isWorkingDay: true, workStartTime: '09:00', workEndTime: '18:00' },
            { weekday: 2, isWorkingDay: true, workStartTime: '09:00', workEndTime: '18:00' },
          ],
        })
        .expect(200);

      // The days are replaced wholesale rather than merged, so a two-day week
      // has exactly two rows afterwards.
      expect(response.body.days).toHaveLength(2);
      expect(response.body.days[0].workStartTime).toContain('09:00');
    });

    it('deletes a shift, and a second delete answers 404', async () => {
      const { id } = await createWorkShift();

      await api.delete(`/work-shifts/${id}`).expect(200);

      expect((await api.get(`/work-shifts/${id}`)).status).toBe(404);
      expect((await api.delete(`/work-shifts/${id}`)).status).toBe(404);
    });

    it('answers 404 for a shift id that belongs to no tenant', async () => {
      const response = await api.get(`/work-shifts/${MISSING_NUMERIC_ID}`);

      expect(response.status).toBe(404);
    });

    it('refuses an id that is not a number', async () => {
      // Shift ids are a bigint, so ParseIntPipe answers 400 rather than letting
      // a stray UUID reach the query.
      const response = await api.get(`/work-shifts/${MISSING_UUID}`);

      expect(response.status).toBe(400);
    });

    it('refuses a shift with no days', async () => {
      const response = await api.post('/work-shifts').send({
        code: 'E2E-EMPTY',
        name: uniqueName('กะไม่มีวัน'),
        shiftType: 'morning',
        attendanceCondition: 'by_shift_time',
        latePolicyType: 'grace_period',
        isActive: true,
        days: [],
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('days');
    });

    it('refuses a day whose times are not HH:MM', async () => {
      const response = await api.post('/work-shifts').send({
        code: 'E2E-TIME',
        name: uniqueName('เวลาผิดรูปแบบ'),
        shiftType: 'morning',
        attendanceCondition: 'by_shift_time',
        latePolicyType: 'grace_period',
        isActive: true,
        days: [{ weekday: 1, isWorkingDay: true, workStartTime: '08:00:00', workEndTime: '17:00' }],
      });

      // The day DTO matches HH:MM exactly — the seconds the OT module requires
      // are a 400 here.
      // The suite's ValidationPipe answers a bare "Validation failed", so the
      // status is the whole assertion here.
      expect(response.status).toBe(400);
    });

    it('refuses a shift type outside the allowed set', async () => {
      const response = await api.post('/work-shifts').send({
        code: 'E2E-TYPE',
        name: uniqueName('ประเภทกะผิด'),
        shiftType: 'graveyard',
        attendanceCondition: 'by_shift_time',
        latePolicyType: 'grace_period',
        isActive: true,
        days: STANDARD_WEEK,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('shiftType');
    });

    it('refuses a second shift with a code already in use', async () => {
      // Codes identify a shift on the attendance screens and in imports, so a
      // duplicate would make two different shifts indistinguishable.
      const { payload } = await createWorkShift();

      const response = await api.post('/work-shifts').send({ ...payload, name: uniqueName('ซ้ำรหัส') });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('holiday years and their days', () => {
    it('creates a holiday year that the list shows back', async () => {
      const { id, payload } = await createHolidayYear({ year: 2090 });

      const response = await api.get('/holiday-years').expect(200);

      expect(response.body.find((row: { id: string }) => Number(row.id) === id)).toMatchObject({
        year: payload.year,
      });
    });

    it('reads one holiday year by id', async () => {
      const { id } = await createHolidayYear({ year: 2091, description: 'ปีทดสอบ' });

      const response = await api.get(`/holiday-years/${id}`).query({ tenantId }).expect(200);

      expect(response.body.description).toBe('ปีทดสอบ');
    });

    it('updates the description of a holiday year', async () => {
      const { id } = await createHolidayYear({ year: 2092 });

      await api
        .patch(`/holiday-years/${id}`)
        .send({ tenantId: numericTenantId, description: 'ปรับคำอธิบาย' })
        .expect(200);

      const response = await api.get(`/holiday-years/${id}`).query({ tenantId }).expect(200);
      expect(response.body.description).toBe('ปรับคำอธิบาย');
    });

    it('deletes a holiday year, and a second delete answers 404', async () => {
      const { id } = await createHolidayYear({ year: 2093 });

      await api.delete(`/holiday-years/${id}`).expect(200);

      expect((await api.get(`/holiday-years/${id}`).query({ tenantId })).status).toBe(404);
      expect((await api.delete(`/holiday-years/${id}`)).status).toBe(404);
    });

    it('answers 404 for a holiday year that does not exist', async () => {
      const response = await api.get(`/holiday-years/${MISSING_NUMERIC_ID}`).query({ tenantId });

      expect(response.status).toBe(404);
    });

    it('refuses a holiday year outside 1900–9999', async () => {
      const response = await api.post('/holiday-years').send({ tenantId: numericTenantId, year: 12 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('year');
    });

    it('creates a holiday day that the year lists back', async () => {
      const year = await createHolidayYear({ year: 2095 });
      const { id, payload } = await createHolidayDay(year.id);

      const days = await listHolidayDays(year.id);

      expect(days.find((day) => Number(day.id) === id)?.name).toBe(payload.name);
    });

    it('renames a holiday day and the change sticks', async () => {
      const year = await createHolidayYear({ year: 2096 });
      const { id } = await createHolidayDay(year.id);
      const renamed = uniqueName('เปลี่ยนชื่อวันหยุด');

      await api
        .patch(`/holiday-year-days/${id}`)
        .send({ tenantId: numericTenantId, name: renamed })
        .expect(200);

      const response = await api
        .get(`/holiday-year-days/${id}`)
        .query({ tenantId })
        .expect(200);
      expect(response.body.name).toBe(renamed);
    });

    it('deletes a holiday day, and a second delete answers 404', async () => {
      const year = await createHolidayYear({ year: 2097 });
      const { id } = await createHolidayDay(year.id);

      await api.delete(`/holiday-year-days/${id}`).expect(200);

      expect(await listHolidayDays(year.id)).toHaveLength(0);
      expect((await api.delete(`/holiday-year-days/${id}`)).status).toBe(404);
    });

    it('refuses a holiday day whose dates are not dates', async () => {
      const year = await createHolidayYear({ year: 2098 });

      const response = await api.post('/holiday-year-days').send({
        tenantId: numericTenantId,
        holidayYearId: year.id,
        name: uniqueName('วันที่ผิดรูปแบบ'),
        dateStart: '13/04/2094',
        dateEnd: '15/04/2094',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('dateStart');
    });

    it('refuses a day listing with neither a year nor a holiday year id', async () => {
      const response = await api
        .post('/holiday-year-days/by-year')
        .send({ tenantId: numericTenantId });

      expect(response.status).toBe(400);
    });

    test.failing('refuses to create a holiday year for another tenant', async () => {
      // Defect: HolidayYearsController.create takes the tenant straight from
      // the request body and never compares it with the authenticated one, so
      // any logged-in user can write a holiday year — and, through the same
      // route, a holiday day — into a tenant they have no access to. Every
      // other catalogue in this suite resolves the tenant from the request.
      const response = await api
        .post('/holiday-years')
        .send({ tenantId: Number(neighbourTenantId), year: 2099 });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test.failing("refuses to delete a holiday year the caller's tenant does not own", async () => {
      // Defect: `HolidayYearsService.remove` calls `findOne(id)` with no tenant
      // at all, so the row is located by primary key alone. A neighbouring
      // tenant can delete this tenant's holiday calendar, which silently turns
      // its company holidays back into working days.
      const { id } = await createHolidayYear({ year: 2089 });

      const response = await neighbour.delete(`/holiday-years/${id}`);

      expect(response.status).toBe(404);
      expect((await api.get(`/holiday-years/${id}`).query({ tenantId })).status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('employee statuses', () => {
    it('creates a status that the list shows back', async () => {
      const { id, payload } = await createEmployeeStatus();

      const response = await api.get('/employee-statuses').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id).name).toBe(payload.name);
    });

    it('renames a status and the change sticks', async () => {
      const { id } = await createEmployeeStatus();
      const renamed = uniqueName('เปลี่ยนชื่อสถานะ');

      await api.put(`/employee-statuses/${id}`).send({ name: renamed }).expect(200);

      expect((await api.get(`/employee-statuses/${id}`).expect(200)).body.name).toBe(renamed);
    });

    it('deletes a status, and a second delete answers 404', async () => {
      const { id } = await createEmployeeStatus();

      await api.delete(`/employee-statuses/${id}`).expect(200);

      expect((await api.get(`/employee-statuses/${id}`)).status).toBe(404);
      expect((await api.delete(`/employee-statuses/${id}`)).status).toBe(404);
    });

    it('refuses a status with no name', async () => {
      const response = await api.post('/employee-statuses').send({ description: 'no name' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('name');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('rejection reasons', () => {
    it('lists the reasons in the configured order', async () => {
      const second = await createRejectionReason({ order: 2 });
      const first = await createRejectionReason({ order: 1 });

      const response = await api.get('/rejection-reasons').expect(200);

      // The order column is what the reject dialog renders by, so it has to
      // decide the listing rather than insertion time.
      const ours = idsOf(response.body).filter((id) => id === first.id || id === second.id);
      expect(ours).toEqual([first.id, second.id]);
    });

    it('renames a reason and the change sticks', async () => {
      const { id } = await createRejectionReason();
      const renamed = uniqueName('เปลี่ยนเหตุผล');

      await api.patch(`/rejection-reasons/${id}`).send({ reason: renamed }).expect(200);

      const response = await api.get('/rejection-reasons').expect(200);
      expect(response.body.find((row: { id: string }) => row.id === id).reason).toBe(renamed);
    });

    it('hides a deactivated reason from the active-only listing', async () => {
      const { id } = await createRejectionReason();

      await api.patch(`/rejection-reasons/${id}`).send({ active: false }).expect(200);

      const active = await api.get('/rejection-reasons').query({ activeOnly: 'true' }).expect(200);
      expect(idsOf(active.body)).not.toContain(id);
      // Deactivating is not deleting: the full list still has it, so past
      // rejections keep their reason.
      const all = await api.get('/rejection-reasons').expect(200);
      expect(idsOf(all.body)).toContain(id);
    });

    it('deletes a reason, and a second delete answers 404', async () => {
      const { id } = await createRejectionReason();

      await api.delete(`/rejection-reasons/${id}`).expect(200);

      const response = await api.get('/rejection-reasons').expect(200);
      expect(idsOf(response.body)).not.toContain(id);
      expect((await api.delete(`/rejection-reasons/${id}`)).status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('application source options', () => {
    it('creates an option that the list shows back', async () => {
      const { id, payload } = await createSourceOption();

      const response = await api.get('/application-source-options').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id)).toMatchObject({
        label: payload.label,
        active: true,
      });
    });

    it('lists the options in the configured order', async () => {
      const second = await createSourceOption({ order: 2 });
      const first = await createSourceOption({ order: 1 });

      const response = await api.get('/application-source-options').expect(200);

      const ours = idsOf(response.body).filter((id) => id === first.id || id === second.id);
      expect(ours).toEqual([first.id, second.id]);
    });

    it('renames an option and the change sticks', async () => {
      const { id } = await createSourceOption();
      const renamed = uniqueName('เปลี่ยนชื่อช่องทาง');

      await api.patch(`/application-source-options/${id}`).send({ label: renamed }).expect(200);

      const response = await api.get('/application-source-options').expect(200);
      expect(response.body.find((row: { id: string }) => row.id === id).label).toBe(renamed);
    });

    it('hides a deactivated option from the active-only listing', async () => {
      const { id } = await createSourceOption();

      await api.patch(`/application-source-options/${id}`).send({ active: false }).expect(200);

      const active = await api
        .get('/application-source-options')
        .query({ activeOnly: 'true' })
        .expect(200);
      expect(idsOf(active.body)).not.toContain(id);
    });

    it('deletes an option, and a second delete answers 404', async () => {
      const { id } = await createSourceOption();

      await api.delete(`/application-source-options/${id}`).expect(200);

      const response = await api.get('/application-source-options').expect(200);
      expect(idsOf(response.body)).not.toContain(id);
      expect((await api.delete(`/application-source-options/${id}`)).status).toBe(404);
    });

    it('answers 404 when updating an option that does not exist', async () => {
      const response = await api
        .patch(`/application-source-options/${MISSING_UUID}`)
        .send({ label: 'x' });

      expect(response.status).toBe(404);
    });

    test.failing('refuses an option with no label', async () => {
      // Defect: `CreateApplicationSourceOptionDto` is a TypeScript `type`, not
      // a decorated class, so the global ValidationPipe has no metadata to
      // check and an empty body reaches the repository. The same hole is
      // documented for rejection reasons in master-data.e2e-spec.ts.
      const response = await api.post('/application-source-options').send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('label');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  /**
   * A neighbouring tenant, numeric and derived from this worker's own id so
   * parallel workers cannot collide. Numeric matters: several tenant-scoped
   * tables store `tenant_id` as an integer, where a UUID collapses to 0 and
   * every UUID tenant would share one set of rows.
   *
   * It is declared outside the describe below because two of the holiday tests
   * above need it as well.
   */
  const neighbourTenantId = `${tenantId}99`;
  let neighbour: ApiClient;

  beforeAll(async () => {
    neighbour = await apiClient(await hrUserFor(neighbourTenantId));
  });

  afterAll(async () => {
    await purgeTenantData(neighbourTenantId);
  });

  describe('tenant scoping', () => {
    it('hides a benefit from another tenant', async () => {
      const { id } = await createBenefit();

      const response = await neighbour
        .get('/settings/benefits')
        .query({ tenantId: neighbourTenantId, limit: 200 })
        .expect(200);

      expect(idsOf(response.body.items)).not.toContain(id);
    });

    it('answers 404 when another tenant updates the benefit', async () => {
      const { id } = await createBenefit();

      const response = await neighbour.put(`/settings/benefits/${id}`).send({ name: 'ข้ามบริษัท' });

      expect(response.status).toBe(404);
    });

    it('hides an employment type, a level and a tag from another tenant', async () => {
      const employmentType = await createEmploymentType();
      const level = await createLevel({ level: 30 });
      const tag = await createTag();

      const types = await neighbour.get('/settings/employment-types').expect(200);
      const levels = await neighbour.get('/settings/levels').expect(200);
      const tags = await neighbour.get('/settings/tags').expect(200);

      expect(idsOf(types.body)).not.toContain(employmentType.id);
      expect(idsOf(levels.body)).not.toContain(level.id);
      expect(idsOf(tags.body)).not.toContain(tag.id);
    });

    it('hides a settings department from another tenant', async () => {
      const { id } = await createSettingsDepartment();

      const response = await neighbour
        .get('/settings/departments')
        .query({ limit: 200 })
        .expect(200);

      expect(idsOf(response.body.items)).not.toContain(id);
    });

    it('hides a work shift from another tenant', async () => {
      const { id } = await createWorkShift();

      const list = await neighbour.get('/work-shifts').query({ limit: 200 }).expect(200);
      expect(list.body.items.map((row: { id: string }) => Number(row.id))).not.toContain(id);

      expect((await neighbour.get(`/work-shifts/${id}`)).status).toBe(404);
    });

    it('hides a holiday year from another tenant', async () => {
      const { id } = await createHolidayYear({ year: 2088 });

      const response = await neighbour.get('/holiday-years').expect(200);

      expect(response.body.map((row: { id: string }) => Number(row.id))).not.toContain(id);
    });

    it('hides rejection reasons and source options from another tenant', async () => {
      const reason = await createRejectionReason();
      const source = await createSourceOption();

      const reasons = await neighbour.get('/rejection-reasons').expect(200);
      const sources = await neighbour.get('/application-source-options').expect(200);

      expect(idsOf(reasons.body)).not.toContain(reason.id);
      expect(idsOf(sources.body)).not.toContain(source.id);
    });

    test.failing('hides employee statuses from another tenant', async () => {
      // Defect (data isolation): EmployeeStatusesService takes a tenantId on
      // every method and uses it nowhere — `create` drops it from the entity and
      // `findAll`/`findOne`/`update`/`remove` query by id alone. Every tenant
      // therefore shares one employee-status catalogue, and one tenant can
      // rename or delete another tenant's statuses.
      const status = await createEmployeeStatus();

      const statuses = await neighbour.get('/employee-statuses').expect(200);

      expect(idsOf(statuses.body)).not.toContain(status.id);
    });

    it("hides one tenant's employees from another tenant's check-in screen", async () => {
      const employee = await createEmployee(api);

      const response = await neighbour.get('/settings/employee-checkin-geofences').expect(200);

      expect(idsOf(response.body.items)).not.toContain(employee.id);
    });
  });

  /**
   * Out of scope, deliberately: the import and export routes each catalogue
   * shares — `/settings/:module/export`, `/settings/:module/import-template`,
   * `/settings/:module/import/preview` and `/settings/:module/import/execute`.
   * They are a spreadsheet pipeline rather than a catalogue, and asserting on
   * generated workbooks belongs in a suite of its own.
   */
});
