/**
 * Overtime: requesting it, the approval path, the live "OT session" a
 * supervisor runs on the floor, and the rate table that decides what an hour
 * is worth.
 *
 * The suite follows the order the product is used in — configure the rates,
 * request OT, then decide on it — so a failure points at the step that broke
 * rather than at a pile of unrelated fixtures.
 *
 * Two things shape almost every test here:
 *
 *   1. Times are `HH:MM:SS`. `parseHmsToMinutes` rejects `HH:MM` outright, so
 *      a payload that looks right on the OT form is a 400 against the API.
 *   2. Nothing in this module is a validated DTO. Every `*Dto` in
 *      `overtime.service.ts` is a TypeScript `interface`, so the global
 *      ValidationPipe has no metadata to check and the service's own guards
 *      are the only validation there is. Where that leaves a hole, the test
 *      asserts the behaviour the endpoint should have and is marked
 *      `test.failing`.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUserFor } from '../support/auth';
import {
  ensureTestTenant,
  purgeTenantData,
  purgeTestTenantData,
  uniqueName,
} from '../support/db';
import { loadTestEnv } from '../support/env';
import { createDepartment, createEmployee, type EmployeeFixture } from '../support/factories';

describe('Overtime (e2e)', () => {
  let api: ApiClient;
  let departmentId: string;
  /** Stands in for the supervisor who opens an OT session for the team. */
  let manager: EmployeeFixture;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    const department = await createDepartment(api);
    departmentId = department.id;

    // Employees are created one at a time on purpose: concurrent creates
    // collide on the generated account-access username.
    manager = await createEmployee(api, { departmentId });

    // `GET /overtime/rates/resolve` answers 404 until the tenant has an active
    // rate for the day type, so the working-day rate is a prerequisite of every
    // rate and payable-hours assertion below.
    await createRate({ dayType: 'regular', dayName: 'วันทำงานปกติ', rateMultiplier: 1.5 });
  });

  afterAll(purgeTestTenantData);

  // ─── local fixtures ────────────────────────────────────────────────────────
  // These live in the spec rather than in support/factories because overtime is
  // the only suite that needs them.

  /** A fresh employee for a scenario that must not collide with another's OT. */
  const newEmployee = () => createEmployee(api, { departmentId });

  const createRate = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      dayType: 'regular',
      dayName: uniqueName('เรททดสอบ'),
      rateMultiplier: 1.5,
      isActive: true,
      ...overrides,
    };
    const response = await api.post('/overtime/rates').send(payload);
    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Could not create an OT rate (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return { id: String(response.body.id), payload };
  };

  /**
   * An employee-submitted OT request, which starts life as `pending`.
   * Fails loudly with the server's own body so one broken fixture does not
   * become ten confusing failures.
   */
  const requestOvertime = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      employeeId: overrides.employeeId,
      date: overrides.date ?? workday(1),
      startTime: '18:00:00',
      endTime: '20:00:00',
      reason: 'ทดสอบระบบ OT',
      ...overrides,
    };
    const response = await api.post('/overtime').send(payload);
    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Could not create an OT request (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return { id: String(response.body.id), payload };
  };

  /** Starts a web OT session for `manager` and returns the session response. */
  const startSession = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      managerId: manager.id,
      date: workday(1),
      otType: 'normal',
      items: [],
      ...overrides,
    };
    const response = await api.post('/overtime/web/start').send(payload);
    if (response.status >= 300 || !response.body?.sessionId) {
      throw new Error(
        `Could not start an OT session (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as {
      sessionId: string;
      managerId: string;
      date: string;
      items: Array<{ id: string; employeeId: string; hours: number; rate: number | null }>;
    };
  };

  /** The record as the OT list screen sees it, or undefined if it is gone. */
  const readRecord = async (id: string) => {
    const response = await api.post('/overtime/records/query').send({ limit: 200 }).expect(201);
    return (response.body.data as Array<{ id: string }>).find((row) => row.id === id) as
      | {
          id: string;
          status: string;
          hours: number;
          matchedHours: number | null;
          payableHours: number;
          rate: number | null;
          sessionId: string | null;
        }
      | undefined;
  };

  const statusOf = async (id: string) => (await api.get(`/overtime/${id}`).expect(200)).body.status;

  // ─── date helpers ──────────────────────────────────────────────────────────
  // OT cannot be requested for a past date, and a weekend or company holiday
  // carries an advance-request deadline. Weekday dates in the near future keep
  // the ordinary cases free of that rule; the rule gets its own block below.

  const iso = (date: Date) => date.toISOString().slice(0, 10);

  /** The `n`-th weekday strictly after today (n = 1 is the next one). */
  function workday(n: number): string {
    const cursor = new Date();
    let found = 0;
    while (found < n) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) found += 1;
    }
    return iso(cursor);
  }

  /** The next Saturday strictly after today — a non-working day by weekday. */
  function nextSaturday(): string {
    const cursor = new Date();
    do {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } while (cursor.getUTCDay() !== 6);
    return iso(cursor);
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe('requesting overtime', () => {
    it('creates a pending request that the OT list shows back', async () => {
      const employee = await newEmployee();
      const { id, payload } = await requestOvertime({ employeeId: employee.id });

      const record = await readRecord(id);

      expect(record).toBeDefined();
      // A self-request waits for the manager; only a supervisor's request skips
      // straight to hr_review.
      expect(record!.status).toBe('pending');
      expect(record!.hours).toBe(2);
      expect(record!.payableHours).toBe(2);
      expect(payload.startTime).toBe('18:00:00');
    });

    it('lists the request under GET /overtime', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id });

      const response = await api.get('/overtime').expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).toContain(id);
    });

    it('creates one request per employee from the supervisor batch', async () => {
      const first = await newEmployee();
      const second = await newEmployee();

      const response = await api
        .post('/overtime/batch')
        .send({
          employeeIds: [first.id, second.id],
          date: workday(2),
          startTime: '19:00:00',
          endTime: '21:00:00',
          reason: 'ปิดยอดสิ้นเดือน',
        })
        .expect(201);

      expect(response.body).toHaveLength(2);
      // A supervisor speaks for the team, so the manager step is already done
      // and the records land in HR's queue.
      expect(response.body.map((row: { status: string }) => row.status)).toEqual([
        'hr_review',
        'hr_review',
      ]);
    });

    it('creates per-employee times from the web batch', async () => {
      const first = await newEmployee();
      const second = await newEmployee();

      const response = await api
        .post('/overtime/web/batch')
        .send({
          managerId: manager.id,
          date: workday(3),
          otType: 'normal',
          items: [
            { employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00', rate: 1.5 },
            { employeeId: second.id, startTime: '18:00:00', endTime: '21:00:00', rate: 1.5 },
          ],
        })
        .expect(201);

      expect(response.body.map((row: { hours: string | number }) => Number(row.hours))).toEqual([
        2, 3,
      ]);
    });

    it('refuses a web batch with no managerId', async () => {
      const employee = await newEmployee();

      const response = await api.post('/overtime/web/batch').send({
        date: workday(4),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('managerId');
    });

    it('refuses a request for an employee of no tenant', async () => {
      const response = await api.post('/overtime').send({
        employeeId: '00000000-0000-4000-8000-000000000000',
        date: workday(1),
        startTime: '18:00:00',
        endTime: '20:00:00',
      });

      expect(response.status).toBe(404);
    });

    it('refuses a request for a past date', async () => {
      const employee = await newEmployee();

      const response = await api.post('/overtime').send({
        employeeId: employee.id,
        date: '2020-01-02',
        startTime: '18:00:00',
        endTime: '20:00:00',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('past date');
    });

    it('refuses a request whose date is not YYYY-MM-DD', async () => {
      const employee = await newEmployee();

      const response = await api
        .post('/overtime')
        .send({ employeeId: employee.id, date: '02/01/2027', startTime: '18:00:00', endTime: '20:00:00' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('YYYY-MM-DD');
    });

    it('refuses a request whose times are not HH:MM:SS', async () => {
      const employee = await newEmployee();

      // The OT form works in HH:MM; the API does not accept it. Worth pinning,
      // because the failure is a 400 on an otherwise valid-looking payload.
      const response = await api
        .post('/overtime')
        .send({ employeeId: employee.id, date: workday(1), startTime: '18:00', endTime: '20:00' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('HH:MM:SS');
    });

    it('refuses a request of zero length', async () => {
      const employee = await newEmployee();

      const response = await api.post('/overtime').send({
        employeeId: employee.id,
        date: workday(1),
        startTime: '18:00:00',
        endTime: '18:00:00',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('endTime');
    });

    it('refuses a second request that overlaps one the employee already has', async () => {
      const employee = await newEmployee();
      const date = workday(5);
      await requestOvertime({ employeeId: employee.id, date });

      const response = await api
        .post('/overtime')
        .send({ employeeId: employee.id, date, startTime: '19:00:00', endTime: '22:00:00' });

      expect(response.status).toBe(400);
    });

    test.failing('refuses a request with no employeeId', async () => {
      // Defect: CreateOvertimeDto is a TypeScript `interface`, so the global
      // ValidationPipe has no class metadata and validates nothing. The date is
      // checked first, then `employeeRepository.findOne({ where: { id: undefined } })`
      // decides the outcome — never a 400 naming the missing field.
      const response = await api
        .post('/overtime')
        .send({ date: workday(1), startTime: '18:00:00', endTime: '20:00:00' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeId');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('querying OT records', () => {
    it('filters by employee and paginates', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(6) });

      const response = await api
        .post('/overtime/records/query')
        .send({ employeeIds: [employee.id], page: 1, limit: 10 })
        .expect(201);

      expect(response.body.status).toBe('success');
      expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([id]);
      expect(response.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1 });
    });

    it('filters by status', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(7) });

      const response = await api
        .post('/overtime/records/query')
        .send({ statuses: ['pending'], employeeIds: [employee.id] })
        .expect(201);

      expect(response.body.data.map((row: { id: string }) => row.id)).toContain(id);

      const other = await api
        .post('/overtime/records/query')
        .send({ statuses: ['approved'], employeeIds: [employee.id] })
        .expect(201);

      expect(other.body.data).toHaveLength(0);
    });

    it('answers an empty body with an empty page rather than an error', async () => {
      // The OT list screen posts `{}` on first paint, before any filter is set.
      const response = await api.post('/overtime/records/query').send({}).expect(201);

      expect(response.body.status).toBe('success');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('the approval path', () => {
    it('moves a pending request to hr_review when the manager approves it', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(8) });

      await api
        .post(`/overtime/${id}/approve/manager`)
        .send({ remarks: 'อนุมัติโดยหัวหน้า' })
        .expect(201);

      expect(await statusOf(id)).toBe('hr_review');
    });

    it('approves the request once HR acknowledges the manager-approved one', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(9) });

      await api.post(`/overtime/${id}/approve/manager`).send({ remarks: 'ผ่าน' }).expect(201);
      await api.post(`/overtime/${id}/acknowledge/hr`).send({ remarks: 'รับทราบ' }).expect(201);

      // HR acknowledgement is the final step — there is no separate approval
      // after it in the flow the frontend drives.
      expect(await statusOf(id)).toBe('approved');
    });

    it('rejects a request at the manager stage', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(10) });

      await api
        .post(`/overtime/${id}/reject`)
        .send({ role: 'manager', remarks: 'งานไม่เร่ง' })
        .expect(201);

      expect(await statusOf(id)).toBe('rejected');
    });

    it('cancels a record and keeps it visible for audit', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(11) });

      await api.post(`/overtime/${id}/cancel`).send({ reason: 'พนักงานไม่ได้มาทำ OT' }).expect(201);

      const record = await readRecord(id);
      // Cancelling is a status change, not a delete: who opened the record has
      // to stay auditable.
      expect(record).toBeDefined();
      expect(record!.status).toBe('cancelled');
    });

    it('refuses to cancel without a reason', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(12) });

      const response = await api.post(`/overtime/${id}/cancel`).send({ reason: '   ' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('reason');
    });

    it('answers 404 when approving an id that does not exist', async () => {
      const response = await api
        .post('/overtime/00000000-0000-4000-8000-0000000000ff/approve/manager')
        .send({ remarks: 'x' });

      expect(response.status).toBe(404);
    });

    it('answers 404 when reading an id that does not exist', async () => {
      const response = await api.get('/overtime/00000000-0000-4000-8000-0000000000ff');

      expect(response.status).toBe(404);
    });

    test.failing('refuses to approve a request that was already rejected', async () => {
      // Defect: `approveByManager` loads the record and overwrites `status`
      // unconditionally (overtime.service.ts ~2545) — there is no state machine
      // anywhere in the approval path. A rejected request can be walked back to
      // hr_review and on to approved, which pays OT that was refused.
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(13) });
      await api.post(`/overtime/${id}/reject`).send({ role: 'manager' }).expect(201);

      const response = await api.post(`/overtime/${id}/approve/manager`).send({ remarks: 'x' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(id)).toBe('rejected');
    });

    test.failing('refuses to acknowledge a request that was cancelled', async () => {
      // Defect: same root cause in `acknowledgeByHR` (~2572). `adjustPayableHours`
      // and `cancelOvertimeRecord` both guard on `status === 'cancelled'`, so the
      // module knows cancelled is terminal — the approval endpoints just do not
      // check. A cancelled record can be acknowledged back into `approved`, and
      // the monthly stats then count hours HR had struck off.
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(14) });
      await api.post(`/overtime/${id}/cancel`).send({ reason: 'ไม่ได้มาทำ' }).expect(201);

      const response = await api.post(`/overtime/${id}/acknowledge/hr`).send({ remarks: 'x' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(id)).toBe('cancelled');
    });

    test.failing('refuses HR acknowledgement before the manager has approved', async () => {
      // Defect: the flow is manager -> HR, but `acknowledgeByHR` accepts a record
      // still in `pending` and sets it straight to `approved`, skipping the
      // manager entirely. Nothing reads `managerApprovedAt` before deciding.
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(15) });

      const response = await api.post(`/overtime/${id}/acknowledge/hr`).send({ remarks: 'x' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(id)).toBe('pending');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('payable hours', () => {
    it('pays the requested hours until HR adjusts them', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(16) });

      const record = await readRecord(id);

      expect(record!.hours).toBe(2);
      expect(record!.matchedHours).toBeNull();
      expect(record!.payableHours).toBe(2);
    });

    it('pays the adjusted hours once HR trims them, leaving the request intact', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(17) });

      await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: 1.25, reason: 'สแกนออกก่อนเวลา' })
        .expect(200);

      const record = await readRecord(id);
      // The requested window is deliberately untouched, so the record still
      // shows what the supervisor opened and what HR settled on.
      expect(record!.hours).toBe(2);
      expect(record!.matchedHours).toBe(1.25);
      expect(record!.payableHours).toBe(1.25);
    });

    it('restores the requested hours when the adjustment is cleared', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(18) });

      await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: 1, reason: 'ปรับตามเวลาที่อยู่จริง' })
        .expect(200);
      await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: null, reason: 'ยกเลิกการปรับ' })
        .expect(200);

      const record = await readRecord(id);
      expect(record!.matchedHours).toBeNull();
      expect(record!.payableHours).toBe(2);
    });

    it('keeps the amount in step with the rate in force when the hours change', async () => {
      // The multiplier comes from the tenant's active rate for the day type,
      // not from anything stored on the record, so the amount has to move with
      // payable hours and stay on the same multiplier.
      const employee = await newEmployee();
      const date = workday(19);
      const resolved = await api.get('/overtime/rates/resolve').query({ date }).expect(200);
      const multiplier = resolved.body.rateMultiplier;

      const session = await startSession({
        date,
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '22:00:00', rate: multiplier }],
      });
      const itemId = session.items[0].id;

      const before = await readRecord(itemId);
      expect(before!.rate).toBe(multiplier);
      expect(before!.payableHours * before!.rate!).toBeCloseTo(4 * multiplier, 5);

      await api
        .patch(`/overtime/${itemId}/payable-hours`)
        .send({ hours: 3, reason: 'ออกก่อนหนึ่งชั่วโมง' })
        .expect(200);

      const after = await readRecord(itemId);
      expect(after!.rate).toBe(multiplier);
      expect(after!.payableHours * after!.rate!).toBeCloseTo(3 * multiplier, 5);
    });

    it('refuses payable hours greater than the hours requested', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(20) });

      const response = await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: 5, reason: 'พิมพ์ผิด' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('exceed');
    });

    it('refuses negative payable hours', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(21) });

      const response = await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: -1, reason: 'พิมพ์ผิด' });

      expect(response.status).toBe(400);
    });

    it('refuses an adjustment with no reason', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(22) });

      const response = await api.patch(`/overtime/${id}/payable-hours`).send({ hours: 1 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('reason');
    });

    it('refuses to adjust a cancelled record', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(23) });
      await api.post(`/overtime/${id}/cancel`).send({ reason: 'ไม่ได้มาทำ' }).expect(201);

      const response = await api
        .patch(`/overtime/${id}/payable-hours`)
        .send({ hours: 1, reason: 'ปรับย้อนหลัง' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('cancelled');
    });

    it('answers 404 when adjusting an id that does not exist', async () => {
      const response = await api
        .patch('/overtime/00000000-0000-4000-8000-0000000000ff/payable-hours')
        .send({ hours: 1, reason: 'x' });

      expect(response.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('active OT sessions', () => {
    /**
     * Sessions are keyed by manager and date: one manager may hold only one
     * in-progress session per date. Each test therefore uses its own manager,
     * so a leftover session cannot make the next test fail for the wrong reason.
     */
    const newManager = () => createEmployee(api, { departmentId });

    it('starts a session that GET /overtime/active returns for its manager', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const date = workday(24);

      const started = await startSession({
        managerId: sessionManager.id,
        date,
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00', rate: 1.5 }],
      });

      const response = await api
        .get('/overtime/active')
        .query({ managerId: sessionManager.id })
        .expect(200);

      expect(response.body.sessionId).toBe(started.sessionId);
      expect(response.body.status).toBe('in_progress');
      expect(response.body.items).toHaveLength(1);
    });

    it('answers an empty object for a manager with no session', async () => {
      const sessionManager = await newManager();

      const response = await api
        .get('/overtime/active')
        .query({ managerId: sessionManager.id })
        .expect(200);

      // The controller returns `{}` rather than 204 on purpose: an empty body
      // is invalid JSON to the client.
      expect(response.body).toEqual({});
    });

    it('lists the manager among those running a session', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      await startSession({
        managerId: sessionManager.id,
        date: workday(25),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      const response = await api.get('/overtime/active/managers').expect(200);

      const found = response.body.find(
        (row: { managerId: string }) => row.managerId === sessionManager.id,
      );
      expect(found).toBeDefined();
      expect(Number(found.activeCount)).toBe(1);
    });

    it('adds an employee to a running session', async () => {
      const sessionManager = await newManager();
      const first = await newEmployee();
      const second = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(26),
        items: [{ employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      await api
        .post(`/overtime/active/${session.sessionId}/items`)
        .send({ employeeId: second.id, startTime: '18:00:00', endTime: '21:00:00', rate: 1.5 })
        .expect(201);

      const response = await api
        .get('/overtime/active')
        .query({ managerId: sessionManager.id })
        .expect(200);
      expect(response.body.items).toHaveLength(2);
    });

    it('refuses to add an employee who is already in the session', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(27),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      const response = await api
        .post(`/overtime/active/${session.sessionId}/items`)
        .send({ employeeId: employee.id, startTime: '21:00:00', endTime: '22:00:00' });

      expect(response.status).toBe(400);
    });

    it('updates one item of the session', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(28),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      await api
        .patch(`/overtime/active/${session.sessionId}/items/${session.items[0].id}`)
        .send({ endTime: '21:30:00', rate: 2, reason: 'ต่อเวลาอีกหนึ่งชั่วโมงครึ่ง' })
        .expect(200);

      const response = await api
        .get('/overtime/active')
        .query({ managerId: sessionManager.id })
        .expect(200);
      expect(response.body.items[0].hours).toBe(3.5);
      expect(response.body.items[0].rate).toBe(2);
    });

    it('moves the whole session to another date', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(29),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });
      const moved = workday(30);

      const response = await api
        .patch(`/overtime/active/${session.sessionId}`)
        .send({ date: moved, otType: 'special' })
        .expect(200);

      expect(response.body.date).toBe(moved);
      expect(response.body.otType).toBe('special');
    });

    it('applies one time window to every item of the session', async () => {
      const sessionManager = await newManager();
      const first = await newEmployee();
      const second = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(31),
        items: [
          { employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00' },
          { employeeId: second.id, startTime: '19:00:00', endTime: '20:00:00' },
        ],
      });

      const response = await api
        .patch(`/overtime/active/${session.sessionId}/time-window`)
        .send({ startTime: '17:00:00', endTime: '20:00:00' })
        .expect(200);

      expect(response.body.items.map((item: { hours: number }) => item.hours)).toEqual([3, 3]);
    });

    it('removes one item from the session', async () => {
      const sessionManager = await newManager();
      const first = await newEmployee();
      const second = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(32),
        items: [
          { employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00' },
          { employeeId: second.id, startTime: '18:00:00', endTime: '20:00:00' },
        ],
      });

      const response = await api
        .delete(`/overtime/active/${session.sessionId}/items/${session.items[0].id}`)
        .expect(200);

      expect(response.body.remainingCount).toBe(1);
    });

    it('refuses to remove the last item of a session', async () => {
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(33),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      const response = await api.delete(
        `/overtime/active/${session.sessionId}/items/${session.items[0].id}`,
      );

      // Emptying a session would leave an invisible in-progress shell; the
      // session has to be cancelled instead.
      expect(response.status).toBe(400);
    });

    it('approves every item when the session is finished', async () => {
      const sessionManager = await newManager();
      const first = await newEmployee();
      const second = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(34),
        items: [
          { employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00', rate: 1.5 },
          { employeeId: second.id, startTime: '18:00:00', endTime: '20:00:00', rate: 1.5 },
        ],
      });

      const response = await api
        .post(`/overtime/active/${session.sessionId}/finish`)
        .send({ managerId: sessionManager.id })
        .expect(201);

      expect(response.body).toMatchObject({ status: 'approved', count: 2 });
      expect(await statusOf(session.items[0].id)).toBe('approved');
    });

    it('refuses a second session for the same manager on the same date', async () => {
      const sessionManager = await newManager();
      const first = await newEmployee();
      const second = await newEmployee();
      const date = workday(35);
      await startSession({
        managerId: sessionManager.id,
        date,
        items: [{ employeeId: first.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      const response = await api.post('/overtime/web/start').send({
        managerId: sessionManager.id,
        date,
        items: [{ employeeId: second.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('active OT session');
    });

    it('refuses to start a session with no employees', async () => {
      const sessionManager = await newManager();

      const response = await api
        .post('/overtime/web/start')
        .send({ managerId: sessionManager.id, date: workday(36), items: [] });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('items');
    });

    it('refuses to start a session for a manager of no tenant', async () => {
      const employee = await newEmployee();

      const response = await api.post('/overtime/web/start').send({
        managerId: '00000000-0000-4000-8000-000000000000',
        date: workday(37),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 for an item added to a session that does not exist', async () => {
      const employee = await newEmployee();

      const response = await api
        .post('/overtime/active/00000000-0000-4000-8000-0000000000ff/items')
        .send({ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' });

      expect(response.status).toBe(404);
    });

    it('answers 404 when finishing a session that does not exist', async () => {
      const response = await api
        .post('/overtime/active/00000000-0000-4000-8000-0000000000ff/finish')
        .send({});

      expect(response.status).toBe(404);
    });

    it('answers 404 when moving a session that does not exist', async () => {
      const response = await api
        .patch('/overtime/active/00000000-0000-4000-8000-0000000000ff')
        .send({ otType: 'normal' });

      expect(response.status).toBe(404);
    });

    test.failing('refuses to finish a session twice', async () => {
      // Defect: `finishActiveSession` looks only for items still `in_progress`
      // and answers 404 when there are none — so a double-click on Finish tells
      // the user the session does not exist, rather than that it is already
      // closed. Correct behaviour is a 409/400 naming the real reason; the 404
      // is indistinguishable from a wrong session id.
      const sessionManager = await newManager();
      const employee = await newEmployee();
      const session = await startSession({
        managerId: sessionManager.id,
        date: workday(38),
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00' }],
      });
      await api.post(`/overtime/active/${session.sessionId}/finish`).send({}).expect(201);

      const response = await api.post(`/overtime/active/${session.sessionId}/finish`).send({});

      expect(response.status).toBe(409);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('OT rates', () => {
    it('lists a newly created rate', async () => {
      const { id, payload } = await createRate({
        dayType: `e2e-${Date.now().toString(36)}`,
        rateMultiplier: 2,
      });

      const response = await api.get('/overtime/rates').expect(200);

      const found = response.body.find((row: { id: string }) => row.id === id);
      expect(found).toMatchObject({ dayName: payload.dayName, rateMultiplier: 2, isActive: true });
    });

    it('lowercases the day type it stores', async () => {
      const { id } = await createRate({ dayType: `E2E-UP-${Date.now().toString(36)}` });

      const response = await api.get('/overtime/rates').expect(200);
      const found = response.body.find((row: { id: string }) => row.id === id);

      expect(found.dayType).toBe(found.dayType.toLowerCase());
    });

    it('updates the multiplier of a rate', async () => {
      const { id } = await createRate({ dayType: `e2e-up-${Date.now().toString(36)}` });

      const response = await api
        .patch(`/overtime/rates/${id}`)
        .send({ rateMultiplier: 3, description: 'ปรับตามประกาศใหม่' })
        .expect(200);

      expect(response.body.rateMultiplier).toBe(3);
    });

    it('deletes a rate', async () => {
      const { id } = await createRate({ dayType: `e2e-del-${Date.now().toString(36)}` });

      await api.delete(`/overtime/rates/${id}`).expect(200);

      const response = await api.get('/overtime/rates').expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(id);
    });

    it('refuses a second active rate for a day type that already has one', async () => {
      const dayType = `e2e-dup-${Date.now().toString(36)}`;
      await createRate({ dayType });

      const response = await api
        .post('/overtime/rates')
        .send({ dayType, dayName: uniqueName('ซ้ำ'), rateMultiplier: 2 });

      // Only one rate may be in force per day type, otherwise the multiplier
      // that decides the money is ambiguous.
      expect(response.status).toBe(400);
    });

    it('allows a second rate for the same day type while it is inactive', async () => {
      const dayType = `e2e-inactive-${Date.now().toString(36)}`;
      await createRate({ dayType });

      const response = await api
        .post('/overtime/rates')
        .send({ dayType, dayName: uniqueName('สำรอง'), rateMultiplier: 2, isActive: false })
        .expect(201);

      expect(response.body.isActive).toBe(false);
    });

    it('refuses a multiplier of zero or less', async () => {
      const response = await api
        .post('/overtime/rates')
        .send({ dayType: `e2e-zero-${Date.now().toString(36)}`, dayName: 'ศูนย์', rateMultiplier: 0 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('rateMultiplier');
    });

    it('answers 404 when updating a rate that does not exist', async () => {
      const response = await api
        .patch('/overtime/rates/00000000-0000-4000-8000-0000000000ff')
        .send({ rateMultiplier: 2 });

      expect(response.status).toBe(404);
    });

    it('answers 404 when deleting a rate that does not exist', async () => {
      const response = await api.delete('/overtime/rates/00000000-0000-4000-8000-0000000000ff');

      expect(response.status).toBe(404);
    });

    it('resolves a working day to the active regular rate', async () => {
      const response = await api
        .get('/overtime/rates/resolve')
        .query({ date: workday(1) })
        .expect(200);

      expect(response.body).toMatchObject({
        isHoliday: false,
        dayType: 'regular',
        rateMultiplier: 1.5,
      });
      // A working day carries no advance-request deadline — OT may be asked for
      // on the day itself.
      expect(response.body.requestDeadline).toBeNull();
    });

    it('refuses to resolve a date that is not YYYY-MM-DD', async () => {
      const response = await api.get('/overtime/rates/resolve').query({ date: 'tomorrow' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('YYYY-MM-DD');
    });

    it('refuses to resolve with no date at all', async () => {
      const response = await api.get('/overtime/rates/resolve');

      expect(response.status).toBe(400);
    });

    test.failing('refuses a rate with no dayType', async () => {
      // Defect: CreateOtRateDto is an interface, so nothing validates the body.
      // `createOtRate` then calls `dto.dayType.trim()` on undefined, which is a
      // TypeError — the caller gets a 500 instead of a 400 naming the field.
      const response = await api
        .post('/overtime/rates')
        .send({ dayName: 'ไม่มีประเภท', rateMultiplier: 1.5 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('dayType');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('the advance-request policy', () => {
    /**
     * OT on a non-working day must be asked for ahead of time: by `cutoffTime`
     * on the `advanceDays`-th working day before it. The policy is per tenant
     * and stored on organization settings, so the test sets a window that has
     * demonstrably closed rather than depending on the clock.
     */
    const setWeekendRule = (rule: Record<string, unknown>) =>
      api
        .patch('/organization-settings')
        .send({
          otAdvanceRequestPolicy: {
            weekend: rule,
            holiday: { enabled: true, advanceDays: 1, cutoffTime: '16:00' },
          },
        })
        .expect(200);

    // Ten working days ahead at midnight: the deadline for the coming Saturday
    // is two calendar weeks in the past, whenever the suite happens to run.
    const closedWindow = { enabled: true, advanceDays: 10, cutoffTime: '00:00' };

    afterAll(async () => {
      // Leave the tenant on the product default so nothing after this block
      // inherits a policy it did not ask for.
      await setWeekendRule({ enabled: true, advanceDays: 1, cutoffTime: '16:00' });
    });

    it('reports the weekend deadline as expired on the rate resolution', async () => {
      await setWeekendRule(closedWindow);

      const response = await api
        .get('/overtime/rates/resolve')
        .query({ date: nextSaturday() })
        .expect(200);

      // The OT form reads this to grey out the submit button before the user
      // types anything; the server still enforces it independently.
      expect(response.body.requestDeadline).toMatchObject({
        cutoffTime: '00:00',
        expired: true,
      });
    });

    it('refuses a weekend request made after the cutoff', async () => {
      await setWeekendRule(closedWindow);
      const employee = await newEmployee();

      const response = await api.post('/overtime').send({
        employeeId: employee.id,
        date: nextSaturday(),
        startTime: '09:00:00',
        endTime: '12:00:00',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('เลยกำหนดแล้ว');
    });

    it('refuses a weekend OT session started after the cutoff', async () => {
      await setWeekendRule(closedWindow);
      const sessionManager = await createEmployee(api, { departmentId });
      const employee = await newEmployee();

      const response = await api.post('/overtime/web/start').send({
        managerId: sessionManager.id,
        date: nextSaturday(),
        items: [{ employeeId: employee.id, startTime: '09:00:00', endTime: '12:00:00' }],
      });

      expect(response.status).toBe(400);
    });

    it('allows the same weekend request once the rule is switched off', async () => {
      await setWeekendRule({ enabled: false, advanceDays: 10, cutoffTime: '00:00' });
      const employee = await newEmployee();

      await api
        .post('/overtime')
        .send({
          employeeId: employee.id,
          date: nextSaturday(),
          startTime: '09:00:00',
          endTime: '12:00:00',
        })
        .expect(201);
    });

    it('leaves working days alone whatever the weekend rule says', async () => {
      await setWeekendRule(closedWindow);
      const employee = await newEmployee();

      // The rule is about non-working days only; a Tuesday must stay requestable
      // on the day itself.
      await api
        .post('/overtime')
        .send({
          employeeId: employee.id,
          date: workday(1),
          startTime: '18:00:00',
          endTime: '20:00:00',
        })
        .expect(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('supporting reads', () => {
    it('answers the supervisor list', async () => {
      const response = await api.get('/overtime/supervisors').expect(200);

      // The list is filtered by the tenant's configured minimum employee level;
      // fixtures created without a level are correctly absent from it.
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(manager.id);
    });

    it('answers the team of a manager as everyone else in the department', async () => {
      const teamMate = await newEmployee();

      const response = await api
        .get('/overtime/team-members')
        .query({ managerId: manager.id })
        .expect(200);

      expect(response.body.departmentId).toBe(departmentId);
      const ids = response.body.team.map((row: { employeeId: string }) => row.employeeId);
      expect(ids).toContain(teamMate.id);
      // The manager is not a member of their own team.
      expect(ids).not.toContain(manager.id);
    });

    it('answers an empty team for a manager with no department', async () => {
      const loner = await createEmployee(api);

      const response = await api
        .get('/overtime/team-members')
        .query({ managerId: loner.id })
        .expect(200);

      expect(response.body).toMatchObject({ departmentId: null, team: [] });
    });

    it('answers 404 for the team of an employee of no tenant', async () => {
      const response = await api
        .get('/overtime/team-members')
        .query({ managerId: '00000000-0000-4000-8000-000000000000' });

      expect(response.status).toBe(404);
    });

    it('sums approved hours per team member', async () => {
      const employee = await newEmployee();
      const date = workday(39);
      const session = await startSession({
        managerId: manager.id,
        date,
        items: [{ employeeId: employee.id, startTime: '18:00:00', endTime: '20:00:00', rate: 1.5 }],
      });
      await api.post(`/overtime/active/${session.sessionId}/finish`).send({}).expect(201);

      const response = await api
        .get('/overtime/team-summary')
        .query({ managerId: manager.id, startDate: date, endDate: date })
        .expect(200);

      const row = response.body.team.find(
        (member: { employeeId: string }) => member.employeeId === employee.id,
      );
      expect(row).toBeDefined();
      expect(Number(row.approvedHours)).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('tenant scoping', () => {
    /**
     * A neighbouring tenant, numeric and derived from this worker's own id so
     * parallel workers cannot collide. Numeric matters: eight tenant-scoped
     * tables store `tenant_id` as an integer, where a UUID collapses to 0 and
     * every UUID tenant would share one set of rows.
     */
    const neighbourTenantId = `${loadTestEnv().tenantId}99`;
    let neighbour: ApiClient;

    beforeAll(async () => {
      neighbour = await apiClient(await hrUserFor(neighbourTenantId));
    });

    afterAll(async () => {
      await purgeTenantData(neighbourTenantId);
    });

    it('hides an OT record from another tenant', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(40) });

      const list = await neighbour.get('/overtime').expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).not.toContain(id);

      const query = await neighbour.post('/overtime/records/query').send({ limit: 200 }).expect(201);
      expect(query.body.data.map((row: { id: string }) => row.id)).not.toContain(id);
    });

    it('answers 404 when another tenant reads the record by id', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(41) });

      const response = await neighbour.get(`/overtime/${id}`);

      expect(response.status).toBe(404);
    });

    it('refuses to let another tenant approve the record', async () => {
      const employee = await newEmployee();
      const { id } = await requestOvertime({ employeeId: employee.id, date: workday(42) });

      const response = await neighbour
        .post(`/overtime/${id}/approve/manager`)
        .send({ remarks: 'ข้ามบริษัท' });

      expect(response.status).toBe(404);
      expect(await statusOf(id)).toBe('pending');
    });

    it('hides an OT rate from another tenant', async () => {
      const { id } = await createRate({ dayType: `e2e-scope-${Date.now().toString(36)}` });

      const response = await neighbour.get('/overtime/rates').expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(id);
    });
  });
});
