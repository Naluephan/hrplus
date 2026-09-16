/**
 * The employee profile screens and the provident fund module.
 *
 * Every tab of the employee profile writes through its own endpoint and reads
 * back through a matching one, so each test here follows that round trip:
 * write the sub-resource, read it on the employee it belongs to, and check it
 * is not visible on a second employee. A sub-resource that leaks onto another
 * employee — or another tenant — is the failure mode this suite exists for.
 *
 * Three things shape most of the tests:
 *
 *   1. The employee sub-resource routes come in two spellings
 *      (`/employees/:id/educations` and `/employees/educations/:id`). The
 *      profile screens use the second, so that is the one covered here.
 *   2. Several handlers type their body as a plain TypeScript type rather than
 *      a decorated DTO (documents, payroll, wizard, PF registrations), so the
 *      global ValidationPipe has nothing to check and the service's own guards
 *      are the only validation there is.
 *   3. Provident fund amounts are derived from a percentage of the employee's
 *      salary at write time. Those tests assert the arithmetic, not just that
 *      a number came back.
 *
 * Skipped deliberately: every multipart/file endpoint (`POST /employees/wizard`
 * file fields, `PATCH /employees/documents/:id` uploads,
 * `POST /employees/vehicles/documents/:id`, `POST /employees/profile-images/import`),
 * and every import/export endpoint (`/provident-funds/records/export|import`,
 * `/employees/export-payroll`, `/employees/attendance/:id/export`).
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
  createPosition,
  type EmployeeFixture,
} from '../support/factories';

/** Salary every employee in this suite is created with, so the provident fund
 *  arithmetic below has one known base to multiply against. */
const BASE_SALARY = 30000;

describe('Employee profile and provident funds (e2e)', () => {
  let api: ApiClient;
  let departmentId: string;
  let positionId: string;
  /** The employee most read-back assertions are made on. */
  let employee: EmployeeFixture;
  /** A second employee, so every "written here, not there" check has a "there". */
  let other: EmployeeFixture;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    const department = await createDepartment(api);
    departmentId = department.id;
    positionId = (await createPosition(api, department.id)).id;

    // One at a time: concurrent creates collide on the generated
    // account-access username.
    employee = await newEmployee();
    other = await newEmployee();
  });

  afterAll(purgeTestTenantData);

  // ─── local fixtures ────────────────────────────────────────────────────────
  // They live here rather than in support/factories because this is the only
  // suite that needs them.

  const newEmployee = (overrides: Record<string, unknown> = {}) =>
    createEmployee(api, { departmentId, salary: BASE_SALARY, ...overrides });

  /** Fails loudly with the server's own body, so one bad fixture does not
   *  become a dozen confusing failures. */
  const expectOk = (response: { status: number; body: unknown }, what: string) => {
    if (response.status >= 300) {
      throw new Error(
        `Could not create ${what} (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as any;
  };

  /** A provident fund plan. Rates default to a band wide enough that the
   *  registrations below sit inside it. */
  const createPlan = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      code: `PVD${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`,
      name: uniqueName('แผนกองทุนทดสอบ'),
      minEmployeeRate: 0,
      maxEmployeeRate: 15,
      defaultEmployeeRate: 3,
      minCompanyRate: 0,
      maxCompanyRate: 15,
      defaultCompanyRate: 3,
      ...overrides,
    };
    const body = expectOk(
      await api.post('/provident-funds/plans').send(payload),
      'a provident fund plan',
    );
    return { id: String(body.id), payload };
  };

  /** Registers an employee in the fund — the prerequisite for monthly record
   *  generation and for the registered-employee searches. */
  const registerEmployee = async (
    employeeId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const payload = {
      employeeId,
      employeeContributionRate: 3,
      companyContributionRate: 3,
      ...overrides,
    };
    const body = expectOk(
      await api.post('/provident-funds/registrations').send(payload),
      'a provident fund registration',
    );
    return { id: String(body.id ?? body.data?.id), payload };
  };

  const createRecord = async (overrides: Record<string, unknown> = {}) => {
    const payload = {
      employeeId: employee.id,
      month: 1,
      year: 2025,
      employeeContributionPercentage: 3,
      ...overrides,
    };
    const body = expectOk(
      await api.post('/provident-funds/records').send(payload),
      'a provident fund record',
    );
    return { id: String(body.id), payload };
  };

  /** Ids of the registrations the list endpoint currently returns. */
  const listRegistrationIds = async () => {
    const response = await api
      .post('/provident-funds/registrations/list')
      .send({ limit: 200 })
      .expect(201);
    return (response.body.data as Array<{ id: string }>).map((row) => row.id);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Employment tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('employment', () => {
    it('stores the employment details and reads them back on the same employee', async () => {
      const target = await newEmployee();
      const hospital = uniqueName('โรงพยาบาลทดสอบ');

      await api
        .patch(`/employees/${target.id}/employment`)
        .send({
          departmentId,
          positionId,
          startDate: '2023-05-01',
          socialSecurityHospital: hospital,
        })
        .expect(200);

      const response = await api
        .get(`/employees/${target.id}/employment-info`)
        .expect(200);

      expect(response.body).toMatchObject({
        employeeId: target.id,
        departmentId,
        positionId,
      });
      expect(String(response.body.startDate)).toContain('2023-05-01');
      expect(response.body.socialSecurityInfos).toEqual([
        expect.objectContaining({ hospitalName: hospital }),
      ]);
    });

    it('does not show one employee’s employment details on another', async () => {
      const target = await newEmployee();
      const reason = uniqueName('เหตุผลเฉพาะคน');

      await api
        .patch(`/employees/${target.id}/employment`)
        .send({ resignationReason: reason })
        .expect(200);

      const mine = await api.get(`/employees/${target.id}/employment-info`).expect(200);
      expect(mine.body.resignationReason).toBe(reason);

      const theirs = await api.get(`/employees/${other.id}/employment-info`).expect(200);
      expect(theirs.body.resignationReason).not.toBe(reason);
    });

    /**
     * Defect. `employees.entity.ts` declares `employee_level` as a `char(36)`
     * FK to `levels` (`@ManyToOne(() => Level …) @JoinColumn({ name:
     * 'employee_level' })`, employee.entity.ts:175-181 and 315-317), while
     * `UpdateEmploymentDto` validates it as nothing more than
     * `@IsString() @MaxLength(60)` (dto/update-employment.dto.ts). A level name
     * typed into the form — anything that is not an existing level id — reaches
     * MySQL, violates the foreign key and comes back as a 500 with a raw driver
     * error instead of a 400 naming the field.
     */
    test.failing('rejects an employee level that is not a known level', async () => {
      const response = await api
        .patch(`/employees/${employee.id}/employment`)
        .send({ employeeLevel: 'senior' });

      expect(response.status).toBe(400);
    });

    it('rejects an employment update whose department id is not a UUID', async () => {
      const response = await api
        .patch(`/employees/${employee.id}/employment`)
        .send({ departmentId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('rejects an employment update whose offboarding month is out of range', async () => {
      const response = await api
        .patch(`/employees/${employee.id}/employment`)
        .send({ offboardingMonth: 13 });

      expect(response.status).toBe(400);
    });

    it('answers 404 when the employment update names an unknown employee', async () => {
      const response = await api
        .patch('/employees/00000000-0000-4000-8000-00000000dead/employment')
        .send({ employeeLevel: 'junior' });

      expect(response.status).toBe(404);
    });

    it('answers 404 when the employment info is read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/00000000-0000-4000-8000-00000000dead/employment-info',
      );

      expect(response.status).toBe(404);
    });

    it('requires credentials to read the employment info', async () => {
      const response = await api.anonymous().get(`/employees/${employee.id}/employment-info`);

      expect(response.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Education tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('educations', () => {
    it('adds an education record and reads it back on that employee alone', async () => {
      const target = await newEmployee();
      const institution = uniqueName('มหาวิทยาลัยทดสอบ');

      await api
        .patch(`/employees/educations/${target.id}`)
        .send({
          added: [
            {
              educationLevel: 'ปริญญาตรี',
              institution,
              major: 'วิศวกรรมคอมพิวเตอร์',
              graduationYear: 2019,
            },
          ],
        })
        .expect(200);

      const mine = await api.get(`/employees/educations/${target.id}`).expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({
          employeeId: target.id,
          educationLevel: 'ปริญญาตรี',
          institution,
          graduationYear: 2019,
        }),
      ]);

      // The same record must not surface on a different employee.
      const theirs = await api.get(`/employees/educations/${other.id}`).expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain(institution);
    });

    it('updates and removes an education record through the same endpoint', async () => {
      const target = await newEmployee();
      await api
        .patch(`/employees/educations/${target.id}`)
        .send({ added: [{ educationLevel: 'ปวส.', institution: uniqueName('วิทยาลัย') }] })
        .expect(200);

      const created = (await api.get(`/employees/educations/${target.id}`).expect(200)).body[0];

      await api
        .patch(`/employees/educations/${target.id}`)
        .send({ updated: [{ id: created.id, major: 'บัญชี' }] })
        .expect(200);
      const afterUpdate = await api.get(`/employees/educations/${target.id}`).expect(200);
      expect(afterUpdate.body[0].major).toBe('บัญชี');

      await api
        .patch(`/employees/educations/${target.id}`)
        .send({ removed: [created.id] })
        .expect(200);
      const afterRemoval = await api.get(`/employees/educations/${target.id}`).expect(200);
      expect(afterRemoval.body).toEqual([]);
    });

    it('rejects an education entry with no level', async () => {
      const response = await api
        .patch(`/employees/educations/${employee.id}`)
        .send({ added: [{ institution: 'ไม่มีระดับการศึกษา' }] });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('answers 404 when educations are written for an unknown employee', async () => {
      const response = await api
        .patch('/employees/educations/00000000-0000-4000-8000-00000000dead')
        .send({ added: [{ educationLevel: 'ปริญญาตรี' }] });

      expect(response.status).toBe(404);
    });

    it('answers 404 when educations are read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/educations/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Emergency contacts tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('emergency contacts', () => {
    it('adds a contact and reads it back on that employee alone', async () => {
      const target = await newEmployee();
      const contactName = uniqueName('ผู้ติดต่อฉุกเฉิน');

      await api
        .patch(`/employees/emergency-contacts/${target.id}`)
        .send({ added: [{ contactName, relation: 'พี่สาว', phone: '0812345678' }] })
        .expect(200);

      const mine = await api
        .get(`/employees/emergency-contacts/${target.id}`)
        .expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({ employeeId: target.id, contactName, phone: '0812345678' }),
      ]);

      const theirs = await api
        .get(`/employees/emergency-contacts/${other.id}`)
        .expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain(contactName);
    });

    it('rejects a contact with no phone number', async () => {
      const response = await api
        .patch(`/employees/emergency-contacts/${employee.id}`)
        .send({ added: [{ contactName: 'ไม่มีเบอร์' }] });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('answers 404 when contacts are written for an unknown employee', async () => {
      const response = await api
        .patch('/employees/emergency-contacts/00000000-0000-4000-8000-00000000dead')
        .send({ added: [{ contactName: 'ทดสอบ', phone: '0800000000' }] });

      expect(response.status).toBe(404);
    });

    /**
     * Defect. `EmployeesService.findEmergencyContacts` (employees.service.ts)
     * runs a plain `find({ employeeId, tenantId })` with no existence check,
     * so an unknown — or another tenant's — employee id answers 200 and an
     * empty array instead of 404. Every sibling tab (educations, work
     * experiences, documents) checks first; this one does not, so the profile
     * screen cannot tell "no contacts" from "no such employee".
     */
    test.failing('answers 404 when contacts are read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/emergency-contacts/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Work experience tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('work experiences', () => {
    it('adds a work experience and reads it back on that employee alone', async () => {
      const target = await newEmployee();
      const companyName = uniqueName('บริษัททดสอบ');

      await api
        .patch(`/employees/work-experiences/${target.id}`)
        .send({
          added: [
            {
              companyName,
              position: 'นักพัฒนาระบบ',
              startDate: '2020-01-01',
              endDate: '2022-12-31',
              description: 'ทดสอบประวัติการทำงาน',
            },
          ],
        })
        .expect(200);

      const mine = await api.get(`/employees/work-experiences/${target.id}`).expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({
          employeeId: target.id,
          companyName,
          position: 'นักพัฒนาระบบ',
        }),
      ]);

      const theirs = await api.get(`/employees/work-experiences/${other.id}`).expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain(companyName);
    });

    it('rejects a work experience whose start date is not a date', async () => {
      const response = await api
        .patch(`/employees/work-experiences/${employee.id}`)
        .send({
          added: [{ companyName: 'บริษัท', position: 'ตำแหน่ง', startDate: 'เมื่อวาน' }],
        });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('answers 404 when work experiences are read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/work-experiences/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Documents tab — the link-only path. File uploads are out of scope.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('documents', () => {
    it('stores a document link and reads it back on that employee alone', async () => {
      const target = await newEmployee();
      const label = uniqueName('สัญญาจ้าง');

      await api
        .patch(`/employees/documents/${target.id}`)
        .send({
          documentsAndContracts: {
            links: [{ label, fileUrl: 'https://example.test/contract.pdf' }],
          },
        })
        .expect(200);

      const mine = await api.get(`/employees/documents/${target.id}`).expect(200);
      expect(mine.body.employeeId).toBe(target.id);
      expect(mine.body.totalDocuments).toBeGreaterThan(0);
      expect(JSON.stringify(mine.body)).toContain(label);

      const theirs = await api.get(`/employees/documents/${other.id}`).expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain(label);
    });

    it('rejects a document update with nothing in it', async () => {
      const response = await api.patch(`/employees/documents/${employee.id}`).send({});

      expect(response.status).toBe(400);
    });

    it('answers 404 when documents are read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/documents/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Account access tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('account access', () => {
    /** The HR_ADMIN role the support layer seeds — a real, active role id. */
    const anActiveRoleId = async () => {
      const response = await api.get('/roles').expect(200);
      const roles = response.body.roles as Array<{ id: string; name: string }>;
      const role = roles[0];
      if (!role) throw new Error('No active role exists to assign — cannot test access.');
      return role.id;
    };

    it('sets an employee’s login and reads it back through userInformation', async () => {
      const target = await newEmployee();
      const username = `e2e.access.${Date.now().toString(36)}`;
      const roleId = await anActiveRoleId();

      await api
        .patch(`/employees/${target.id}/access`)
        .send({
          username,
          password: 'E2ePassword!2026',
          pin: ['1', '2', '3', '4'],
          roles: [roleId],
          attendanceMethod: 2,
          accessEnabled: true,
        })
        .expect(200);

      const response = await api.get(`/employees/userInformation/${target.id}`).expect(200);
      expect(response.body.employeeId).toBe(target.id);
      expect(response.body.logins[0]).toMatchObject({ username, attendanceMethod: 2 });
      expect(response.body.roleAssignments.map((a: { roleId: string }) => a.roleId)).toContain(
        roleId,
      );
    });

    it('does not put one employee’s login on another', async () => {
      const target = await newEmployee();
      const username = `e2e.solo.${Date.now().toString(36)}`;

      await api
        .patch(`/employees/${target.id}/access`)
        .send({ username, password: 'E2ePassword!2026' })
        .expect(200);

      const theirs = await api.get(`/employees/userInformation/${other.id}`).expect(200);
      expect(JSON.stringify(theirs.body.logins)).not.toContain(username);
    });

    it('rejects an access update whose password is too short', async () => {
      const response = await api
        .patch(`/employees/${employee.id}/access`)
        .send({ username: 'e2e.short', password: 'short' });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('rejects a PIN that is not four digits', async () => {
      const response = await api
        .patch(`/employees/${employee.id}/access`)
        .send({ username: 'e2e.pin', pin: ['1', '2', '3'] });

      expect(response.status).toBe(400);
    });

    it('answers 404 when access is set for an unknown employee', async () => {
      const response = await api
        .patch('/employees/00000000-0000-4000-8000-00000000dead/access')
        .send({ username: 'e2e.ghost' });

      expect(response.status).toBe(404);
    });

    it('enables access for several employees at once', async () => {
      const first = await newEmployee();
      const second = await newEmployee();
      const roleId = await anActiveRoleId();

      const response = await api
        .put('/employees/access')
        .send({ employeeIds: [first.id, second.id], accessEnabled: true, roleIds: [roleId] });

      expect(response.status).toBe(200);

      for (const id of [first.id, second.id]) {
        const info = await api.get(`/employees/userInformation/${id}`).expect(200);
        expect(info.body.roleAssignments.map((a: { roleId: string }) => a.roleId)).toContain(
          roleId,
        );
      }
    });

    it('refuses to enable access without naming a role', async () => {
      const target = await newEmployee();

      const response = await api
        .put('/employees/access')
        .send({ employeeIds: [target.id], accessEnabled: true });

      expect(response.status).toBe(400);
    });

    it('answers 404 when the bulk access update names an unknown employee', async () => {
      const roleId = await anActiveRoleId();

      const response = await api.put('/employees/access').send({
        employeeIds: ['00000000-0000-4000-8000-00000000dead'],
        accessEnabled: true,
        roleIds: [roleId],
      });

      expect(response.status).toBe(404);
    });

    it('requires credentials to read userInformation', async () => {
      const response = await api.anonymous().get(`/employees/userInformation/${employee.id}`);

      expect(response.status).toBe(401);
    });

    it('answers 404 when userInformation is read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/userInformation/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Attendance method
  // ═══════════════════════════════════════════════════════════════════════════
  describe('attendance method', () => {
    it('switches the attendance method for the named employees only', async () => {
      const target = await newEmployee();
      await api
        .patch(`/employees/${target.id}/access`)
        .send({ username: `e2e.att.${Date.now().toString(36)}`, attendanceMethod: 1 })
        .expect(200);

      await api
        .put('/employees/attendance-method')
        .send({ employeeIds: [target.id], attendanceMethod: 2 })
        .expect(200);

      const info = await api.get(`/employees/userInformation/${target.id}`).expect(200);
      expect(info.body.logins[0].attendanceMethod).toBe(2);
    });

    it('rejects an attendance method outside the allowed set', async () => {
      const response = await api
        .put('/employees/attendance-method')
        .send({ employeeIds: [employee.id], attendanceMethod: 3 });

      expect(response.status).toBe(400);
    });

    it('answers 404 when the attendance method is set for an unknown employee', async () => {
      const response = await api.put('/employees/attendance-method').send({
        employeeIds: ['00000000-0000-4000-8000-00000000dead'],
        attendanceMethod: 1,
      });

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Payroll tab
  // ═══════════════════════════════════════════════════════════════════════════
  describe('payroll details', () => {
    it('stores the bank account and pay cycle, and reads them back', async () => {
      const target = await newEmployee();
      const accountName = uniqueName('บัญชีทดสอบ');

      await api
        .patch(`/employees/payroll/${target.id}`)
        .send({
          payCycle: 'monthly',
          accountNumber: '1234567890',
          accountName,
          accountNameEn: 'Test Account',
        })
        .expect(200);

      const response = await api.get(`/employees/payroll-details/${target.id}`).expect(200);
      expect(response.body).toMatchObject({ id: target.id, payCycle: 'monthly' });
      expect(response.body.bankAccounts).toEqual([
        expect.objectContaining({ accountNumber: '1234567890', accountName }),
      ]);
    });

    it('does not put one employee’s bank account on another', async () => {
      const target = await newEmployee();
      const accountName = uniqueName('บัญชีเฉพาะคน');

      await api
        .patch(`/employees/payroll/${target.id}`)
        .send({ accountNumber: '9876543210', accountName })
        .expect(200);

      const theirs = await api.get(`/employees/payroll-details/${other.id}`).expect(200);
      expect(JSON.stringify(theirs.body.bankAccounts)).not.toContain(accountName);
    });

    it('rejects a payroll update that changes nothing', async () => {
      const response = await api.patch(`/employees/payroll/${employee.id}`).send({});

      expect(response.status).toBe(400);
    });

    it('answers 404 when payroll details are written for an unknown employee', async () => {
      const response = await api
        .patch('/employees/payroll/00000000-0000-4000-8000-00000000dead')
        .send({ payCycle: 'monthly' });

      expect(response.status).toBe(404);
    });

    it('answers 404 when payroll details are read for an unknown employee', async () => {
      const response = await api.get(
        '/employees/payroll-details/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Personal vehicles — the read side. Writing one goes through a multipart
  // document upload, which is out of scope, so the vehicle is created with the
  // employee instead.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('personal vehicles', () => {
    it('lists the vehicles that belong to the employee and no others', async () => {
      const licensePlate = `กข${Math.floor(Math.random() * 9000) + 1000}`;
      const owner = await createEmployee(api, {
        departmentId,
        salary: BASE_SALARY,
      });
      // The vehicle is attached through POST /employees, the only non-multipart
      // way into the table.
      const withVehicle = await api
        .post('/employees')
        .send({
          firstName: 'เจ้าของรถ',
          lastName: uniqueName('ทดสอบ'),
          email: `e2e.vehicle.${Date.now().toString(36)}@example.test`,
          departmentId,
          vehicles: [{ brand: 'Toyota', licensePlate, vehicleType: 0, color: 'ขาว' }],
        })
        .expect(201);

      const mine = await api
        .get(`/employees/vehicles/personal/${withVehicle.body.id}`)
        .expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({
          employeeId: withVehicle.body.id,
          licensePlate,
          brand: 'Toyota',
        }),
      ]);

      const theirs = await api.get(`/employees/vehicles/personal/${owner.id}`).expect(200);
      expect(theirs.body).toEqual([]);
    });

    it('rejects a vehicle lookup whose employee id is not a UUID', async () => {
      const response = await api.get('/employees/vehicles/personal/not-a-uuid');

      expect(response.status).toBe(400);
    });

    /**
     * Defect. `EmployeeVehiclesController` has its `@UseGuards(HrJwtAuthGuard)`
     * commented out (controllers/employee-vehicles.controller.ts line 25), so
     * anyone who knows an employee id and a tenant id can read that person's
     * vehicle registrations and the images attached to them.
     */
    test.failing('requires credentials to read an employee’s vehicles', async () => {
      const response = await api
        .anonymous()
        .get(`/employees/vehicles/personal/${employee.id}`)
        .set('x-tenant-id', loadTestEnv().tenantId);

      expect(response.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Duplicate checks, code generation, username checks
  // ═══════════════════════════════════════════════════════════════════════════
  describe('check-duplicate', () => {
    it('detects an email this suite has already used', async () => {
      const existing = await newEmployee();

      const response = await api
        .post('/employees/check-duplicate')
        .send({ email: existing.email })
        .expect(201);

      expect(response.body).toMatchObject({ emailExists: true });
    });

    it('reports an unused email as free', async () => {
      const response = await api
        .post('/employees/check-duplicate')
        .send({ email: `e2e.unused.${Date.now().toString(36)}@example.test` })
        .expect(201);

      expect(response.body).toMatchObject({ emailExists: false });
    });

    it('detects an employee code this suite has already used', async () => {
      const created = await api
        .post('/employees')
        .send({
          firstName: 'ทดสอบ',
          lastName: uniqueName('รหัสซ้ำ'),
          employeeCode: `E2E${Date.now().toString(36).toUpperCase()}`,
          email: `e2e.code.${Date.now().toString(36)}@example.test`,
        })
        .expect(201);

      // The stored code, not the submitted one: `normalizeEmployeeCodeValue`
      // upper-cases it and strips every non-alphanumeric character
      // (services/employee-helper.service.ts:295), so the duplicate check has to
      // be made against what the API actually kept.
      const response = await api
        .post('/employees/check-duplicate')
        .send({ employeeCode: created.body.employeeCode })
        .expect(201);

      expect(response.body).toMatchObject({ employeeCodeExists: true });
    });

    it('rejects a duplicate check with nothing to check', async () => {
      const response = await api.post('/employees/check-duplicate').send({});

      expect(response.status).toBe(400);
    });

    it('rejects a duplicate check whose email is malformed', async () => {
      const response = await api
        .post('/employees/check-duplicate')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(400);
    });
  });

  describe('employee code generation', () => {
    it('never hands out a code that is already taken', async () => {
      const first = (
        await api.post('/employees/employee-code/generate').send({}).expect(201)
      ).body.employeeCode as string;

      await api
        .post('/employees')
        .send({
          firstName: 'ทดสอบ',
          lastName: uniqueName('รหัสอัตโนมัติ'),
          employeeCode: first,
          email: `e2e.gen.${Date.now().toString(36)}@example.test`,
        })
        .expect(201);

      const second = (
        await api.post('/employees/employee-code/generate').send({}).expect(201)
      ).body.employeeCode as string;

      expect(second).not.toBe(first);
    });

    /**
     * Defect. With no employee-id format configured — the state a fresh tenant
     * is in — `buildEmployeeCodeCandidate` (services/employee-helper.service.ts)
     * falls back to `buildStandardEmployeeCode`, which already ends in the
     * running number, and then appends the running number a second time because
     * `hadSequenceToken` is false for the empty token list. A new tenant's very
     * first employee is therefore `EMP<year>0000100001`, not `EMP<year>00001`.
     */
    test.failing('generates the standard EMP<year><running> code', async () => {
      const response = await api
        .post('/employees/employee-code/generate')
        .send({})
        .expect(201);

      expect(response.body.employeeCode).toMatch(/^EMP\d{4}\d{5}$/);
    });
  });

  describe('isCheckingUsername', () => {
    it('reports an employee code that is already in use', async () => {
      const created = await api
        .post('/employees')
        .send({
          firstName: 'ทดสอบ',
          lastName: uniqueName('ชื่อผู้ใช้'),
          employeeCode: `E2EU${Date.now().toString(36).toUpperCase()}`,
          email: `e2e.user.${Date.now().toString(36)}@example.test`,
        })
        .expect(201);

      // Again the stored code: the endpoint compares against
      // `employee.employeeCode`, which the API normalised on write.
      const response = await api
        .post('/employees/isCheckingUsername')
        .send({ username: created.body.employeeCode })
        .expect(201);

      expect(response.body).toEqual({ isDuplicate: true });
    });

    it('reports an unused value as free', async () => {
      const response = await api
        .post('/employees/isCheckingUsername')
        .send({ username: `free-${Date.now().toString(36)}` })
        .expect(201);

      expect(response.body).toEqual({ isDuplicate: false });
    });

    it('rejects a username check with no username', async () => {
      const response = await api.post('/employees/isCheckingUsername').send({});

      expect(response.status).toBe(400);
    });

    /**
     * Defect. `checkUsernameAvailability` (employees.service.ts) compares the
     * submitted username against `employee.employeeCode`, not against the
     * `employee_logins.username` column the login form actually writes. The
     * account-access screen therefore calls a username free right up to the
     * moment the save fails on the unique login index.
     */
    test.failing('reports a login username that is already taken', async () => {
      const target = await newEmployee();
      const username = `e2e.taken.${Date.now().toString(36)}`;
      await api
        .patch(`/employees/${target.id}/access`)
        .send({ username, password: 'E2ePassword!2026' })
        .expect(200);

      const response = await api
        .post('/employees/isCheckingUsername')
        .send({ username })
        .expect(201);

      expect(response.body).toEqual({ isDuplicate: true });
    });
  });

  describe('POST /employees/search', () => {
    /**
     * The employee module has no search route: the only `POST .../search`
     * endpoints in the product belong to the provident fund controller
     * (`/provident-funds/employees/search`), which is covered below. This test
     * records that, so a future spec does not invent a payload for a route that
     * has never existed.
     */
    it('is not a route the employees module serves', async () => {
      const response = await api.post('/employees/search').send({ search: 'ทดสอบ' });

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Wizard — the JSON path. File fields are out of scope.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('wizard', () => {
    it('creates an employee in the caller’s tenant from the wizard payload', async () => {
      const lastName = uniqueName('วิซาร์ด');
      const suffix = Date.now().toString(36);

      const response = await api.post('/employees/wizard').send({
        tenantId: loadTestEnv().tenantId,
        personal: {
          firstName: 'ทดสอบ',
          lastName,
          email: `e2e.wizard.${suffix}@example.test`,
        },
        employment: {
          departmentId,
          positionId,
          firstWorkingDate: '2024-03-01',
          salary: BASE_SALARY,
        },
        accountAccess: {
          username: `e2e.wizard.${suffix}`,
          password: 'E2ePassword!2026',
          accessEnabled: true,
        },
      });

      expect(response.status).toBeLessThan(300);
      const createdId = response.body.id ?? response.body.employee?.id ?? response.body.data?.id;
      expect(createdId).toEqual(expect.any(String));

      // Readable back in the suite's own tenant — which is what proves the
      // wizard used the caller's tenant rather than its hard-coded fallback.
      const readBack = await api.get(`/employees/${createdId}`).expect(200);
      expect(readBack.body.lastName).toBe(lastName);
    });

    it('rejects a wizard payload with no personal details', async () => {
      const response = await api
        .post('/employees/wizard')
        .send({ tenantId: loadTestEnv().tenantId, employment: {}, accountAccess: {} });

      expect(response.status).toBe(400);
    });

    it('requires credentials', async () => {
      const response = await api.anonymous().post('/employees/wizard').send({});

      expect(response.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dashboard and birthdays
  // ═══════════════════════════════════════════════════════════════════════════
  describe('dashboard', () => {
    it('counts the tenant’s employees when the tenant is named explicitly', async () => {
      await newEmployee();

      const response = await api
        .get('/employees/dashboard')
        .query({ tenantIds: loadTestEnv().tenantId })
        .expect(200);

      expect(response.body.totalActiveEmployees).toBeGreaterThan(0);
      expect(response.body.gender.breakdown).toEqual(expect.any(Array));
      expect(response.body.departments).toEqual(expect.any(Array));
    });

    /**
     * Defect. `GET /employees/dashboard` reads its tenants from a `tenantIds`
     * query parameter or an `x-tenant-ids` header and ignores both the caller's
     * token and the `x-tenant-id` header every other employee route is scoped
     * by (employees.controller.ts). A logged-in HR user therefore sees an empty
     * dashboard for their own company unless the front end remembers to repeat
     * the tenant in a second, differently-named parameter.
     */
    test.failing('scopes the dashboard to the caller’s own tenant', async () => {
      await newEmployee();

      const response = await api.get('/employees/dashboard').expect(200);

      expect(response.body.totalActiveEmployees).toBeGreaterThan(0);
    });
  });

  describe('birthdays', () => {
    it('lists the employees born on the requested day', async () => {
      const lastName = uniqueName('วันเกิด');
      await api
        .post('/employees')
        .send({
          firstName: 'ทดสอบ',
          lastName,
          birthDate: '1990-04-17',
          email: `e2e.bday.${Date.now().toString(36)}@example.test`,
        })
        .expect(201);

      const response = await api
        .post('/employees/birthdays')
        .send({ month: 4, day: 17 })
        .expect(201);

      expect(response.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ last_name: lastName })]),
      );
    });

    it('does not list an employee born on a different day', async () => {
      const lastName = uniqueName('คนละวัน');
      await api
        .post('/employees')
        .send({
          firstName: 'ทดสอบ',
          lastName,
          birthDate: '1988-09-03',
          email: `e2e.bday2.${Date.now().toString(36)}@example.test`,
        })
        .expect(201);

      const response = await api
        .post('/employees/birthdays')
        .send({ month: 4, day: 17 })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain(lastName);
    });

    it('rejects a birthday query with neither a date nor a month and day', async () => {
      const response = await api.post('/employees/birthdays').send({});

      expect(response.status).toBe(400);
    });

    it('rejects a birthday query whose month is out of range', async () => {
      const response = await api.post('/employees/birthdays').send({ month: 13, day: 1 });

      expect(response.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Provident fund plans
  // ═══════════════════════════════════════════════════════════════════════════
  describe('provident fund plans', () => {
    it('creates a plan and reads it back by id and in the list', async () => {
      const { id, payload } = await createPlan();

      const byId = await api.get(`/provident-funds/plans/${id}`).expect(200);
      expect(byId.body).toMatchObject({ id, code: payload.code, name: payload.name });

      const list = await api.post('/provident-funds/plans/list').send({}).expect(201);
      expect(list.body.map((plan: { id: string }) => plan.id)).toContain(id);
    });

    it('refuses a second plan with the same code', async () => {
      const { payload } = await createPlan();

      const response = await api
        .post('/provident-funds/plans')
        .send({ ...payload, name: uniqueName('แผนซ้ำ') });

      expect(response.status).toBe(400);
    });

    it('rejects a plan with no code', async () => {
      const response = await api
        .post('/provident-funds/plans')
        .send({ name: uniqueName('ไม่มีรหัส') });

      expect(response.status).toBe(400);
      // The suite's ValidationPipe reports a bare `{ message: 'Validation failed' }`
      // (support/test-app.ts), so the status code is the only thing a test can
      // assert about a rejected payload — the field name never reaches the body.
    });

    it('rejects a contribution rate above 100 per cent', async () => {
      const response = await api.post('/provident-funds/plans').send({
        code: `PVD-BAD-${Date.now().toString(36)}`,
        name: uniqueName('เกินร้อย'),
        defaultEmployeeRate: 120,
      });

      expect(response.status).toBe(400);
    });

    it('refuses a default rate outside the plan’s own band', async () => {
      const response = await api.post('/provident-funds/plans').send({
        code: `PVD-BAND-${Date.now().toString(36)}`,
        name: uniqueName('นอกช่วง'),
        minEmployeeRate: 3,
        maxEmployeeRate: 5,
        defaultEmployeeRate: 9,
      });

      expect(response.status).toBe(400);
    });

    /**
     * Defect. `updateFundPlan` (provident-funds.service.ts:206-258) fills the
     * rates the request did not send from the stored plan and then compares
     * them with `<` and `>`. Those columns are `decimal(5,2)` with no
     * transformer (provident-fund-plan.entity.ts:33-92), so the mysql driver
     * hands them back as strings and the comparison is lexicographic: a plan
     * whose default rate is `"3.00"` and whose maximum is `"15.00"` fails
     * `"3.00" > "15.00"` — true as text — so editing any field of an ordinary
     * plan is rejected with 400 "Default employee rate must be between min and
     * max employee rate".
     */
    test.failing('updates a plan and reads the new rate back', async () => {
      const { id } = await createPlan();

      await api
        .patch(`/provident-funds/plans/${id}`)
        .send({ defaultEmployeeRate: 7 })
        .expect(200);

      const response = await api.get(`/provident-funds/plans/${id}`).expect(200);
      expect(Number(response.body.defaultEmployeeRate)).toBe(7);
    });

    it('answers 404 for an unknown plan', async () => {
      const response = await api.get(
        '/provident-funds/plans/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });

    it('deletes a plan, after which it is gone', async () => {
      const { id } = await createPlan();

      await api.delete(`/provident-funds/plans/${id}`).expect(200);

      const response = await api.get(`/provident-funds/plans/${id}`);
      expect(response.status).toBe(404);
    });

    it('treats deleting an unknown plan as a no-op', async () => {
      // Deliberate design: `deleteFundPlan` returns quietly when the plan is
      // already gone, so the delete button is idempotent. Recorded here so the
      // difference from the other 404s is a decision, not an oversight.
      const response = await api.delete(
        '/provident-funds/plans/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Provident fund registrations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('provident fund registrations', () => {
    it('registers an employee and reads the registration back', async () => {
      const target = await newEmployee();
      const { id: planId } = await createPlan();

      const { id } = await registerEmployee(target.id, {
        fundPlanId: planId,
        employeeContributionRate: 4,
        companyContributionRate: 5,
      });

      const byId = await api.get(`/provident-funds/registrations/${id}`).expect(200);
      expect(byId.body).toMatchObject({ employeeId: target.id, fundPlanId: planId });
      expect(Number(byId.body.employeeContributionRate)).toBe(4);

      expect(await listRegistrationIds()).toContain(id);
    });

    it('refuses to register the same employee twice', async () => {
      const target = await newEmployee();
      await registerEmployee(target.id);

      const response = await api
        .post('/provident-funds/registrations')
        .send({ employeeId: target.id, employeeContributionRate: 3 });

      expect(response.status).toBe(400);
    });

    it('refuses a rate outside the plan’s band', async () => {
      const target = await newEmployee();
      const { id: planId } = await createPlan({
        minEmployeeRate: 2,
        maxEmployeeRate: 5,
        defaultEmployeeRate: 3,
      });

      const response = await api
        .post('/provident-funds/registrations')
        .send({ employeeId: target.id, fundPlanId: planId, employeeContributionRate: 9 });

      expect(response.status).toBe(400);
    });

    it('refuses an explicitly null fund plan', async () => {
      const target = await newEmployee();

      const response = await api
        .post('/provident-funds/registrations')
        .send({ employeeId: target.id, fundPlanId: null });

      expect(response.status).toBe(400);
    });

    it('answers 404 when registering an unknown employee', async () => {
      const response = await api
        .post('/provident-funds/registrations')
        .send({ employeeId: '00000000-0000-4000-8000-00000000dead' });

      expect(response.status).toBe(404);
    });

    it('updates the registration status', async () => {
      const target = await newEmployee();
      const { id } = await registerEmployee(target.id);

      await api
        .patch(`/provident-funds/registrations/${id}`)
        .send({ status: 'inactive' })
        .expect(200);

      const response = await api.get(`/provident-funds/registrations/${id}`).expect(200);
      expect(response.body.status).toBe('inactive');
    });

    it('rejects a status the module does not recognise', async () => {
      const target = await newEmployee();
      const { id } = await registerEmployee(target.id);

      const response = await api
        .patch(`/provident-funds/registrations/${id}`)
        .send({ status: 'พักงาน' });

      expect(response.status).toBe(400);
    });

    it('stops listing a registration once it is deleted', async () => {
      const target = await newEmployee();
      const { id } = await registerEmployee(target.id);
      expect(await listRegistrationIds()).toContain(id);

      await api.delete(`/provident-funds/registrations/${id}`).expect(200);

      expect(await listRegistrationIds()).not.toContain(id);
      const byId = await api.get(`/provident-funds/registrations/${id}`);
      expect(byId.status).toBe(404);
    });

    it('answers 404 for an unknown registration', async () => {
      const response = await api.get(
        '/provident-funds/registrations/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Provident fund records — where the arithmetic lives
  // ═══════════════════════════════════════════════════════════════════════════
  describe('provident fund records', () => {
    it('derives the contribution amount from the plan percentage of the salary', async () => {
      const target = await newEmployee();

      const response = await api
        .post('/provident-funds/records')
        .send({
          employeeId: target.id,
          month: 2,
          year: 2025,
          employeeContributionPercentage: 3,
          companyContributionPercentage: 5,
        })
        .expect(201);

      // 3% and 5% of the 30,000 baht salary the fixture was created with.
      expect(Number(response.body.employeeContributionAmount)).toBe(900);
      expect(Number(response.body.companyContributionAmount)).toBe(1500);
    });

    it('shows the salary the amount was derived from when the record is read', async () => {
      const target = await newEmployee();
      const created = await api
        .post('/provident-funds/records')
        .send({
          employeeId: target.id,
          month: 3,
          year: 2025,
          employeeContributionPercentage: 2.5,
        })
        .expect(201);

      // 2.5% of the 30,000 baht salary, computed and stored on write.
      expect(Number(created.body.employeeContributionAmount)).toBe(750);

      const response = await api
        .get(`/provident-funds/records/${created.body.id}`)
        .expect(200);

      expect(response.body.employee.id).toBe(target.id);
      expect(Number(response.body.salary.baseSalary)).toBe(BASE_SALARY);
      expect(Number(response.body.employeeContributionPercentage)).toBe(2.5);
    });

    /**
     * Defect. `formatRecordResponse` (provident-funds.service.ts:1146-1155)
     * reports the amount only in the `else if` branch that runs when no
     * percentage is stored, so a record written as a percentage answers
     * `employeeContributionAmount: null` even though the column holds the 750
     * baht the service itself calculated. The screen that lists contributions
     * can show "2.5%" but never the money, and the total has to be recomputed
     * client-side from a salary the response only sometimes carries.
     */
    test.failing('reports the stored amount of a percentage-based record', async () => {
      const target = await newEmployee();
      const created = await api
        .post('/provident-funds/records')
        .send({
          employeeId: target.id,
          month: 3,
          year: 2024,
          employeeContributionPercentage: 2.5,
        })
        .expect(201);

      const response = await api
        .get(`/provident-funds/records/${created.body.id}`)
        .expect(200);

      expect(Number(response.body.employeeContributionAmount)).toBe(750);
    });

    it('keeps an explicit amount instead of deriving one', async () => {
      const target = await newEmployee();

      const response = await api
        .post('/provident-funds/records')
        .send({
          employeeId: target.id,
          month: 4,
          year: 2025,
          employeeContributionAmount: 1234.5,
        })
        .expect(201);

      expect(Number(response.body.employeeContributionAmount)).toBe(1234.5);
    });

    it('refuses a percentage and an amount for the same contribution', async () => {
      const target = await newEmployee();

      const response = await api.post('/provident-funds/records').send({
        employeeId: target.id,
        month: 5,
        year: 2025,
        employeeContributionPercentage: 3,
        employeeContributionAmount: 900,
      });

      expect(response.status).toBe(400);
    });

    it('refuses a second record for the same employee, month and year', async () => {
      const target = await newEmployee();
      const payload = {
        employeeId: target.id,
        month: 6,
        year: 2025,
        employeeContributionPercentage: 3,
      };
      await api.post('/provident-funds/records').send(payload).expect(201);

      const response = await api.post('/provident-funds/records').send(payload);

      expect(response.status).toBe(400);
    });

    it('rejects a month outside the calendar', async () => {
      const response = await api.post('/provident-funds/records').send({
        employeeId: employee.id,
        month: 13,
        year: 2025,
        employeeContributionPercentage: 3,
      });

      expect(response.status).toBe(400);
    });

    it('answers 404 when the record names an unknown employee', async () => {
      const response = await api.post('/provident-funds/records').send({
        employeeId: '00000000-0000-4000-8000-00000000dead',
        month: 7,
        year: 2025,
        employeeContributionPercentage: 3,
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 when the record names an unknown fund plan', async () => {
      const response = await api.post('/provident-funds/records').send({
        employeeId: employee.id,
        fundPlanId: '00000000-0000-4000-8000-00000000dead',
        month: 8,
        year: 2025,
        employeeContributionPercentage: 3,
      });

      expect(response.status).toBe(404);
    });

    it('lists only the records of the employee asked for', async () => {
      const target = await newEmployee();
      const { id } = await createRecord({ employeeId: target.id, month: 9, year: 2025 });

      const response = await api
        .post('/provident-funds/records/list')
        .send({ employeeIds: [target.id], limit: 100 })
        .expect(201);

      const ids = response.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(id);
      expect(
        response.body.data.every(
          (row: { employee: { id: string } }) => row.employee.id === target.id,
        ),
      ).toBe(true);
    });

    it('updates a record and reads the new amount back', async () => {
      // Created with a fixed amount rather than a percentage: `updateRecord`
      // rejects an amount while a percentage is still stored on the record
      // ("Cannot specify both …", provident-funds.service.ts:490-497), so a
      // percentage record cannot be edited into an amount in one call.
      const { id } = await createRecord({
        employeeId: (await newEmployee()).id,
        month: 10,
        year: 2025,
        employeeContributionPercentage: undefined,
        employeeContributionAmount: 1000,
      });

      await api
        .patch(`/provident-funds/records/${id}`)
        .send({ employeeContributionAmount: 2000 })
        .expect(200);

      const response = await api.get(`/provident-funds/records/${id}`).expect(200);
      expect(Number(response.body.employeeContributionAmount)).toBe(2000);
    });

    it('deletes a record, after which it is gone', async () => {
      const { id } = await createRecord({
        employeeId: (await newEmployee()).id,
        month: 11,
        year: 2025,
      });

      await api.delete(`/provident-funds/records/${id}`).expect(200);

      const response = await api.get(`/provident-funds/records/${id}`);
      expect(response.status).toBe(404);
    });

    it('answers 404 for an unknown record', async () => {
      const response = await api.get(
        '/provident-funds/records/00000000-0000-4000-8000-00000000dead',
      );

      expect(response.status).toBe(404);
    });

    it('generates the month’s records from each employee’s registered rates', async () => {
      const target = await newEmployee();
      await registerEmployee(target.id, {
        employeeContributionRate: 4,
        companyContributionRate: 6,
      });

      const response = await api
        .post('/provident-funds/records/generate-monthly')
        .send({ month: 12, year: 2025, employeeIds: [target.id] })
        .expect(201);

      expect(response.body.summary).toMatchObject({ total: 1, created: 1 });

      const list = await api
        .post('/provident-funds/records/list')
        .send({ employeeIds: [target.id], month: 12, year: 2025 })
        .expect(201);
      expect(list.body.data[0].employeeContribution).toBe('4%');
      expect(list.body.data[0].companyContribution).toBe('6%');

      // The list formats a percentage record as a percentage and drops the
      // amount, so the money the generator stored is read back through the
      // deduction preview instead: 4% of the 30,000 baht salary.
      const deduction = await api
        .post('/provident-funds/records/sync-deduction')
        .send({ recordId: list.body.data[0].id, createDeduction: false })
        .expect(201);
      expect(Number(deduction.body.deduction.amount)).toBe(1200);
    });

    it('skips an employee who has no registration', async () => {
      const target = await newEmployee();

      const response = await api
        .post('/provident-funds/records/generate-monthly')
        .send({ month: 12, year: 2024, employeeIds: [target.id] })
        .expect(201);

      expect(response.body.summary.created).toBe(0);
      expect(response.body.summary.skipped).toBe(1);
    });

    it('reports the deduction a record would produce without writing one', async () => {
      const target = await newEmployee();
      const { id } = await createRecord({
        employeeId: target.id,
        month: 1,
        year: 2024,
        employeeContributionPercentage: 3,
      });

      const response = await api
        .post('/provident-funds/records/sync-deduction')
        .send({ recordId: id, createDeduction: false })
        .expect(201);

      // Only the employee's own 3% is deducted from the salary; the company
      // share is paid on top and must not appear here.
      expect(Number(response.body.deduction.amount)).toBe(900);
      expect(response.body.deduction.id).toBeNull();
    });

    it('answers 404 when the deduction sync names an unknown record', async () => {
      const response = await api
        .post('/provident-funds/records/sync-deduction')
        .send({ recordId: '00000000-0000-4000-8000-00000000dead' });

      expect(response.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Provident fund employee views
  // ═══════════════════════════════════════════════════════════════════════════
  describe('provident fund employee views', () => {
    it('reports the salary the contributions are calculated from', async () => {
      const target = await newEmployee();

      const response = await api
        .get(`/provident-funds/employees/${target.id}/salary`)
        .expect(200);

      expect(response.body).toMatchObject({ employeeId: target.id, currency: 'THB' });
      expect(Number(response.body.baseSalary)).toBe(BASE_SALARY);
    });

    it('answers 404 for an employee it does not know', async () => {
      const response = await api.get(
        '/provident-funds/employees/00000000-0000-4000-8000-00000000dead/salary',
      );

      expect(response.status).toBe(404);
    });

    it('answers 404 for the fund info of an employee who is not registered', async () => {
      const target = await newEmployee();

      const response = await api.get(`/provident-funds/employees/${target.id}/info`);

      expect(response.status).toBe(404);
    });

    it('returns the fund info of a registered employee, with the current salary', async () => {
      const target = await newEmployee();
      await registerEmployee(target.id, { employeeContributionRate: 3 });

      const response = await api
        .get(`/provident-funds/employees/${target.id}/info`)
        .expect(200);

      expect(Number(response.body.currentSalary)).toBe(BASE_SALARY);
    });

    it('finds an unregistered employee through the registration search', async () => {
      const lastName = uniqueName('ค้นหากองทุน');
      const target = await createEmployee(api, {
        departmentId,
        salary: BASE_SALARY,
        lastName,
      });

      const response = await api
        .post('/provident-funds/employees/search')
        .send({ search: lastName, limit: 50 })
        .expect(201);

      expect(JSON.stringify(response.body)).toContain(target.id);
    });

    it('excludes an employee who is already registered when asked to', async () => {
      const lastName = uniqueName('ลงทะเบียนแล้ว');
      const target = await createEmployee(api, {
        departmentId,
        salary: BASE_SALARY,
        lastName,
      });
      await registerEmployee(target.id);

      const response = await api
        .post('/provident-funds/employees/search')
        .send({ search: lastName, excludeRegistered: true, limit: 50 })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain(target.id);
    });

    it('finds a registered employee through the registered-employee search', async () => {
      const lastName = uniqueName('สมาชิกกองทุน');
      const target = await createEmployee(api, {
        departmentId,
        salary: BASE_SALARY,
        lastName,
      });
      await registerEmployee(target.id);

      const response = await api
        .post('/provident-funds/registered-employees/search')
        .send({ search: lastName, limit: 50 })
        .expect(201);

      expect(JSON.stringify(response.body)).toContain(target.id);
    });

    it('summarises the fund on the dashboard', async () => {
      const target = await newEmployee();
      await registerEmployee(target.id);
      await createRecord({ employeeId: target.id, month: 2, year: 2024 });

      const response = await api
        .post('/provident-funds/dashboard')
        .send({ year: 2024 })
        .expect(201);

      expect(response.body).toEqual(expect.any(Object));
      expect(JSON.stringify(response.body)).toContain('monthlyStats');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tenant scoping
  // ═══════════════════════════════════════════════════════════════════════════
  describe('tenant scoping', () => {
    /**
     * A neighbouring tenant, numeric and derived from this worker's own id so
     * parallel workers cannot collide. Numeric matters: eight tenant-scoped
     * tables store `tenant_id` as an integer, where a UUID collapses to 0 and
     * every UUID tenant would share one set of rows.
     */
    const neighbourTenantId = `${loadTestEnv().tenantId}98`;
    let neighbour: ApiClient;

    beforeAll(async () => {
      neighbour = await apiClient(await hrUserFor(neighbourTenantId));
    });

    afterAll(async () => {
      await purgeTenantData(neighbourTenantId);
    });

    it('hides an employee’s educations from another tenant', async () => {
      const institution = uniqueName('สถาบันเฉพาะบริษัท');
      await api
        .patch(`/employees/educations/${employee.id}`)
        .send({ added: [{ educationLevel: 'ปริญญาโท', institution }] })
        .expect(200);

      const response = await neighbour.get(`/employees/educations/${employee.id}`);

      expect(response.status).toBe(404);
    });

    it('hides an employee’s payroll details from another tenant', async () => {
      const response = await neighbour.get(`/employees/payroll-details/${employee.id}`);

      expect(response.status).toBe(404);
    });

    it('refuses to let another tenant write an employee’s employment details', async () => {
      const response = await neighbour
        .patch(`/employees/${employee.id}/employment`)
        .send({ employeeLevel: 'ข้ามบริษัท' });

      expect(response.status).toBe(404);
    });

    it('does not report another tenant’s email as a duplicate', async () => {
      const response = await neighbour
        .post('/employees/check-duplicate')
        .send({ email: employee.email })
        .expect(201);

      expect(response.body.emailExists).toBe(false);
    });

    it('hides a fund plan from another tenant', async () => {
      const { id } = await createPlan();

      const byId = await neighbour.get(`/provident-funds/plans/${id}`);
      expect(byId.status).toBe(404);

      const list = await neighbour.post('/provident-funds/plans/list').send({}).expect(201);
      expect(list.body.map((plan: { id: string }) => plan.id)).not.toContain(id);
    });

    it('hides a registration from another tenant', async () => {
      const target = await newEmployee();
      const { id } = await registerEmployee(target.id);

      const byId = await neighbour.get(`/provident-funds/registrations/${id}`);
      expect(byId.status).toBe(404);

      const list = await neighbour
        .post('/provident-funds/registrations/list')
        .send({ limit: 200 })
        .expect(201);
      expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(id);
    });

    it('hides a fund record from another tenant', async () => {
      const target = await newEmployee();
      const { id } = await createRecord({ employeeId: target.id, month: 3, year: 2024 });

      const byId = await neighbour.get(`/provident-funds/records/${id}`);
      expect(byId.status).toBe(404);

      const list = await neighbour
        .post('/provident-funds/records/list')
        .send({ limit: 200 })
        .expect(201);
      expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(id);
    });

    /**
     * Defect. `EmployeesController.getEmploymentInfo` calls
     * `employeesService.getEmploymentInfoByEmployeeId(employeeId)` without the
     * tenant (employees.controller.ts), and the service query is
     * `where('employee.id = :id')` with no tenant predicate
     * (employees.service.ts). Any authenticated HR user of any tenant can read
     * another company's employment record — department, position, start and end
     * dates, social security date and resignation reason — from the employee id
     * alone.
     */
    test.failing('hides an employee’s employment info from another tenant', async () => {
      const response = await neighbour.get(`/employees/${employee.id}/employment-info`);

      expect(response.status).toBe(404);
    });

    /**
     * Defect. `GET /employees/dashboard` has no guard at all and takes its
     * tenants from a query parameter, so an anonymous caller who knows a tenant
     * id gets that company's headcount, gender split, age distribution and
     * per-department breakdown.
     */
    test.failing('requires credentials to read another tenant’s dashboard', async () => {
      const response = await api
        .anonymous()
        .get('/employees/dashboard')
        .query({ tenantIds: neighbourTenantId });

      expect(response.status).toBe(401);
    });
  });
});
