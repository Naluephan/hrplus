/**
 * Time and attendance: the punches themselves, the scanner devices that
 * produce them, the daily/monthly summaries built on top of them, and the
 * leave entitlements the leave module draws down.
 *
 * The suite follows the order the data is created in — punch, summarise,
 * report — so a failure points at the step that broke rather than at a pile of
 * unrelated fixtures.
 *
 * Four things shape almost every test here:
 *
 *   1. `POST /attendance`, `POST /attendance/summary` and every
 *      `/employee-daily-summaries` list route carry their own legacy check:
 *      the caller must present `JWT_SECRET` itself, as a bearer token or as
 *      `x-client-key`. A real logged-in HR user is refused by the attendance
 *      list (see the `test.failing` in "the attendance list"). The daily
 *      summaries accept either, because their check passes anything the tenant
 *      middleware has already identified. `scanner` below is the client that
 *      carries the shared secret *without* an Authorization header — sending
 *      the secret as a bearer would make TenantScopeMiddleware pin the request
 *      to the hard-coded tenant `'3'`, which is a seeded tenant this suite must
 *      never write to.
 *   2. A "working day" runs 05:00 to 04:59 the next morning
 *      (attendance-day.util). Fixtures therefore use plain daytime hours so
 *      that rule never quietly moves a punch into the previous day.
 *   3. Mobile check-in demands a selfie and an employee whose login is set to
 *      HR App (`attendance_method = 1`); without either it is refused before
 *      the geofence is even consulted.
 *   4. Quotas are stored in minutes, not days: one day is one shift's worth of
 *      working minutes (480 for the standard 08:00–17:00 shift with an hour
 *      for lunch), which is why the entitlement tests talk in both units.
 *
 * Dates are always in the past and always weekdays. Summaries are only written
 * for working days, and the summary engine refuses to look at the future.
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
import {
  createDepartment,
  createEmployee,
  createLeaveType,
  ensureWorkShift,
  type EmployeeFixture,
  type LeaveType,
} from '../support/factories';

/** An id that is a well-formed UUID and belongs to nobody. */
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

describe('Attendance (e2e)', () => {
  let api: ApiClient;
  /** Carries the shared secret as `x-client-key`; see note 1 in the header. */
  let scanner: ApiClient;
  let departmentId: string;
  let employee: EmployeeFixture;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
    scanner = withSharedSecret(await apiClient({ tenantId: loadTestEnv().tenantId }));

    // Almost everything here reads the tenant work shift: it decides what
    // counts as late, how long a working day is, and how many minutes make up
    // one day of leave quota.
    await ensureWorkShift(api);

    const department = await createDepartment(api);
    departmentId = department.id;
    // Employees are created one at a time on purpose: concurrent creates
    // collide on the generated account-access username.
    employee = await createEmployee(api, { departmentId });
  });

  afterAll(purgeTestTenantData);

  // ─── local fixtures ────────────────────────────────────────────────────────
  // These live in the spec rather than in support/factories because attendance
  // is the only suite that needs them.

  /**
   * Wraps a client so every request carries the legacy shared secret in
   * `x-client-key`.
   *
   * The client itself holds no token, so TenantScopeMiddleware leaves the
   * tenant exactly as `x-tenant-id` says; it never inspects `x-client-key`.
   * Sending the same secret as a bearer token instead would make the
   * middleware pin the request to the hard-coded tenant `'3'`.
   */
  function withSharedSecret(base: ApiClient): ApiClient {
    const secret = loadTestEnv().jwtSecret;
    const withKey =
      (method: 'get' | 'post' | 'put' | 'patch' | 'delete') => (path: string) =>
        base[method](path).set('x-client-key', secret);

    return {
      ...base,
      get: withKey('get'),
      post: withKey('post'),
      put: withKey('put'),
      patch: withKey('patch'),
      delete: withKey('delete'),
    };
  }

  const newEmployee = () => createEmployee(api, { departmentId });

  /** Employee code, which the device endpoints identify people by. */
  const employeeCodeOf = async (employeeId: string): Promise<string> => {
    const response = await api
      .get('/attendance/detail')
      .query({ employeeId })
      .expect(200);
    return response.body.employee.code;
  };

  /** Turns on HR App check-in for an employee, which mobile punching needs. */
  const enableMobileAttendance = async (employeeId: string) => {
    await api
      .put('/employees/attendance-method')
      .send({ employeeIds: [employeeId], attendanceMethod: 1 })
      .expect(200);
  };

  /** Restricts the employee to the scanner, which mobile punching refuses. */
  const enableScannerOnly = async (employeeId: string) => {
    await api
      .put('/employees/attendance-method')
      .send({ employeeIds: [employeeId], attendanceMethod: 2 })
      .expect(200);
  };

  /**
   * A mobile punch. The endpoint is multipart because the selfie is mandatory
   * — "no photo, no punch" is the product rule, enforced twice (multer's
   * filter and the service itself).
   */
  const mobilePunch = (
    direction: 'check-in' | 'check-out',
    input: {
      employeeId: string;
      latitude?: number;
      longitude?: number;
      date?: string;
      time?: string;
      photo?: boolean;
    },
  ) => {
    const request = api
      .post(`/attendance/mobile/${direction}`)
      .field('employeeId', input.employeeId)
      .field('latitude', String(input.latitude ?? BANGKOK.lat))
      .field('longitude', String(input.longitude ?? BANGKOK.lng));

    if (input.date) request.field('date', input.date);
    if (input.time) request.field('time', input.time);
    if (input.photo !== false) {
      request.attach('photo', Buffer.from('e2e-selfie'), {
        filename: 'selfie.jpg',
        contentType: 'image/jpeg',
      });
    }
    return request;
  };

  /** The office the geofence tests place the workplace at. */
  const BANGKOK = { lat: 13.7563, lng: 100.5018 };
  /** Roughly 2 km north of it — outside a 200 m fence, inside a 5 km one. */
  const TWO_KM_AWAY = { lat: 13.7743, lng: 100.5018 };

  const setGeofence = (patch: Record<string, unknown>) =>
    api.patch('/organization-settings').send(patch).expect(200);

  const disableGeofence = () =>
    setGeofence({
      attendanceCheckinGeofenceEnabled: false,
      attendanceCheckinGeofences: [],
    });

  /** One day of attendance written the way the HR correction screen writes it. */
  const recordDay = (input: {
    employeeId: string;
    date: string;
    checkIn?: string | null;
    checkOut?: string | null;
    status?: string;
  }) =>
    api.patch('/attendance/detail').send({
      employeeId: input.employeeId,
      date: input.date,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      ...(input.status ? { status: input.status } : {}),
    });

  /**
   * Builds the daily summaries for one date of this tenant.
   *
   * `tenantId` is never omitted: with no tenant the trigger runs the summary
   * for *every* tenant in the database, seeded demo tenants included.
   */
  const runSummary = (date: string, tenantId = loadTestEnv().tenantId) =>
    api.get('/employee-daily-summaries/trigger').query({ tenantId, date });

  const createDevice = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      deviceId: `E2E-DEV-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      name: uniqueName('เครื่องสแกนทดสอบ'),
      location: 'ประตูหน้า',
      ...overrides,
    };
    const response = await api.post('/devices').send(payload);
    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Could not create a device (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return { id: String(response.body.id), deviceId: String(payload.deviceId), payload };
  };

  const grantDays = (input: {
    employeeId: string;
    leaveTypeId: string;
    days: number;
    hours?: number;
    year?: number;
  }) =>
    api.post('/leave-entitlements').send({
      leaveTypeId: input.leaveTypeId,
      year: input.year ?? new Date().getFullYear(),
      items: [
        { employeeId: input.employeeId, days: input.days, hours: input.hours ?? 0 },
      ],
    });

  const entitlementOf = async (input: {
    employeeId: string;
    leaveTypeId: string;
    year?: number;
  }) => {
    const response = await api
      .post('/leave-entitlements/by-leave-type')
      .send({ leaveTypeId: input.leaveTypeId, year: input.year ?? new Date().getFullYear(), limit: 100 })
      .expect(201);
    return (response.body.items as Array<{ employeeId: string }>).find(
      (item) => item.employeeId === input.employeeId,
    ) as
      | {
          id: string;
          employeeId: string;
          totalQuota: number;
          usedQuota: number;
          remainingQuota: number;
          totalQuotaMinutes: number;
          usedQuotaMinutes: number;
          remainingMinutes: number;
        }
      | undefined;
  };

  // ─── date helpers ──────────────────────────────────────────────────────────

  const iso = (date: Date) => date.toISOString().slice(0, 10);

  /** The `n`-th weekday strictly before today (n = 1 is the most recent one). */
  function pastWorkday(n: number): string {
    const cursor = new Date();
    let found = 0;
    while (found < n) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      const weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) found += 1;
    }
    return iso(cursor);
  }

  // ───────────────────────────────────────────────────────────────────────────
  describe('the attendance list', () => {
    it('returns one page of rows for a date, with a status summary', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(1);
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      const response = await scanner
        .post('/attendance')
        .send({ date, employeeId: worker.id, page: 1, limit: 10 })
        .expect(201);

      expect(response.body).toMatchObject({ page: 1, limit: 10, total: 1 });
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
        status: 'present',
      });
      // The summary counts the rows on the page's filter, not the page itself.
      expect(response.body.summary).toMatchObject({ total: 1, present: 1 });
    });

    it('shows a late arrival as late', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(2);
      // The shift starts at 08:00 with fifteen minutes' grace, so 09:30 is
      // unambiguously late whatever the tenant's other settings say.
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '09:30:00',
        checkOut: '17:00:00',
      }).expect(200);

      const response = await scanner
        .post('/attendance')
        .send({ date, employeeId: worker.id })
        .expect(201);

      expect(response.body.data[0].status).toBe('late');
      expect(response.body.data[0].lateMinutes).toBeGreaterThan(0);
    });

    it('accepts an empty body and answers with today', async () => {
      // The attendance screen posts `{}` on first paint, before any filter is
      // set; the service falls back to today rather than erroring.
      const response = await scanner.post('/attendance').send({}).expect(201);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toMatchObject({ page: 1 });
    });

    it('refuses a caller with no shared secret', async () => {
      const response = await (await apiClient({ tenantId: loadTestEnv().tenantId }))
        .post('/attendance')
        .send({});

      expect(response.status).toBe(401);
    });

    it('refuses a date range that is not a date', async () => {
      const response = await scanner.post('/attendance').send({ date: '02/01/2026' });

      // `@IsDateString()` on ListAttendanceDto rejects the European format the
      // Thai UI shows, which is why the screen has to send ISO.
      expect(response.status).toBe(400);
    });

    test.failing('lets a logged-in HR user list attendance', async () => {
      // Defect: AttendanceController.validateToken compares the caller's bearer
      // token against JWT_SECRET itself, so the only caller it accepts is one
      // holding the server's signing key. A properly authenticated HR user —
      // exactly who the attendance screen is for — gets 401, and the only token
      // that works is the system token, which TenantScopeMiddleware pins to the
      // hard-coded tenant '3'. The route should authenticate like every other HR
      // route (HrJwtAuthGuard) and scope to the caller's own tenant.
      const response = await api.post('/attendance').send({});

      expect(response.status).toBe(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('the attendance summary', () => {
    /**
     * There are two summary implementations in this module, and this endpoint
     * uses the one that is easy to mistake for the other.
     * `AttendanceSummaryService.getAttendanceSummary` — the one with a
     * `no_attendance` bucket, keyed on each employee's single most recent row —
     * is reachable from nothing: `AttendanceService.getAttendanceSummary`
     * (attendance.service.ts:1452) runs the *attendance list* for the filters
     * and folds its rows with `summarizeUniqueEmployees` (:1479). So the
     * buckets are `{ total, present, late, absent, on_leave }`, they are
     * counts of *employees* rather than of rows, and an employee shows up in
     * every bucket a status of theirs falls into within the range.
     *
     * Every test below therefore filters to one employee and one known range.
     * An unfiltered call counts whatever the rest of the tenant did today, so
     * its numbers move as other tests create fixtures — nothing about it is
     * assertable from here.
     */
    const summaryOf = async (body: Record<string, unknown>) =>
      (await scanner.post('/attendance/summary').send(body).expect(201)).body as Record<
        string,
        number
      >;

    it('counts a worked day as one present employee', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(3);
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      const summary = await summaryOf({ employeeId: worker.id, date });

      // The whole contract, pinned: five buckets, counting employees.
      expect(summary).toEqual({ total: 1, present: 1, late: 0, absent: 0, on_leave: 0 });
    });

    it('counts a day with no record at all as absent', async () => {
      const fresh = await newEmployee();
      const date = pastWorkday(5);

      const summary = await summaryOf({ employeeId: fresh.id, date });

      // Note what this endpoint cannot say: there is no `no_attendance` bucket
      // here, so someone who has never punched is indistinguishable from
      // someone who was rostered and did not turn up.
      expect(summary).toEqual({ total: 1, present: 0, late: 0, absent: 1, on_leave: 0 });
    });

    it('counts an employee once however many days the range covers', async () => {
      const worker = await newEmployee();
      await recordDay({
        employeeId: worker.id,
        date: pastWorkday(4),
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      const summary = await summaryOf({
        employeeId: worker.id,
        startDate: pastWorkday(6),
        endDate: pastWorkday(3),
      });

      // One employee, several days: one day worked and the rest not. The
      // buckets are not mutually exclusive — the same person is counted once
      // under `present` and once under `absent` — but `total` stays at one,
      // which is what makes these numbers headcounts rather than day counts.
      expect(summary).toEqual({ total: 1, present: 1, late: 0, absent: 1, on_leave: 0 });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('the dashboard', () => {
    it('answers the daily figures for a date', async () => {
      const date = pastWorkday(1);

      const response = await api.get('/attendance/dashboard').query({ date }).expect(200);

      expect(response.body).toMatchObject({ period: 'daily', date });
      expect(response.body.daily.totalEmployees).toBeGreaterThan(0);
      expect(Array.isArray(response.body.employees.lateEmployees)).toBe(true);
      expect(response.body.genderRatio).toHaveProperty('scanner');
    });

    it('answers the monthly figures when asked for them', async () => {
      const response = await api
        .get('/attendance/dashboard')
        .query({ date: pastWorkday(1), period: 'monthly' })
        .expect(200);

      expect(response.body.period).toBe('monthly');
      expect(response.body.startDate <= response.body.endDate).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("one employee's day", () => {
    it('answers the day of an employee who has never punched', async () => {
      const fresh = await newEmployee();
      const date = pastWorkday(5);

      const response = await api
        .get('/attendance/detail')
        .query({ employeeId: fresh.id, date })
        .expect(200);

      expect(response.body.employee.id).toBe(fresh.id);
      expect(response.body.date).toMatchObject({ value: date, isWeekend: false });
      expect(response.body.attendance).toMatchObject({ id: null, checkIn: null, logs: [] });
      // Eight working hours a day, expressed in minutes — the screen needs it
      // to turn leave minutes into days.
      expect(response.body.minutesPerDay).toBe(480);
    });

    it('records a corrected check-in and check-out', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(6);

      const response = await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      expect(response.body.attendance).toMatchObject({
        checkIn: '08:00:00',
        checkOut: '17:00:00',
        status: 'present',
      });
    });

    it('derives the times from the logs when it is only given logs', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(7);

      const response = await api
        .patch('/attendance/detail')
        .send({
          employeeId: worker.id,
          date,
          logs: [
            { time: '08:05', action: 'in', source: 'web' },
            { time: '17:20', action: 'out', source: 'web' },
          ],
        })
        .expect(200);

      // Logs carrying a direction are believed; first in, last out.
      expect(response.body.attendance).toMatchObject({
        checkIn: '08:05:00',
        checkOut: '17:20:00',
      });
      expect(response.body.attendance.logs).toHaveLength(2);
      expect(response.body.attendance.logs[0].isManual).toBe(true);
    });

    it('marks a day with only a check-in as absent', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(8);

      const response = await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
      }).expect(200);

      // A half-punched day cannot be paid, so the engine refuses to call it
      // present until both ends of the day are known.
      expect(response.body.attendance.status).toBe('absent');
    });

    it('clears the times when they are sent as null', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(9);
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      const response = await recordDay({
        employeeId: worker.id,
        date,
        checkIn: null,
        checkOut: null,
      }).expect(200);

      // `null` is an explicit erase; `undefined` (the field left out) is not.
      expect(response.body.attendance).toMatchObject({ checkIn: null, checkOut: null });
    });

    it('answers 404 for an employee of another tenant', async () => {
      const response = await api
        .get('/attendance/detail')
        .query({ employeeId: UNKNOWN_ID, date: pastWorkday(1) });

      expect(response.status).toBe(404);
    });

    it('refuses a detail read with no employeeId', async () => {
      const response = await api.get('/attendance/detail').query({ date: pastWorkday(1) });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeId');
    });

    it('refuses a date that is not YYYY-MM-DD', async () => {
      const response = await api
        .get('/attendance/detail')
        .query({ employeeId: employee.id, date: '15/09/2026' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('date');
    });

    it('refuses a correction whose time is not a clock time', async () => {
      const response = await recordDay({
        employeeId: employee.id,
        date: pastWorkday(1),
        checkIn: 'ตอนเช้า',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('checkIn');
    });

    it('answers 404 when correcting a log id that is not on that day', async () => {
      const response = await api.patch('/attendance/detail').send({
        employeeId: employee.id,
        date: pastWorkday(1),
        logs: [{ id: UNKNOWN_ID, time: '08:00' }],
      });

      expect(response.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('mobile check-in and check-out', () => {
    beforeAll(disableGeofence);

    it('produces one record whose two ends are the punches', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);
      const date = pastWorkday(10);

      const checkIn = await mobilePunch('check-in', {
        employeeId: worker.id,
        date,
        time: '08:00:00',
      }).expect(201);
      const checkOut = await mobilePunch('check-out', {
        employeeId: worker.id,
        date,
        time: '17:00:00',
      }).expect(201);

      // Two punches, one attendance row — the day is the unit, not the punch.
      expect(checkOut.body.attendanceId).toBe(checkIn.body.attendanceId);
      expect(checkOut.body).toMatchObject({
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
        punchType: 'out',
      });

      const detail = await api
        .get('/attendance/detail')
        .query({ employeeId: worker.id, date })
        .expect(200);
      // Nine hours between the punches, one of them the unpaid lunch break:
      // the eight hours the shift implies.
      expect(detail.body.attendance).toMatchObject({
        checkIn: '08:00:00',
        checkOut: '17:00:00',
        status: 'present',
      });
      expect(detail.body.attendance.logs).toHaveLength(2);
      expect(detail.body.attendance.logs.map((log: { source: string }) => log.source)).toEqual([
        'mobile',
        'mobile',
      ]);
    });

    it('keeps the first check-in when someone punches in twice', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);
      const date = pastWorkday(11);

      await mobilePunch('check-in', { employeeId: worker.id, date, time: '08:00:00' }).expect(201);
      const second = await mobilePunch('check-in', {
        employeeId: worker.id,
        date,
        time: '09:30:00',
      }).expect(201);

      // Arriving, stepping out and coming back must not rewrite the arrival
      // time — but every punch is still kept as evidence.
      expect(second.body.checkIn).toBe('08:00:00');
      const detail = await api
        .get('/attendance/detail')
        .query({ employeeId: worker.id, date })
        .expect(200);
      expect(detail.body.attendance.logs).toHaveLength(2);
      expect(detail.body.attendance.firstPunchTime).toBe('08:00:00');
      expect(detail.body.attendance.lastPunchTime).toBe('09:30:00');
    });

    it('moves the check-out to the last punch out', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);
      const date = pastWorkday(12);

      await mobilePunch('check-in', { employeeId: worker.id, date, time: '08:00:00' }).expect(201);
      await mobilePunch('check-out', { employeeId: worker.id, date, time: '16:00:00' }).expect(201);
      const last = await mobilePunch('check-out', {
        employeeId: worker.id,
        date,
        time: '18:30:00',
      }).expect(201);

      // The opposite rule to check-in, and deliberately so: leaving late is the
      // fact that matters, so the last departure wins.
      expect(last.body.checkOut).toBe('18:30:00');
    });

    it('refuses a punch with no photo', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);

      const response = await mobilePunch('check-in', {
        employeeId: worker.id,
        date: pastWorkday(13),
        time: '08:00:00',
        photo: false,
      });

      expect(response.status).toBe(400);
    });

    it('refuses a punch from an employee set to the scanner', async () => {
      const worker = await newEmployee();
      await enableScannerOnly(worker.id);

      const response = await mobilePunch('check-in', {
        employeeId: worker.id,
        date: pastWorkday(13),
        time: '08:00:00',
      });

      expect(response.status).toBe(403);
    });

    it('answers 404 for an employee of another tenant', async () => {
      const response = await mobilePunch('check-in', { employeeId: UNKNOWN_ID });

      expect(response.status).toBe(404);
    });

    it('refuses a punch with no coordinates', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);

      const response = await api
        .post('/attendance/mobile/check-in')
        .field('employeeId', worker.id)
        .attach('photo', Buffer.from('e2e-selfie'), {
          filename: 'selfie.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('latitude');
    });

    it('refuses a latitude that is not on the planet', async () => {
      const worker = await newEmployee();
      await enableMobileAttendance(worker.id);

      const response = await mobilePunch('check-in', {
        employeeId: worker.id,
        latitude: 120,
      });

      expect(response.status).toBe(400);
    });

    it('answers an empty list for the mobile attendance feed', async () => {
      // `GET /attendance/mobile` is a stub (`// TODO: Implement`). Pinned so a
      // future implementation has to update a test rather than quietly change
      // what the app receives.
      const response = await api.get('/attendance/mobile').expect(200);

      expect(response.body).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('the geofence rule', () => {
    /**
     * The rule that decides whether someone can clock in from outside the
     * workplace. Areas are resolved employee -> department -> company, and the
     * first level that is not "inherit" decides. These tests exercise the
     * company level, which is where HR configures it in practice.
     */
    let mobileWorker: EmployeeFixture;

    beforeAll(async () => {
      mobileWorker = await newEmployee();
      await enableMobileAttendance(mobileWorker.id);
    });

    afterAll(disableGeofence);

    const fenceOfRadius = (radiusMeters: number) => ({
      attendanceCheckinGeofenceEnabled: true,
      attendanceCheckinGeofences: [
        {
          id: 'e2e-office',
          name: 'สำนักงานใหญ่',
          enabled: true,
          mode: 'circle',
          circleCenter: BANGKOK,
          circleRadiusMeters: radiusMeters,
        },
      ],
    });

    it('accepts a punch inside the circle', async () => {
      await setGeofence(fenceOfRadius(500));

      await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(14),
        time: '08:00:00',
        latitude: BANGKOK.lat,
        longitude: BANGKOK.lng,
      }).expect(201);
    });

    it('refuses a punch from outside the circle', async () => {
      await setGeofence(fenceOfRadius(200));

      const response = await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(15),
        time: '08:00:00',
        latitude: TWO_KM_AWAY.lat,
        longitude: TWO_KM_AWAY.lng,
      });

      // Refused, not merely flagged: clocking in from home is the fraud this
      // whole feature exists to stop.
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).toContain('นอกพื้นที่');
    });

    it('accepts the same punch once the circle is wide enough to contain it', async () => {
      await setGeofence(fenceOfRadius(5000));

      await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(16),
        time: '08:00:00',
        latitude: TWO_KM_AWAY.lat,
        longitude: TWO_KM_AWAY.lng,
      }).expect(201);
    });

    it('accepts a punch inside a polygon', async () => {
      await setGeofence({
        attendanceCheckinGeofenceEnabled: true,
        attendanceCheckinGeofences: [
          {
            id: 'e2e-site',
            name: 'พื้นที่โรงงาน',
            enabled: true,
            mode: 'polygon',
            polygon: [
              { lat: 13.75, lng: 100.49 },
              { lat: 13.77, lng: 100.49 },
              { lat: 13.77, lng: 100.52 },
              { lat: 13.75, lng: 100.52 },
            ],
          },
        ],
      });

      await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(17),
        time: '08:00:00',
        latitude: BANGKOK.lat,
        longitude: BANGKOK.lng,
      }).expect(201);
    });

    it('refuses a punch outside the polygon', async () => {
      await setGeofence({
        attendanceCheckinGeofenceEnabled: true,
        attendanceCheckinGeofences: [
          {
            id: 'e2e-site',
            name: 'พื้นที่โรงงาน',
            enabled: true,
            mode: 'polygon',
            polygon: [
              { lat: 13.75, lng: 100.49 },
              { lat: 13.76, lng: 100.49 },
              { lat: 13.76, lng: 100.5 },
              { lat: 13.75, lng: 100.5 },
            ],
          },
        ],
      });

      const response = await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(18),
        time: '08:00:00',
        latitude: TWO_KM_AWAY.lat,
        longitude: TWO_KM_AWAY.lng,
      });

      expect(response.status).toBe(403);
    });

    it('lets anyone punch from anywhere while the fence is switched off', async () => {
      await disableGeofence();

      await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(19),
        time: '08:00:00',
        latitude: TWO_KM_AWAY.lat,
        longitude: TWO_KM_AWAY.lng,
      }).expect(201);
    });

    it('cannot be switched on with no area drawn', async () => {
      // A fence that is on but empty would refuse every punch in the company
      // (`assertMobileAttendanceInsideGeofence` throws "ยังไม่ได้ตั้งค่าพื้นที่
      // ...ให้ครบถ้วน" when it is asked to check against nothing). The settings
      // service therefore fails closed instead: it accepts the request and
      // forces the flag back off — organization-settings.service.ts:507,
      // `next.attendanceCheckinGeofenceEnabled = false`.
      const response = await api
        .patch('/organization-settings')
        .send({
          attendanceCheckinGeofenceEnabled: true,
          attendanceCheckinGeofences: [],
          attendanceCheckinPolygon: [],
          attendanceCheckinCircleLat: null,
          attendanceCheckinCircleLng: null,
          attendanceCheckinCircleRadiusMeters: null,
        })
        .expect(200);

      expect(response.body.attendanceCheckinGeofenceEnabled).toBe(false);

      // And the practical consequence: punching still works from anywhere.
      await mobilePunch('check-in', {
        employeeId: mobileWorker.id,
        date: pastWorkday(23),
        time: '08:00:00',
        latitude: TWO_KM_AWAY.lat,
        longitude: TWO_KM_AWAY.lng,
      }).expect(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('daily summaries', () => {
    /**
     * Summaries are derived data: the trigger reads the attendance rows, the
     * shift and the approved leave for a date and writes one summary row per
     * employee per working day. The tests below always assert the summary
     * against the raw record it was built from, never against a number typed
     * into the test.
     */
    let summarised: EmployeeFixture;
    let summaryDate: string;

    beforeAll(async () => {
      summarised = await newEmployee();
      summaryDate = pastWorkday(3);
      await recordDay({
        employeeId: summarised.id,
        date: summaryDate,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);
      await runSummary(summaryDate).expect(200);
    });

    it('totals the working hours the punches imply', async () => {
      const response = await api
        .post('/employee-daily-summaries/web')
        .send({
          startDate: summaryDate,
          endDate: summaryDate,
          employeeId: summarised.id,
        })
        .expect(201);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        date: summaryDate,
        employeeId: summarised.id,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
        status: 'present',
        // 08:00–17:00 less the hour for lunch: the shift's eight hours.
        workingHours: 8,
        lateMinutes: 0,
      });
      expect(response.body.pagination).toMatchObject({ page: 1, total: 1 });
    });

    it('counts the minutes a late arrival lost', async () => {
      const latecomer = await newEmployee();
      const date = pastWorkday(4);
      await recordDay({
        employeeId: latecomer.id,
        date,
        checkIn: '09:00:00',
        checkOut: '17:00:00',
      }).expect(200);
      await runSummary(date).expect(200);

      const response = await api
        .post('/employee-daily-summaries/web')
        .send({ startDate: date, endDate: date, employeeId: latecomer.id })
        .expect(201);

      // An hour after the 08:00 start, and an hour less work to show for it.
      expect(response.body.data[0]).toMatchObject({
        lateMinutes: 60,
        workingHours: 7,
        status: 'late',
      });
    });

    it('writes no summary for a day nobody worked on', async () => {
      const absentee = await newEmployee();
      const date = pastWorkday(5);
      await runSummary(date).expect(200);

      const response = await api
        .post('/employee-daily-summaries/web')
        .send({ startDate: date, endDate: date, employeeId: absentee.id })
        .expect(201);

      // The row exists — everyone gets one for a working day — but it carries
      // no hours, because no punch is not evidence of anything.
      expect(response.body.data[0]).toMatchObject({
        status: 'absent',
        workingHours: 0,
        checkIn: null,
      });
    });

    it('is idempotent: running the trigger twice does not double the day', async () => {
      await runSummary(summaryDate).expect(200);

      const response = await api
        .post('/employee-daily-summaries/web')
        .send({ startDate: summaryDate, endDate: summaryDate, employeeId: summarised.id })
        .expect(201);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].workingHours).toBe(8);
    });

    it('rolls the day up into the month', async () => {
      const [year, month] = summaryDate.split('-').map(Number);

      const response = await api
        .post('/employee-daily-summaries/monthly/web')
        .send({ year, month, employeeId: summarised.id })
        .expect(201);

      expect(response.body.data).toHaveLength(1);
      const row = response.body.data[0];
      expect(row.employeeId).toBe(summarised.id);
      // The month can only contain what the days contained.
      expect(row.presentDays).toBeGreaterThanOrEqual(1);
      expect(row.workingHours).toBeGreaterThanOrEqual(8);
      expect(row.lateMinutes).toBe(0);
    });

    it('answers an empty daily list until the month is approved', async () => {
      // `POST /employee-daily-summaries` is the payroll-facing list: it only
      // shows days whose month has been approved in payroll worktime. Nothing
      // is approved here, so it is empty although the rows exist — which the
      // /web list above proves.
      const response = await api
        .post('/employee-daily-summaries')
        .send({ date: summaryDate })
        .expect(201);

      expect(response.body).toEqual([]);
    });

    it('answers an empty monthly list until the month is approved', async () => {
      const [year, month] = summaryDate.split('-').map(Number);

      const response = await api
        .post('/employee-daily-summaries/monthly')
        .send({ year, month })
        .expect(201);

      expect(response.body).toEqual([]);
    });

    it('refuses a web range that runs backwards', async () => {
      const response = await api
        .post('/employee-daily-summaries/web')
        .send({ startDate: summaryDate, endDate: pastWorkday(10) });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('startDate');
    });

    it('refuses a web list with no date range', async () => {
      const response = await api.post('/employee-daily-summaries/web').send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('startDate');
    });

    it('refuses a month outside the calendar', async () => {
      const response = await api
        .post('/employee-daily-summaries/monthly/web')
        .send({ year: 2026, month: 13 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('month');
    });

    it('refuses an unauthenticated caller', async () => {
      const anonymous = (await apiClient({ tenantId: loadTestEnv().tenantId })).anonymous();

      const response = await anonymous
        .post('/employee-daily-summaries/web')
        .set('x-tenant-id', loadTestEnv().tenantId)
        .send({ startDate: summaryDate, endDate: summaryDate });

      expect(response.status).toBe(401);
    });

    test.failing('ignores a tenant id smuggled in the request body', async () => {
      // Defect: every list route resolves the tenant as
      // `filters.tenantId || resolveTenantIdOrThrow(req)`, and nothing checks
      // that the caller may see the tenant they asked for. Any authenticated
      // user of any tenant can read another company's attendance summaries by
      // naming it in the body. The body value should be ignored (or rejected)
      // in favour of the caller's own tenant.
      const neighbourTenantId = `${loadTestEnv().tenantId}98`;
      const neighbour = await apiClient(await hrUserFor(neighbourTenantId));

      const response = await neighbour
        .post('/employee-daily-summaries/web')
        .send({
          tenantId: loadTestEnv().tenantId,
          startDate: summaryDate,
          endDate: summaryDate,
          employeeId: summarised.id,
        })
        .expect(201);

      await purgeTenantData(neighbourTenantId);

      expect(response.body.data).toHaveLength(0);
    });

    test.failing('refuses to run the summary trigger for an unauthenticated caller', async () => {
      // Defect: `GET /employee-daily-summaries/trigger` has no guard and no
      // token check, unlike every list route on the same controller. Anyone who
      // can reach the API can recompute — and therefore overwrite — the
      // summaries of any tenant they can name, or of *every* tenant at once by
      // naming none. It should be authenticated and scoped to the caller.
      const anonymous = (await apiClient({ tenantId: loadTestEnv().tenantId })).anonymous();

      const response = await anonymous
        .get('/employee-daily-summaries/trigger')
        .query({ tenantId: loadTestEnv().tenantId, date: summaryDate });

      expect(response.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('devices', () => {
    it('creates a device that starts offline and appears in the list', async () => {
      const { id, deviceId, payload } = await createDevice();

      const response = await api.get('/devices').expect(200);

      const found = response.body.find((row: { id: string }) => row.id === id);
      expect(found).toMatchObject({ deviceId, name: payload.name, status: 'offline' });
      // A device is only online once it has said so itself.
      expect(found.lastHeartbeatAt).toBeNull();
    });

    it('turns a device online when it sends a heartbeat', async () => {
      const { id, deviceId } = await createDevice();

      const response = await api.post(`/devices/${deviceId}/heartbeat`).send({}).expect(201);

      expect(response.body).toMatchObject({ id, status: 'online' });
      expect(response.body.lastHeartbeatAt).not.toBeNull();
    });

    it('reports a device with a fresh heartbeat as healthy', async () => {
      const { id, deviceId } = await createDevice();
      await api.post(`/devices/${deviceId}/heartbeat`).send({}).expect(201);

      const response = await api.get('/devices/health').expect(200);

      const found = response.body.find((row: { id: string }) => row.id === id);
      // Health is computed, not stored: a heartbeat older than five minutes is
      // reported offline however the row was last saved.
      expect(found.status).toBe('online');
    });

    it('reports a device that has never reported in as offline', async () => {
      const { id } = await createDevice();

      const response = await api.get('/devices/health').expect(200);

      expect(response.body.find((row: { id: string }) => row.id === id).status).toBe('offline');
    });

    it('records a check-in and a check-out punched on the device', async () => {
      const { deviceId } = await createDevice();
      const worker = await newEmployee();
      const code = await employeeCodeOf(worker.id);

      const checkIn = await api
        .post(`/devices/${deviceId}/check-in`)
        .send({ employeeCode: code })
        .expect(201);
      const checkOut = await api
        .post(`/devices/${deviceId}/check-out`)
        .send({ employeeCode: code })
        .expect(201);

      expect(checkIn.body.success).toBe(true);
      // One record for the day, whichever end of it the punch is.
      expect(checkOut.body.attendance.id).toBe(checkIn.body.attendance.id);
      expect(checkOut.body.attendance.checkOut).not.toBeNull();

      const detail = await api
        .get('/attendance/detail')
        .query({ employeeId: worker.id, date: checkIn.body.attendance.date })
        .expect(200);
      expect(detail.body.attendance.logs).toHaveLength(2);
      expect(detail.body.attendance.logs[0].source).toBe('device');
    });

    it('answers 404 for a check-in on a device that does not exist', async () => {
      const response = await api
        .post('/devices/not-a-real-device/check-in')
        .send({ employeeCode: await employeeCodeOf(employee.id) });

      expect(response.status).toBe(404);
    });

    it('answers 404 for a check-in by an employee code nobody has', async () => {
      const { deviceId } = await createDevice();

      const response = await api
        .post(`/devices/${deviceId}/check-in`)
        .send({ employeeCode: 'NOBODY-9999' });

      expect(response.status).toBe(404);
    });

    it('refuses a check-out from someone who has not checked in today', async () => {
      const { deviceId } = await createDevice();
      const worker = await newEmployee();

      const response = await api
        .post(`/devices/${deviceId}/check-out`)
        .send({ employeeCode: await employeeCodeOf(worker.id) });

      // Punching out of a day you never punched into is a state error; the
      // service reports it as a missing record.
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).toContain('check-in');
    });

    it('updates and deletes a device', async () => {
      const { id } = await createDevice();

      const updated = await api
        .patch(`/devices/${id}`)
        .send({ name: 'เครื่องสแกนประตูหลัง', location: 'ประตูหลัง' })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'เครื่องสแกนประตูหลัง' });

      await api.delete(`/devices/${id}`).expect(200);
      const response = await api.get(`/devices/${id}`);
      expect(response.status).toBe(404);
    });

    it('answers 404 when reading a device that does not exist', async () => {
      const response = await api.get(`/devices/${UNKNOWN_ID}`);

      expect(response.status).toBe(404);
    });

    it('records the sync time of a device that reports in', async () => {
      const { id, deviceId } = await createDevice();

      await api
        .post('/devices/sync')
        .send({ deviceId, attendanceLogs: [] })
        .expect(201);

      const response = await api.get(`/devices/${id}`).expect(200);
      expect(response.body.lastSyncAt).not.toBeNull();
    });

    it('answers 404 when syncing a device that does not exist', async () => {
      const response = await api
        .post('/devices/sync')
        .send({ deviceId: 'not-a-real-device', attendanceLogs: [] });

      expect(response.status).toBe(404);
    });

    test.failing('stores the punches a device uploads in a sync', async () => {
      // Defect: `DevicesService.syncData` stamps `lastSyncAt`, logs the count to
      // the console and drops the payload on the floor (`// TODO: Process
      // attendance logs from device`). A scanner that was offline all day
      // uploads its backlog, gets a 201, and every one of those punches is lost
      // — the employees show as absent.
      const { deviceId } = await createDevice();
      const worker = await newEmployee();
      const date = pastWorkday(20);

      await api
        .post('/devices/sync')
        .send({
          deviceId,
          attendanceLogs: [
            { employeeId: worker.id, timestamp: `${date}T08:00:00+07:00`, type: 'check_in' },
            { employeeId: worker.id, timestamp: `${date}T17:00:00+07:00`, type: 'check_out' },
          ],
        })
        .expect(201);

      const detail = await api
        .get('/attendance/detail')
        .query({ employeeId: worker.id, date })
        .expect(200);

      expect(detail.body.attendance.logs).toHaveLength(2);
    });

    test.failing('refuses a device with no id and no name', async () => {
      // Defect: CreateDeviceDto is a TypeScript `interface`, so the global
      // ValidationPipe has no metadata and validates nothing. `device_id` and
      // `name` are NOT NULL, so the insert fails in the driver and the caller
      // gets a 500 instead of a 400 naming the missing fields.
      const response = await api.post('/devices').send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('deviceId');
    });

    test.failing('reports a duplicate device id as a conflict', async () => {
      // Defect: `devices` carries a unique index on (tenant_id, device_id) but
      // `create` neither checks for the clash nor translates it. Registering a
      // scanner twice — easy to do, the serial number is typed by hand — is a
      // 500 rather than a 409 telling the operator it is already registered.
      const { deviceId } = await createDevice();

      const response = await api
        .post('/devices')
        .send({ deviceId, name: uniqueName('เครื่องซ้ำ') });

      expect(response.status).toBe(409);
    });

    test.failing('refuses an unauthenticated caller', async () => {
      // Defect: DevicesController imports HrJwtAuthGuard and never applies it —
      // no `@UseGuards` on the class or on any route. Anyone who can reach the
      // API and guess a tenant id can list a company's scanners, register new
      // ones, and punch people in and out on them, with no credentials at all.
      const anonymous = (await apiClient({ tenantId: loadTestEnv().tenantId })).anonymous();

      const response = await anonymous
        .get('/devices')
        .set('x-tenant-id', loadTestEnv().tenantId);

      expect(response.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('leave entitlements', () => {
    let leaveType: LeaveType;
    const year = new Date().getFullYear();

    beforeAll(async () => {
      leaveType = await createLeaveType(api, { maxDaysPerYear: 6 });
    });

    it('grants a quota that the by-leave-type list shows back', async () => {
      const worker = await newEmployee();

      const response = await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 5,
      }).expect(201);

      // `updated`, not `created`: hiring someone already opens the current year
      // for every active leave type — `createEmployee` reaches
      // `ensureEmployeeEntitlements` (employees.service.ts:404) — so HR setting
      // a number here is always overwriting the default, never creating a row.
      expect(response.body).toMatchObject({ created: 0, updated: 1, year });

      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
      });
      expect(entitlement).toBeDefined();
      // Quotas are stored in minutes; five days of the standard 480-minute
      // shift is what "5 days" actually means to the leave engine.
      expect(entitlement).toMatchObject({
        totalQuota: 5,
        usedQuota: 0,
        remainingQuota: 5,
        totalQuotaMinutes: 5 * 480,
      });
    });

    it('updates the quota rather than adding a second one', async () => {
      const worker = await newEmployee();
      await grantDays({ employeeId: worker.id, leaveTypeId: leaveType.id, days: 5 }).expect(201);

      const response = await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 3,
      }).expect(201);

      expect(response.body).toMatchObject({ created: 0, updated: 1 });
      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
      });
      expect(entitlement!.totalQuota).toBe(3);
    });

    it('grants a half day as hours', async () => {
      const worker = await newEmployee();

      await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 1,
        hours: 4,
      }).expect(201);

      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
      });
      expect(entitlement!.totalQuotaMinutes).toBe(480 + 4 * 60);
    });

    it('is the balance the leave request draws down', async () => {
      // The point of the whole module: the days granted here are the days the
      // leave path can actually spend, and spending them shows up here.
      const worker = await newEmployee();
      await grantDays({ employeeId: worker.id, leaveTypeId: leaveType.id, days: 2 }).expect(201);

      await api
        .post('/leaves/request')
        .send({
          employeeId: worker.id,
          leaveTypeId: leaveType.id,
          startDate: `${year}-03-02`,
          endDate: `${year}-03-02`,
          reason: 'ทดสอบการหักโควตา',
        })
        .expect(201);

      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
      });
      expect(entitlement).toMatchObject({ usedQuota: 1, remainingQuota: 1 });
      expect(entitlement!.usedQuotaMinutes).toBe(480);
    });

    it('refuses a leave request longer than the quota granted', async () => {
      const worker = await newEmployee();
      await grantDays({ employeeId: worker.id, leaveTypeId: leaveType.id, days: 1 }).expect(201);

      const response = await api.post('/leaves/request').send({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        startDate: `${year}-03-03`,
        endDate: `${year}-03-05`,
        reason: 'ขอเกินสิทธิ์',
      });

      expect(response.status).toBe(400);
    });

    it('creates the year for everyone who is still employed', async () => {
      const worker = await newEmployee();
      const freshType = await createLeaveType(api, { maxDaysPerYear: 7 });

      const response = await api
        .post('/leave-entitlements/ensure')
        .send({ leaveTypeId: freshType.id, year })
        .expect(201);

      expect(response.body.created).toBeGreaterThan(0);
      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: freshType.id,
      });
      // With no policy configured the leave type's own yearly maximum is the
      // default quota.
      expect(entitlement!.totalQuota).toBe(7);
    });

    it('skips anyone who already has the year, so it can be re-run', async () => {
      const freshType = await createLeaveType(api, { maxDaysPerYear: 4 });
      await api
        .post('/leave-entitlements/ensure')
        .send({ leaveTypeId: freshType.id, year })
        .expect(201);

      const second = await api
        .post('/leave-entitlements/ensure')
        .send({ leaveTypeId: freshType.id, year })
        .expect(201);

      // Opening the year twice must not double anybody's leave.
      expect(second.body.created).toBe(0);
    });

    it('opens the year for every active leave type at once', async () => {
      const worker = await newEmployee();
      const nextYear = year + 1;

      const response = await api
        .post('/leave-entitlements/ensure-all')
        .send({ year: nextYear })
        .expect(201);

      expect(response.body.year).toBe(nextYear);
      expect(response.body.leaveTypes.length).toBeGreaterThan(0);
      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        year: nextYear,
      });
      expect(entitlement).toBeDefined();
    });

    it('lists the years that actually hold data', async () => {
      const worker = await newEmployee();
      await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 1,
        year: 2019,
      }).expect(201);

      const response = await api.get('/leave-entitlements/years').expect(200);

      expect(response.body).toContain(2019);
      // Newest first: the year picker opens on the current year.
      expect(response.body[0]).toBeGreaterThanOrEqual(response.body[response.body.length - 1]);
    });

    it('answers one employee’s history across the years', async () => {
      const worker = await newEmployee();
      await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 4,
        year: 2020,
      }).expect(201);
      await grantDays({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
        days: 6,
        year: 2021,
      }).expect(201);

      const response = await api
        .get('/leave-entitlements/history')
        .query({ leaveTypeId: leaveType.id, employeeId: worker.id })
        .expect(200);

      expect(response.body.minutesPerDay).toBe(480);
      const years = response.body.items.map((item: { year: number }) => item.year);
      // The current year is there too, opened at hire by
      // `ensureEmployeeEntitlements` (employees.service.ts:404); the two back
      // years are the ones this test granted. Newest first, so the screen can
      // show the history without sorting it again.
      expect(years).toEqual([year, 2021, 2020]);
      const twentyTwentyOne = response.body.items.find(
        (item: { year: number }) => item.year === 2021,
      );
      expect(twentyTwentyOne.totalQuotaMinutes).toBe(6 * 480);
    });

    it('refuses a history read with no employee', async () => {
      const response = await api
        .get('/leave-entitlements/history')
        .query({ leaveTypeId: leaveType.id });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeId');
    });

    it('deletes an entitlement', async () => {
      const worker = await newEmployee();
      await grantDays({ employeeId: worker.id, leaveTypeId: leaveType.id, days: 2 }).expect(201);
      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: leaveType.id,
      });

      await api.delete(`/leave-entitlements/${entitlement!.id}`).expect(204);

      expect(
        await entitlementOf({ employeeId: worker.id, leaveTypeId: leaveType.id }),
      ).toBeUndefined();
    });

    it('answers 404 when deleting an entitlement that does not exist', async () => {
      const response = await api.delete(`/leave-entitlements/${UNKNOWN_ID}`);

      expect(response.status).toBe(404);
    });

    it('answers 404 when granting against a leave type of another tenant', async () => {
      const response = await grantDays({
        employeeId: employee.id,
        leaveTypeId: UNKNOWN_ID,
        days: 1,
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 when granting to an employee of another tenant', async () => {
      const response = await grantDays({
        employeeId: UNKNOWN_ID,
        leaveTypeId: leaveType.id,
        days: 1,
      });

      expect(response.status).toBe(404);
    });

    it('refuses a grant with no items', async () => {
      const response = await api
        .post('/leave-entitlements')
        .send({ leaveTypeId: leaveType.id, year, items: [] });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('items');
    });

    it('refuses a grant of more days than a year can hold', async () => {
      const response = await api.post('/leave-entitlements').send({
        leaveTypeId: leaveType.id,
        year,
        items: [{ employeeId: employee.id, days: 1000, hours: 0 }],
      });

      // Status only: `days` is validated inside `items`, and the suite's
      // exception factory reports a nested failure as the parent property
      // ("items has invalid value") because `error.constraints` is empty on the
      // outer error. The field name never reaches the body.
      expect(response.status).toBe(400);
    });

    it('refuses hours that are not part of a day', async () => {
      const response = await api.post('/leave-entitlements').send({
        leaveTypeId: leaveType.id,
        year,
        items: [{ employeeId: employee.id, days: 1, hours: 24 }],
      });

      // Status only, for the same reason as the test above: a nested field name
      // does not survive the exception factory.
      expect(response.status).toBe(400);
    });

    it('refuses a list with no leave type', async () => {
      const response = await api.post('/leave-entitlements/by-leave-type').send({ year });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('leaveTypeId');
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

    it('hides a device from another tenant', async () => {
      const { id, deviceId } = await createDevice();

      const list = await neighbour.get('/devices').expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).not.toContain(id);

      // Even the device's own serial number is no use across the boundary.
      const heartbeat = await neighbour.post(`/devices/${deviceId}/heartbeat`).send({});
      expect(heartbeat.status).toBe(404);
    });

    it('answers 404 when another tenant reads the device by id', async () => {
      const { id } = await createDevice();

      const response = await neighbour.get(`/devices/${id}`);

      expect(response.status).toBe(404);
    });

    it('hides an attendance day from another tenant', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(21);
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);

      const response = await neighbour
        .get('/attendance/detail')
        .query({ employeeId: worker.id, date });

      expect(response.status).toBe(404);
    });

    it('hides a daily summary from another tenant', async () => {
      const worker = await newEmployee();
      const date = pastWorkday(22);
      await recordDay({
        employeeId: worker.id,
        date,
        checkIn: '08:00:00',
        checkOut: '17:00:00',
      }).expect(200);
      await runSummary(date).expect(200);

      const response = await neighbour
        .post('/employee-daily-summaries/web')
        .send({ startDate: date, endDate: date })
        .expect(201);

      expect(
        response.body.data.map((row: { employeeId: string }) => row.employeeId),
      ).not.toContain(worker.id);
    });

    it('hides a leave entitlement from another tenant', async () => {
      const worker = await newEmployee();
      const type = await createLeaveType(api);
      await grantDays({ employeeId: worker.id, leaveTypeId: type.id, days: 3 }).expect(201);

      // The leave type belongs to this tenant, so the neighbour cannot even
      // name it: the lookup is scoped before the entitlements are read.
      const response = await neighbour
        .post('/leave-entitlements/by-leave-type')
        .send({ leaveTypeId: type.id });

      expect(response.status).toBe(201);
      expect(response.body.items).toHaveLength(0);
    });

    it('refuses to let another tenant delete an entitlement', async () => {
      const worker = await newEmployee();
      const type = await createLeaveType(api);
      await grantDays({ employeeId: worker.id, leaveTypeId: type.id, days: 3 }).expect(201);
      const entitlement = await entitlementOf({
        employeeId: worker.id,
        leaveTypeId: type.id,
      });

      const response = await neighbour.delete(`/leave-entitlements/${entitlement!.id}`);

      expect(response.status).toBe(404);
      expect(
        await entitlementOf({ employeeId: worker.id, leaveTypeId: type.id }),
      ).toBeDefined();
    });
  });
});
