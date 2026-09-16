/**
 * The payroll cycle, in the order HR works it: open a salary period, maintain
 * the income and deduction catalogues, record what an employee is paid, then
 * build the month's salary record and walk it from draft to paid.
 *
 * This is money, so the suite asserts arithmetic rather than status codes
 * wherever it can: net pay is gross minus deductions, and adding a line moves
 * the totals by exactly that line's amount. The other thing worth proving is
 * that the state machine holds — a record that has been paid must not be
 * editable, and a locked period must not accept new work.
 *
 * Fixtures are built through the API only. The helpers at the bottom live in
 * this file rather than in `support/factories` because nothing else needs them
 * yet; move them out when a second suite does.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUserFor } from '../support/auth';
import {
  ensureTenant,
  ensureTestTenant,
  purgeTenantData,
  purgeTestTenantData,
  uniqueName,
} from '../support/db';
import { loadTestEnv } from '../support/env';
import { createEmployee, type EmployeeFixture } from '../support/factories';

/**
 * A second tenant, used only to prove a salary record cannot be read from
 * outside the tenant that owns it. Digits, and prefixed so it can never be one
 * of the per-worker tenants (`<base>0N`) nor a seeded demo tenant.
 */
const OTHER_TENANT_ID = `9${loadTestEnv().tenantId}`;

/**
 * MySQL hands decimal columns back as strings, so every money assertion has to
 * go through Number() before it means anything numerically.
 */
const money = (value: unknown): number => Number(value ?? 0);

describe('Salary records (e2e)', () => {
  let api: ApiClient;
  let otherTenant: ApiClient;
  let employee: EmployeeFixture;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    await ensureTenant(OTHER_TENANT_ID, 'E2E Salary Outsider Tenant');
    await purgeTenantData(OTHER_TENANT_ID);
    otherTenant = await apiClient(await hrUserFor(OTHER_TENANT_ID));

    employee = await createEmployee(api);
  });

  afterAll(async () => {
    await purgeTestTenantData();
    await purgeTenantData(OTHER_TENANT_ID);
  });

  // ==================== Salary periods ====================

  describe('salary periods', () => {
    it('creates a period and returns it with the tenant headcount', async () => {
      const slot = nextPeriodSlot();
      const periodCode = uniqueCodeOfLength(20);

      const response = await api
        .post('/salary-periods')
        .send({
          month: slot.month,
          year: slot.year,
          periodCode,
          periodName: uniqueName('รอบเงินเดือน'),
          startDate: slot.startDate,
          endDate: slot.endDate,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.period).toMatchObject({
        month: slot.month,
        year: slot.year,
        periodCode,
        isLocked: false,
      });
      // The period screen opens straight onto the employees it covers, so the
      // create response carries them; the employee created in beforeAll is one.
      expect(response.body.data.totalEmployees).toBeGreaterThanOrEqual(1);
    });

    it('lists a period it has just created', async () => {
      const period = await createPeriod(api);

      const response = await api
        .get('/salary-periods')
        .query({ month: period.month, year: period.year })
        .expect(200);

      expect(response.body.data.map((row: { id: string }) => row.id)).toContain(period.id);
      expect(response.body.total).toBeGreaterThanOrEqual(1);
    });

    it('reads one period back by id', async () => {
      const period = await createPeriod(api);

      const response = await api.get(`/salary-periods/${period.id}`).expect(200);

      expect(response.body.id).toBe(period.id);
    });

    it('renames a period', async () => {
      const period = await createPeriod(api);
      const periodName = uniqueName('รอบเงินเดือน (แก้ไข)');

      await api.patch(`/salary-periods/${period.id}`).send({ periodName }).expect(200);

      const response = await api.get(`/salary-periods/${period.id}`).expect(200);
      expect(response.body.periodName).toBe(periodName);
    });

    it('deletes a period and then cannot find it', async () => {
      const period = await createPeriod(api);

      await api.delete(`/salary-periods/${period.id}`).expect(200);
      await api.get(`/salary-periods/${period.id}`).expect(404);
    });

    it('rejects a month outside 1-12', async () => {
      const slot = nextPeriodSlot();

      const response = await api.post('/salary-periods').send({
        month: 13,
        year: slot.year,
        periodCode: uniqueCodeOfLength(20),
        periodName: uniqueName('เดือนผิด'),
        startDate: slot.startDate,
        endDate: slot.endDate,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('month');
    });

    it('rejects a second period for the same month and year', async () => {
      const period = await createPeriod(api);

      const response = await api.post('/salary-periods').send({
        month: period.month,
        year: period.year,
        periodCode: uniqueCodeOfLength(20),
        periodName: uniqueName('รอบซ้ำ'),
        startDate: period.startDate,
        endDate: period.endDate,
      });

      expect(response.status).toBe(400);
    });

    it('rejects a period whose start date is after its end date', async () => {
      const slot = nextPeriodSlot();

      const response = await api.post('/salary-periods').send({
        month: slot.month,
        year: slot.year,
        periodCode: uniqueCodeOfLength(20),
        periodName: uniqueName('ช่วงวันที่ผิด'),
        startDate: slot.endDate,
        endDate: slot.startDate,
      });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a period that does not exist', async () => {
      await api.get(`/salary-periods/${MISSING_UUID}`).expect(404);
    });
  });

  describe('locking a period', () => {
    it('locks a period, refuses to edit or delete it, then unlocks it', async () => {
      const period = await createPeriod(api);

      const locked = await api.patch(`/salary-periods/${period.id}/lock`).expect(200);
      expect(locked.body.isLocked).toBe(true);

      // A locked period is the accounting freeze: its dates and its rows are
      // the record of what was paid, so neither may move.
      const edit = await api
        .patch(`/salary-periods/${period.id}`)
        .send({ periodName: uniqueName('ห้ามแก้') });
      expect(edit.status).toBe(400);

      const removal = await api.delete(`/salary-periods/${period.id}`);
      expect(removal.status).toBe(400);

      const unlocked = await api.patch(`/salary-periods/${period.id}/unlock`).expect(200);
      expect(unlocked.body.isLocked).toBe(false);
    });

    it('refuses to lock a period that is already locked', async () => {
      const period = await createPeriod(api);
      await api.patch(`/salary-periods/${period.id}/lock`).expect(200);

      const response = await api.patch(`/salary-periods/${period.id}/lock`);
      expect(response.status).toBe(400);
    });

    it('refuses to unlock a period that is not locked', async () => {
      const period = await createPeriod(api);

      const response = await api.patch(`/salary-periods/${period.id}/unlock`);
      expect(response.status).toBe(400);
    });

    it('answers 404 when locking a period that does not exist', async () => {
      await api.patch(`/salary-periods/${MISSING_UUID}/lock`).expect(404);
    });

    // KNOWN DEFECT — SalaryRecordsService.create() never reads the period's
    // `isLocked` flag (salary-records.service.ts:72). Locking a period is the
    // only control HR has over a closed month, and it currently stops nothing:
    // a new salary record can still be written into a locked, already-paid
    // period. Expected to fail until create() rejects a locked period.
    test.failing('refuses a new salary record in a locked period', async () => {
      const period = await createPeriod(api);
      await api.patch(`/salary-periods/${period.id}/lock`).expect(200);

      const response = await api
        .post('/salary-records')
        .send({ employeeId: employee.id, periodId: period.id, baseSalary: 30000 });

      expect(response.status).toBe(400);
    });
  });

  // ==================== Catalogues ====================

  describe('salary component catalogue', () => {
    it('creates a component and lists it', async () => {
      const component = await createComponent(api, { name: 'ค่าตำแหน่ง' });

      const response = await api.get('/salary-components').expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).toContain(component.id);
    });

    it('reads one component back by id', async () => {
      const component = await createComponent(api);

      const response = await api.get(`/salary-components/${component.id}`).expect(200);
      expect(response.body).toMatchObject({ id: component.id, code: component.code });
    });

    it('renames a component', async () => {
      const component = await createComponent(api);
      const name = uniqueName('ค่าตำแหน่ง (แก้ไข)');

      await api.patch(`/salary-components/${component.id}`).send({ name }).expect(200);

      const response = await api.get(`/salary-components/${component.id}`).expect(200);
      expect(response.body.name).toBe(name);
    });

    it('deletes a component and then cannot find it', async () => {
      const component = await createComponent(api);

      await api.delete(`/salary-components/${component.id}`).expect(200);
      await api.get(`/salary-components/${component.id}`).expect(404);
    });

    it('rejects a component with no code', async () => {
      const response = await api.post('/salary-components').send({ name: uniqueName('ไม่มีรหัส') });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('code');
    });

    it('rejects a second component with the same code', async () => {
      const component = await createComponent(api);

      const response = await api
        .post('/salary-components')
        .send({ code: component.code, name: uniqueName('รหัสซ้ำ') });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a component that does not exist', async () => {
      await api.get(`/salary-components/${MISSING_UUID}`).expect(404);
    });
  });

  describe('salary deduction catalogue', () => {
    it('creates a deduction and lists it', async () => {
      const deduction = await createDeduction(api, { name: 'ประกันสังคม' });

      const response = await api.get('/salary-deductions').expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).toContain(deduction.id);
    });

    it('reads one deduction back by id', async () => {
      const deduction = await createDeduction(api);

      const response = await api.get(`/salary-deductions/${deduction.id}`).expect(200);
      expect(response.body).toMatchObject({ id: deduction.id, code: deduction.code });
    });

    it('renames a deduction', async () => {
      const deduction = await createDeduction(api);
      const name = uniqueName('เงินหัก (แก้ไข)');

      await api.patch(`/salary-deductions/${deduction.id}`).send({ name }).expect(200);

      const response = await api.get(`/salary-deductions/${deduction.id}`).expect(200);
      expect(response.body.name).toBe(name);
    });

    it('deletes a deduction and then cannot find it', async () => {
      const deduction = await createDeduction(api);

      await api.delete(`/salary-deductions/${deduction.id}`).expect(200);
      await api.get(`/salary-deductions/${deduction.id}`).expect(404);
    });

    it('rejects a deduction with no name', async () => {
      const response = await api.post('/salary-deductions').send({ code: uniqueCodeOfLength(12) });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('name');
    });

    it('rejects a second deduction with the same code', async () => {
      const deduction = await createDeduction(api);

      const response = await api
        .post('/salary-deductions')
        .send({ code: deduction.code, name: uniqueName('รหัสซ้ำ') });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a deduction that does not exist', async () => {
      await api.get(`/salary-deductions/${MISSING_UUID}`).expect(404);
    });
  });

  // ==================== Employee salary info ====================

  describe('employee salary info', () => {
    it('derives the daily and hourly rates from the monthly base salary', async () => {
      const subject = await createEmployee(api);

      const response = await api
        .post('/employee-salary-info')
        .send({ employeeId: subject.id, baseSalary: 44000, effectiveDate: '2030-01-01' })
        .expect(201);

      const info = response.body.data.salaryInfo;
      // The service divides by 22 working days, then by 8 hours — the rates the
      // overtime and unpaid-leave maths later depend on.
      expect(money(info.dailyRate)).toBeCloseTo(2000, 2);
      expect(money(info.hourlyRate)).toBeCloseTo(250, 2);
      expect(money(info.overtimeRateMultiplier)).toBeCloseTo(1.5, 2);
    });

    it('lists and reads back the record it created', async () => {
      const subject = await createEmployee(api);
      const info = await createSalaryInfo(api, { employeeId: subject.id, baseSalary: 30000 });

      const list = await api
        .get('/employee-salary-info')
        .query({ employeeId: subject.id })
        .expect(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).toContain(info.id);

      const one = await api.get(`/employee-salary-info/${info.id}`).expect(200);
      expect(one.body.id).toBe(info.id);
    });

    it('returns the active record for an employee', async () => {
      const subject = await createEmployee(api);
      const info = await createSalaryInfo(api, { employeeId: subject.id, baseSalary: 30000 });

      const response = await api.get(`/employee-salary-info/employee/${subject.id}`).expect(200);

      expect(response.body.id).toBe(info.id);
      expect(money(response.body.baseSalary)).toBeCloseTo(30000, 2);
    });

    it('recomputes the daily rate when the base salary is raised', async () => {
      const subject = await createEmployee(api);
      const info = await createSalaryInfo(api, { employeeId: subject.id, baseSalary: 22000 });

      await api
        .patch(`/employee-salary-info/${info.id}`)
        .send({ baseSalary: 44000 })
        .expect(200);

      const response = await api.get(`/employee-salary-info/${info.id}`).expect(200);
      expect(money(response.body.baseSalary)).toBeCloseTo(44000, 2);
      expect(money(response.body.dailyRate)).toBeCloseTo(2000, 2);
    });

    it('deletes a record and then cannot find it', async () => {
      const subject = await createEmployee(api);
      const info = await createSalaryInfo(api, { employeeId: subject.id, baseSalary: 30000 });

      await api.delete(`/employee-salary-info/${info.id}`).expect(200);
      await api.get(`/employee-salary-info/${info.id}`).expect(404);
    });

    it('rejects a record with no base salary', async () => {
      const subject = await createEmployee(api);

      const response = await api
        .post('/employee-salary-info')
        .send({ employeeId: subject.id, effectiveDate: '2030-01-01' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('baseSalary');
    });

    it('rejects a record that expires before it takes effect', async () => {
      const subject = await createEmployee(api);

      const response = await api.post('/employee-salary-info').send({
        employeeId: subject.id,
        baseSalary: 30000,
        effectiveDate: '2030-06-01',
        expiryDate: '2030-01-01',
      });

      expect(response.status).toBe(400);
    });

    it('answers 404 for an employee that does not exist', async () => {
      const response = await api
        .post('/employee-salary-info')
        .send({ employeeId: MISSING_UUID, baseSalary: 30000, effectiveDate: '2030-01-01' });

      expect(response.status).toBe(404);
    });

    it('answers 404 for a salary info record that does not exist', async () => {
      await api.get(`/employee-salary-info/${MISSING_UUID}`).expect(404);
    });
  });

  // ==================== Salary records ====================

  describe('creating a salary record', () => {
    it('starts life as a draft with every total at zero', async () => {
      const period = await createPeriod(api);

      const record = await createRecord(api, {
        employeeId: employee.id,
        periodId: period.id,
        baseSalary: 30000,
      });

      expect(record.status).toBe('draft');
      expect(money(record.totalIncome)).toBe(0);
      expect(money(record.totalDeductions)).toBe(0);
      expect(money(record.netSalary)).toBe(0);
      // The record snapshots the employee so a later rename cannot rewrite
      // history on a payslip that has already been issued.
      expect(record.employeeFirstName).toBe(employee.firstName);
    });

    it('refuses a second record for the same employee and period', async () => {
      const period = await createPeriod(api);
      await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api
        .post('/salary-records')
        .send({ employeeId: employee.id, periodId: period.id });

      expect(response.status).toBe(400);
    });

    it('rejects an employee id that is not a UUID', async () => {
      const period = await createPeriod(api);

      const response = await api
        .post('/salary-records')
        .send({ employeeId: 'not-a-uuid', periodId: period.id });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeId');
    });

    it('rejects a negative base salary', async () => {
      const period = await createPeriod(api);

      const response = await api
        .post('/salary-records')
        .send({ employeeId: employee.id, periodId: period.id, baseSalary: -1 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('baseSalary');
    });

    it('answers 404 for an employee that does not exist', async () => {
      const period = await createPeriod(api);

      const response = await api
        .post('/salary-records')
        .send({ employeeId: MISSING_UUID, periodId: period.id });

      expect(response.status).toBe(404);
    });
  });

  describe('reading salary records', () => {
    it('filters the list by period', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api
        .get('/salary-records')
        .query({ periodId: period.id, limit: 100 })
        .expect(200);

      expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([record.id]);
      expect(response.body.total).toBe(1);
    });

    it('reads one record back with its components and deductions expanded', async () => {
      const { record } = await calculatedRecord();

      const response = await api.get(`/salary-records/${record.id}`).expect(200);

      expect(response.body.id).toBe(record.id);
      expect(Array.isArray(response.body.components)).toBe(true);
      expect(Array.isArray(response.body.deductions)).toBe(true);
    });

    it('answers 404 for a record that does not exist', async () => {
      await api.get(`/salary-records/${MISSING_UUID}`).expect(404);
    });

    it('validates a record and reports what is missing', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, {
        employeeId: employee.id,
        periodId: period.id,
        baseSalary: 30000,
      });

      const response = await api.get(`/salary-records/${record.id}/validate`).expect(200);

      expect(response.body).toMatchObject({ salaryRecordId: record.id, valid: true });
      expect(Array.isArray(response.body.warnings)).toBe(true);
    });

    it('reports a record that does not exist as invalid rather than 404', async () => {
      // The validate endpoint is a report, not a lookup: it answers 200 with
      // `valid: false` so the payroll screen can show the reason inline.
      const response = await api.get(`/salary-records/${MISSING_UUID}/validate`).expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toContain('Salary record not found');
    });
  });

  describe('editing a draft record', () => {
    it('updates the remarks on a draft', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });
      const remarks = uniqueName('หมายเหตุ');

      await api.patch(`/salary-records/${record.id}`).send({ remarks }).expect(200);

      const response = await api.get(`/salary-records/${record.id}`).expect(200);
      expect(response.body.remarks).toBe(remarks);
    });

    it('deletes a draft and then cannot find it', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      await api.delete(`/salary-records/${record.id}`).expect(200);
      await api.get(`/salary-records/${record.id}`).expect(404);
    });

    it('answers 404 when updating a record that does not exist', async () => {
      const response = await api
        .patch(`/salary-records/${MISSING_UUID}`)
        .send({ remarks: 'ไม่มีอยู่จริง' });

      expect(response.status).toBe(404);
    });

    it('answers 404 when deleting a record that does not exist', async () => {
      await api.delete(`/salary-records/${MISSING_UUID}`).expect(404);
    });
  });

  // ==================== The arithmetic ====================

  describe('calculating pay', () => {
    it('pays the full base salary when every working day was paid', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, {
        employeeId: employee.id,
        periodId: period.id,
        baseSalary: 30000,
        totalWorkingDays: 22,
        paidDays: 22,
      });

      const response = await api.post(`/salary-records/${record.id}/calculate`).expect(201);

      expect(response.body.status).toBe('calculated');
      expect(money(response.body.totalIncome)).toBeCloseTo(30000, 2);
      expect(money(response.body.totalDeductions)).toBeCloseTo(0, 2);
      expect(money(response.body.netSalary)).toBeCloseTo(30000, 2);
    });

    it('prorates the base salary over the days actually paid', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, {
        employeeId: employee.id,
        periodId: period.id,
        baseSalary: 30000,
        totalWorkingDays: 20,
        paidDays: 18,
        unpaidLeaveDays: 2,
      });

      const response = await api.post(`/salary-records/${record.id}/calculate`).expect(201);

      // Two unpaid days out of twenty: 30000 / 20 * 18.
      expect(money(response.body.totalIncome)).toBeCloseTo(27000, 2);
      expect(money(response.body.netSalary)).toBeCloseTo(27000, 2);
    });

    it('leaves net pay equal to income minus deductions', async () => {
      const { record, base, componentAmount, deductionAmount } = await calculatedRecord();

      const response = await api.get(`/salary-records/${record.id}`).expect(200);

      const income = money(response.body.totalIncome);
      const deductions = money(response.body.totalDeductions);

      expect(income).toBeCloseTo(base + componentAmount, 2);
      expect(deductions).toBeCloseTo(deductionAmount, 2);
      // The one identity that must never drift: net pay is what is left.
      expect(money(response.body.netSalary)).toBeCloseTo(income - deductions, 2);
    });

    it('raises gross income by exactly the amount of a component added', async () => {
      const { record, base } = await calculatedRecord({ withComponent: false, withDeduction: false });
      const before = money((await api.get(`/salary-records/${record.id}`).expect(200)).body.totalIncome);
      expect(before).toBeCloseTo(base, 2);

      const component = await createComponent(api);
      await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: 1750.5 })
        .expect(201);

      const after = await api.post(`/salary-records/${record.id}/calculate`).expect(201);

      expect(money(after.body.totalIncome)).toBeCloseTo(before + 1750.5, 2);
      expect(money(after.body.netSalary)).toBeCloseTo(before + 1750.5, 2);
    });

    it('raises total deductions by exactly the amount of a deduction added', async () => {
      const { record, base } = await calculatedRecord({ withComponent: false, withDeduction: false });

      const deduction = await createDeduction(api);
      await api
        .post(`/salary-records/${record.id}/deductions`)
        .send({ deductionId: deduction.id, amount: 750.25 })
        .expect(201);

      const after = await api.post(`/salary-records/${record.id}/calculate`).expect(201);

      expect(money(after.body.totalDeductions)).toBeCloseTo(750.25, 2);
      expect(money(after.body.netSalary)).toBeCloseTo(base - 750.25, 2);
    });

    it('follows a component amount that is edited afterwards', async () => {
      const { record, base } = await calculatedRecord({ withComponent: false, withDeduction: false });

      const component = await createComponent(api);
      const added = await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: 1000 })
        .expect(201);

      await api
        .patch(`/salary-records/${record.id}/components/${added.body.id}`)
        .send({ amount: 2500 })
        .expect(200);

      const after = await api.post(`/salary-records/${record.id}/calculate`).expect(201);
      expect(money(after.body.totalIncome)).toBeCloseTo(base + 2500, 2);
    });

    it('drops the amount again when a deduction is removed', async () => {
      const { record, base } = await calculatedRecord({ withComponent: false, withDeduction: false });

      const deduction = await createDeduction(api);
      const added = await api
        .post(`/salary-records/${record.id}/deductions`)
        .send({ deductionId: deduction.id, amount: 900 })
        .expect(201);

      await api
        .delete(`/salary-records/${record.id}/deductions/${added.body.id}`)
        .expect(200);

      const after = await api.post(`/salary-records/${record.id}/calculate`).expect(201);
      expect(money(after.body.totalDeductions)).toBeCloseTo(0, 2);
      expect(money(after.body.netSalary)).toBeCloseTo(base, 2);
    });

    it('answers 404 when calculating a record that does not exist', async () => {
      await api.post(`/salary-records/${MISSING_UUID}/calculate`).expect(404);
    });
  });

  describe('record lines', () => {
    it('refuses the same component twice on one record', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });
      const component = await createComponent(api);

      await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: 100 })
        .expect(201);

      const response = await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: 200 });

      expect(response.status).toBe(400);
    });

    it('rejects a negative component amount', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });
      const component = await createComponent(api);

      const response = await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: -5 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('amount');
    });

    it('rejects a deduction percentage above 100', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });
      const deduction = await createDeduction(api);

      const response = await api
        .post(`/salary-records/${record.id}/deductions`)
        .send({ deductionId: deduction.id, amount: 100, percentage: 120 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('percentage');
    });

    it('answers 404 for a component that is not in the catalogue', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: MISSING_UUID, amount: 100 });

      expect(response.status).toBe(404);
    });

    it('answers 404 when adding a line to a record that does not exist', async () => {
      const component = await createComponent(api);

      const response = await api
        .post(`/salary-records/${MISSING_UUID}/components`)
        .send({ componentId: component.id, amount: 100 });

      expect(response.status).toBe(404);
    });

    it('answers 404 when editing a line that is not on the record', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api
        .patch(`/salary-records/${record.id}/components/${MISSING_UUID}`)
        .send({ amount: 10 });

      expect(response.status).toBe(404);
    });

    it('answers 404 when removing a deduction that is not on the record', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      await api
        .delete(`/salary-records/${record.id}/deductions/${MISSING_UUID}`)
        .expect(404);
    });
  });

  // ==================== The state machine ====================

  describe('draft → calculated → approved → paid', () => {
    it('walks the whole cycle', async () => {
      const { record } = await calculatedRecord();

      const approved = await api.post(`/salary-records/${record.id}/approve`).expect(201);
      expect(approved.body.status).toBe('approved');
      expect(approved.body.approvedAt).toBeTruthy();

      const paid = await api.post(`/salary-records/${record.id}/pay`).expect(201);
      expect(paid.body.status).toBe('paid');
      expect(paid.body.paidAt).toBeTruthy();
    });

    it('refuses to approve a record that has not been calculated', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api.post(`/salary-records/${record.id}/approve`);
      expect(response.status).toBe(400);
    });

    it('refuses to approve the same record twice', async () => {
      const { record } = await calculatedRecord();
      await api.post(`/salary-records/${record.id}/approve`).expect(201);

      const response = await api.post(`/salary-records/${record.id}/approve`);
      expect(response.status).toBe(400);
    });

    it('refuses to pay a record that has only been calculated', async () => {
      const { record } = await calculatedRecord();

      const response = await api.post(`/salary-records/${record.id}/pay`);
      expect(response.status).toBe(400);
    });

    it('answers 404 when approving a record that does not exist', async () => {
      await api.post(`/salary-records/${MISSING_UUID}/approve`).expect(404);
    });
  });

  describe('a paid record is closed', () => {
    let paidRecordId: string;

    beforeAll(async () => {
      const { record } = await calculatedRecord();
      await api.post(`/salary-records/${record.id}/approve`).expect(201);
      await api.post(`/salary-records/${record.id}/pay`).expect(201);
      paidRecordId = record.id;
    });

    it('refuses to edit it', async () => {
      const response = await api
        .patch(`/salary-records/${paidRecordId}`)
        .send({ remarks: 'แก้ไขหลังจ่าย' });

      expect(response.status).toBe(400);
    });

    it('refuses to delete it', async () => {
      const response = await api.delete(`/salary-records/${paidRecordId}`);
      expect(response.status).toBe(400);
    });

    it('refuses to add a component to it', async () => {
      const component = await createComponent(api);

      const response = await api
        .post(`/salary-records/${paidRecordId}/components`)
        .send({ componentId: component.id, amount: 500 });

      expect(response.status).toBe(400);
    });

    it('refuses to add a deduction to it', async () => {
      const deduction = await createDeduction(api);

      const response = await api
        .post(`/salary-records/${paidRecordId}/deductions`)
        .send({ deductionId: deduction.id, amount: 500 });

      expect(response.status).toBe(400);
    });

    it('refuses to cancel it', async () => {
      const response = await api.post(`/salary-records/${paidRecordId}/cancel`);
      expect(response.status).toBe(400);
    });

    // KNOWN DEFECT — SalaryRecordsService.calculate() checks no status at all
    // (salary-records.service.ts:474); only update, delete and the line
    // endpoints do. So a record that has already been paid can be recalculated,
    // silently rewriting totalIncome, totalDeductions and netSalary of money
    // that has left the bank, while status stays 'paid'... except calculate
    // also resets status to 'calculated', so the payment is lost too. Expected
    // to fail until calculate() refuses an approved or paid record.
    test.failing('refuses to recalculate it', async () => {
      const response = await api.post(`/salary-records/${paidRecordId}/calculate`);

      expect(response.status).toBe(400);
    });
  });

  describe('reverting and cancelling', () => {
    it('steps a paid record back one stage at a time', async () => {
      const { record } = await calculatedRecord();
      await api.post(`/salary-records/${record.id}/approve`).expect(201);
      await api.post(`/salary-records/${record.id}/pay`).expect(201);

      // Revert is a single step back through the same states, not a reset, so
      // an accidental "paid" can be undone without losing the approval.
      const toApproved = await api.post(`/salary-records/${record.id}/revert`).expect(201);
      expect(toApproved.body.status).toBe('approved');
      expect(toApproved.body.paidAt).toBeNull();

      const toCalculated = await api.post(`/salary-records/${record.id}/revert`).expect(201);
      expect(toCalculated.body.status).toBe('calculated');
      expect(toCalculated.body.approvedAt).toBeNull();

      const toDraft = await api.post(`/salary-records/${record.id}/revert`).expect(201);
      expect(toDraft.body.status).toBe('draft');
    });

    it('refuses to revert a record that is already a draft', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, { employeeId: employee.id, periodId: period.id });

      const response = await api.post(`/salary-records/${record.id}/revert`);
      expect(response.status).toBe(400);
    });

    it('cancels a calculated record', async () => {
      const { record } = await calculatedRecord();

      const response = await api.post(`/salary-records/${record.id}/cancel`).expect(201);
      expect(response.body.status).toBe('cancelled');
    });

    it('refuses to revert a cancelled record', async () => {
      const { record } = await calculatedRecord();
      await api.post(`/salary-records/${record.id}/cancel`).expect(201);

      // Cancelled is terminal: the way back is a new record, so the reason for
      // the cancellation stays visible in the period.
      const response = await api.post(`/salary-records/${record.id}/revert`);
      expect(response.status).toBe(400);
    });

    it('answers 404 when reverting a record that does not exist', async () => {
      await api.post(`/salary-records/${MISSING_UUID}/revert`).expect(404);
    });

    it('answers 404 when cancelling a record that does not exist', async () => {
      await api.post(`/salary-records/${MISSING_UUID}/cancel`).expect(404);
    });
  });

  // ==================== Exposure ====================

  describe('exposure', () => {
    it('hides a record from another tenant', async () => {
      const period = await createPeriod(api);
      const record = await createRecord(api, {
        employeeId: employee.id,
        periodId: period.id,
        baseSalary: 30000,
      });

      await otherTenant.get(`/salary-records/${record.id}`).expect(404);

      const list = await otherTenant
        .get('/salary-records')
        .query({ limit: 100 })
        .expect(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(record.id);
    });

    it('hides a salary period from another tenant', async () => {
      const period = await createPeriod(api);

      await otherTenant.get(`/salary-periods/${period.id}`).expect(404);
    });

    // KNOWN DEFECT (security) — none of SalaryRecordsController,
    // SalaryPeriodsController, SalaryComponentsController or
    // SalaryDeductionsController carries a guard: they resolve the tenant from
    // the `x-tenant-id` header alone (resolveTenantIdOrThrow). Anyone who can
    // reach the API and guess a tenant id can read every salary in that
    // company, and write records into it. SalaryPeriodsController even imports
    // HrJwtAuthGuard without ever applying it. Expected to fail until the
    // controllers are guarded.
    const unguarded = ['/salary-records', '/salary-periods', '/salary-components'];

    test.failing.each(unguarded)('refuses an anonymous caller on %s', async (route) => {
      const response = await api
        .as({ tenantId: loadTestEnv().tenantId })
        .get(route);

      expect(response.status).toBe(401);
    });
  });

  // ==================== Fixtures ====================
  //
  // Local to this suite on purpose: nothing else creates payroll fixtures yet,
  // and a factory with one caller is easier to read beside its tests.

  /** A UUID that is syntactically valid and belongs to nothing. */
  const MISSING_UUID = '00000000-0000-4000-8000-0000000000ff';

  interface PeriodSlot {
    month: number;
    year: number;
    startDate: string;
    endDate: string;
  }

  /**
   * Month/year is unique per tenant, so every period fixture needs its own
   * slot. The counter walks forward from 2030 — far enough ahead that it can
   * never collide with a period a seeder or another suite might create.
   */
  let periodSlotCounter = 0;
  function nextPeriodSlot(): PeriodSlot {
    const index = periodSlotCounter++;
    const month = (index % 12) + 1;
    const year = 2030 + Math.floor(index / 12);
    const mm = String(month).padStart(2, '0');
    return {
      month,
      year,
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-28`,
    };
  }

  /** Unique code that fits the column, for the `code` fields that must not clash. */
  let codeCounter = 0;
  function uniqueCodeOfLength(max: number): string {
    const code = `E2E${Date.now().toString(36)}${codeCounter++}`.toUpperCase();
    return code.slice(0, max);
  }

  interface PeriodFixture extends PeriodSlot {
    id: string;
    periodCode: string;
  }

  async function createPeriod(client: ApiClient): Promise<PeriodFixture> {
    const slot = nextPeriodSlot();
    const periodCode = uniqueCodeOfLength(20);

    const response = await client.post('/salary-periods').send({
      month: slot.month,
      year: slot.year,
      periodCode,
      periodName: uniqueName('รอบเงินเดือน'),
      startDate: slot.startDate,
      endDate: slot.endDate,
      payDate: slot.endDate,
    });

    const period = response.body?.data?.period;
    if (response.status >= 300 || !period?.id) {
      throw new Error(
        `Failed to create salary period fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    return { ...slot, id: period.id, periodCode };
  }

  async function createComponent(
    client: ApiClient,
    options: { name?: string; category?: string } = {},
  ): Promise<{ id: string; code: string }> {
    const code = uniqueCodeOfLength(50);

    const response = await client.post('/salary-components').send({
      code,
      name: uniqueName(options.name ?? 'รายได้'),
      category: options.category ?? 'allowance',
      type: 'fixed',
    });

    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Failed to create salary component fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    return { id: response.body.id, code };
  }

  async function createDeduction(
    client: ApiClient,
    options: { name?: string; category?: string } = {},
  ): Promise<{ id: string; code: string }> {
    const code = uniqueCodeOfLength(50);

    const response = await client.post('/salary-deductions').send({
      code,
      name: uniqueName(options.name ?? 'เงินหัก'),
      // Deliberately not 'provident_fund': that category triggers the provident
      // fund auto-sync during calculation, which would add amounts this suite
      // did not put there.
      category: options.category ?? 'other',
      calculationType: 'fixed',
    });

    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Failed to create salary deduction fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    return { id: response.body.id, code };
  }

  async function createSalaryInfo(
    client: ApiClient,
    options: { employeeId: string; baseSalary: number; effectiveDate?: string },
  ): Promise<{ id: string }> {
    const response = await client.post('/employee-salary-info').send({
      employeeId: options.employeeId,
      baseSalary: options.baseSalary,
      effectiveDate: options.effectiveDate ?? '2030-01-01',
    });

    const info = response.body?.data?.salaryInfo;
    if (response.status >= 300 || !info?.id) {
      throw new Error(
        `Failed to create employee salary info fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    return { id: info.id };
  }

  interface CreateRecordOptions {
    employeeId: string;
    periodId: string;
    baseSalary?: number;
    totalWorkingDays?: number;
    paidDays?: number;
    unpaidLeaveDays?: number;
  }

  async function createRecord(
    client: ApiClient,
    options: CreateRecordOptions,
  ): Promise<Record<string, any>> {
    const payload: Record<string, unknown> = {
      employeeId: options.employeeId,
      periodId: options.periodId,
      // internal_calculation rather than manual_entry: the calculate endpoint
      // only reaches for attendance and leave when the data source is manual,
      // and this suite seeds neither.
      dataSource: 'internal_calculation',
    };
    if (options.baseSalary !== undefined) payload.baseSalary = options.baseSalary;
    if (options.totalWorkingDays !== undefined) payload.totalWorkingDays = options.totalWorkingDays;
    if (options.paidDays !== undefined) payload.paidDays = options.paidDays;
    if (options.unpaidLeaveDays !== undefined) payload.unpaidLeaveDays = options.unpaidLeaveDays;

    const response = await client.post('/salary-records').send(payload);

    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Failed to create salary record fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    return response.body;
  }

  interface CalculatedRecord {
    record: Record<string, any>;
    /** Base salary after proration — the whole of it, since every day is paid. */
    base: number;
    componentAmount: number;
    deductionAmount: number;
  }

  /**
   * A record in `calculated` status on a period of its own, with round numbers
   * so the totals can be asserted exactly: 30000 base over 22 paid days of 22,
   * plus a 1500 component, less a 750 deduction.
   */
  async function calculatedRecord(
    options: { withComponent?: boolean; withDeduction?: boolean } = {},
  ): Promise<CalculatedRecord> {
    const withComponent = options.withComponent ?? true;
    const withDeduction = options.withDeduction ?? true;

    const period = await createPeriod(api);
    const record = await createRecord(api, {
      employeeId: employee.id,
      periodId: period.id,
      baseSalary: 30000,
      totalWorkingDays: 22,
      paidDays: 22,
    });

    const componentAmount = withComponent ? 1500 : 0;
    const deductionAmount = withDeduction ? 750 : 0;

    if (withComponent) {
      const component = await createComponent(api);
      await api
        .post(`/salary-records/${record.id}/components`)
        .send({ componentId: component.id, amount: componentAmount })
        .expect(201);
    }

    if (withDeduction) {
      const deduction = await createDeduction(api);
      await api
        .post(`/salary-records/${record.id}/deductions`)
        .send({ deductionId: deduction.id, amount: deductionAmount })
        .expect(201);
    }

    const calculated = await api.post(`/salary-records/${record.id}/calculate`).expect(201);

    return { record: calculated.body, base: 30000, componentAmount, deductionAmount };
  }
});
