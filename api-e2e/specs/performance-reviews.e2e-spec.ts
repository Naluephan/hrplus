/**
 * Performance reviews: the KPI module and the 360-feedback module.
 *
 * Both modules end in the same place — a score that a manager enters from
 * outside the HR application, through a link that carries its own token — so
 * they are tested together and the public link flows get the most attention.
 *
 * Four things shape the suite:
 *
 *   1. A KPI assignment only becomes evaluable once its *setup* has been
 *      released. `POST /kpi/setups/:id/release` both moves every pending
 *      assignment of the setup to `reviewing` and mints the evaluator link, so
 *      nearly every scenario is "cycle, template, setup, assignment, release".
 *   2. A KPI setup is unique per cycle (`UQ_kpi_evaluation_setups_tenant_cycle`)
 *      and an assignment is unique per (cycle, employee). Every scenario that
 *      needs its own assignment therefore builds its own cycle and its own
 *      employee — `scenario()` below does exactly that.
 *   3. Employees are created one at a time: concurrent creates collide on the
 *      generated account-access username (see docs/API_TESTING.md).
 *   4. `KpiEvaluationLinkService.createTenantEvaluationLink` revokes *every*
 *      non-revoked link of the tenant, not just the tenant-wide ones. The
 *      tests that call it are grouped at the end so they cannot pull the token
 *      out from under an earlier test.
 *
 * Several routes the product's own screens imply do not exist on the server at
 * all (`GET`/`DELETE /kpi/templates/:id`, `PATCH /360/evaluations/:id`). They
 * are asserted as 404 with a comment rather than quietly skipped, so the suite
 * records the gap instead of hiding it.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser, hrUserFor } from '../support/auth';
import {
  ensureTestTenant,
  purgeTenantData,
  purgeTestTenantData,
  uniqueName,
} from '../support/db';
import { loadTestEnv } from '../support/env';
import { createDepartment, createEmployee, type EmployeeFixture } from '../support/factories';

/** An id that is a well-formed UUID but belongs to nothing. */
const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

describe('Performance reviews — KPI and 360 (e2e)', () => {
  let api: ApiClient;
  /** Anonymous caller — the public evaluation-link routes carry no credentials. */
  let publicApi: ApiClient;
  let departmentId: string;
  /**
   * The evaluator for every KPI setup. A setup selection is only accepted when
   * the evaluator belongs to the selected department, so the manager and the
   * evaluated employees all live in `departmentId`.
   */
  let manager: EmployeeFixture;
  /**
   * The logged-in HR admin's own employee id, read out of its access token.
   * The 360 link routes identify the caller from the token alone, so this is
   * the only employee whose Authorization header the suite can produce.
   */
  let hrEmployeeId: string;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
    publicApi = api.anonymous();

    hrEmployeeId = employeeIdOf((await hrUser()).token!);

    const department = await createDepartment(api);
    departmentId = department.id;
    manager = await createEmployee(api, { departmentId });
  });

  afterAll(purgeTestTenantData);

  // ─── local fixtures ────────────────────────────────────────────────────────
  // They live here rather than in support/factories because no other suite
  // needs them, and support/factories is being edited by other work.

  /** The `sub` claim of an HR access token is the employee id. */
  function employeeIdOf(accessToken: string): string {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'),
    );
    return String(payload.sub);
  }

  /** Fails loudly with the server's own body: one bad fixture, one failure. */
  function expectOk(response: { status: number; body: unknown }, what: string) {
    if (response.status >= 300) {
      throw new Error(
        `Could not create ${what} (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return response.body as any;
  }

  const createCycle = async (overrides: Record<string, unknown> = {}) =>
    expectOk(
      await api.post('/kpi/cycles').send({
        name: uniqueName('รอบประเมิน'),
        periodType: 'quarterly',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        ...overrides,
      }),
      'a KPI cycle',
    );

  /**
   * Two items weighted 60/40 and no target value, so a score entered against
   * an item is used verbatim and the weighted roll-up is easy to predict.
   */
  const createTemplate = async (cycleId: string, overrides: Record<string, unknown> = {}) =>
    expectOk(
      await api.post('/kpi/templates').send({
        cycleId,
        name: uniqueName('แบบประเมิน KPI'),
        items: [
          { title: 'ยอดขาย', weight: 60 },
          { title: 'คุณภาพงาน', weight: 40 },
        ],
        ...overrides,
      }),
      'a KPI template',
    );

  const createSetup = async (cycleId: string, evaluatorEmployeeId = manager.id) =>
    expectOk(
      await api.post('/kpi/setups').send({
        cycleId,
        evaluatorSelections: [{ evaluatorEmployeeId, departmentId }],
      }),
      'a KPI evaluation setup',
    );

  const createAssignment = async (
    setupId: string,
    cycleId: string,
    templateId: string,
    employeeId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    expectOk(
      await api
        .post('/kpi/assignments')
        .send({ setupId, cycleId, templateId, employeeId, managerId: manager.id, ...overrides }),
      'a KPI assignment',
    );

  interface KpiScenario {
    cycleId: string;
    templateId: string;
    setupId: string;
    employee: EmployeeFixture;
    assignmentId: string;
    /** Assignment item ids, in template order (weight 60 first, then 40). */
    itemIds: string[];
  }

  /**
   * A complete, isolated KPI scenario: its own cycle (one setup per cycle),
   * its own employee (one assignment per employee and cycle) and an assignment
   * still in `pending`.
   */
  async function scenario(): Promise<KpiScenario> {
    const cycle = await createCycle();
    const template = await createTemplate(cycle.id);
    const setup = await createSetup(cycle.id);
    const employee = await createEmployee(api, { departmentId });
    const assignment = await createAssignment(setup.id, cycle.id, template.id, employee.id);

    return {
      cycleId: cycle.id,
      templateId: template.id,
      setupId: setup.id,
      employee,
      assignmentId: assignment.id,
      itemIds: assignment.items.map((item: { id: string }) => item.id),
    };
  }

  /** Releases the setup and returns the raw evaluator token it mints. */
  async function release(setupId: string, body: Record<string, unknown> = {}): Promise<string> {
    const response = expectOk(
      await api.post(`/kpi/setups/${setupId}/release`).send(body),
      'a KPI setup release',
    );
    return response.link.token as string;
  }

  const readAssignment = async (id: string) =>
    (await api.get(`/kpi/assignments/${id}`).expect(200)).body;

  // ─── 360 fixtures ──────────────────────────────────────────────────────────

  /**
   * One competency carrying the whole weight — the service rejects anything
   * whose competency weights do not total exactly 100.
   */
  const feedbackTemplate = (overrides: Record<string, unknown> = {}) => ({
    name: uniqueName('แบบ 360'),
    year: 2026,
    competencies: [
      {
        name: 'การทำงานเป็นทีม',
        weight: 100,
        questions: [
          { question: 'ให้ความร่วมมือกับเพื่อนร่วมงาน', weight: 1, scaleMin: 1, scaleMax: 5 },
          { question: 'สื่อสารได้ชัดเจน', weight: 1, scaleMin: 1, scaleMax: 5 },
        ],
      },
    ],
    ...overrides,
  });

  const create360Template = async (overrides: Record<string, unknown> = {}) =>
    expectOk(await api.post('/360/templates').send(feedbackTemplate(overrides)), 'a 360 template');

  const assign360 = async (body: Record<string, unknown>) =>
    expectOk(await api.post('/360/evaluations/assign').send(body), 'a 360 assignment');

  const read360 = async (id: string) =>
    (await api.get(`/360/evaluations/${id}`).expect(200)).body;

  /** The question ids of an evaluation, in template order. */
  const questionIdsOf = (evaluation: any): string[] =>
    evaluation.template.competencies.flatMap((competency: any) =>
      competency.questions.map((question: any) => question.id),
    );

  const evaluatorOf = (evaluation: any, type: string) =>
    evaluation.evaluators.find((evaluator: any) => evaluator.type === type);

  // ═══════════════════════════════════════════════════════════════════════════
  // KPI
  // ═══════════════════════════════════════════════════════════════════════════

  describe('KPI cycles', () => {
    it('creates a cycle and derives its code from the name', async () => {
      const cycle = await createCycle({ name: 'Q1 Review 2026' });

      expect(cycle.id).toBeDefined();
      // resolveCycleCode uppercases the name and prefixes CYCLE- when no code
      // is supplied, which is what the cycle dropdown shows.
      expect(cycle.code).toBe('CYCLE-Q1-REVIEW-2026');
      expect(cycle.periodType).toBe('quarterly');
    });

    it('lists the cycle it just created', async () => {
      const cycle = await createCycle();

      const response = await api.get('/kpi/cycles').expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).toContain(cycle.id);
    });

    it('updates a cycle in place', async () => {
      const cycle = await createCycle();
      const renamed = uniqueName('รอบประเมินแก้ไข');

      const response = await api
        .put(`/kpi/cycles/${cycle.id}`)
        .send({
          name: renamed,
          periodType: 'yearly',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(200);

      expect(response.body).toMatchObject({ id: cycle.id, name: renamed, periodType: 'yearly' });
    });

    it('refuses a cycle whose start date is after its end date', async () => {
      const response = await api.post('/kpi/cycles').send({
        name: uniqueName('รอบกลับด้าน'),
        periodType: 'quarterly',
        startDate: '2026-06-30',
        endDate: '2026-01-01',
      });

      expect(response.status).toBe(400);
    });

    it('refuses a cycle with an unknown period type', async () => {
      const response = await api.post('/kpi/cycles').send({
        name: uniqueName('รอบผิดประเภท'),
        periodType: 'fortnightly',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      });

      expect(response.status).toBe(400);
    });

    it('answers 404 when updating a cycle that does not exist', async () => {
      const response = await api.put(`/kpi/cycles/${MISSING_ID}`).send({
        name: uniqueName('ไม่มีอยู่จริง'),
        periodType: 'quarterly',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      });

      expect(response.status).toBe(404);
    });

    it('requires credentials', async () => {
      // The control group for the whole suite: KpiController sits behind
      // HrJwtAuthGuard, unlike the evaluation-link controller below.
      await publicApi.get('/kpi/cycles').expect(401);
    });
  });

  describe('KPI templates', () => {
    it('creates a template with its items and totals their weight', async () => {
      const cycle = await createCycle();

      const template = await createTemplate(cycle.id);

      expect(Number(template.totalWeight)).toBe(100);
      expect(template.items.map((item: { title: string }) => item.title)).toEqual([
        'ยอดขาย',
        'คุณภาพงาน',
      ]);
    });

    it('replaces the items on update rather than appending to them', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id);

      const response = await api
        .put(`/kpi/templates/${template.id}`)
        .send({
          cycleId: cycle.id,
          name: template.name,
          items: [{ title: 'ตัวชี้วัดใหม่', weight: 100 }],
        })
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].title).toBe('ตัวชี้วัดใหม่');
      expect(Number(response.body.totalWeight)).toBe(100);
    });

    it('lists the template with its cycle attached', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id);

      const response = await api.get('/kpi/templates').expect(200);

      const listed = response.body.find((row: { id: string }) => row.id === template.id);
      expect(listed).toBeDefined();
      expect(listed.cycle.id).toBe(cycle.id);
    });

    it('refuses a template whose weights exceed 100', async () => {
      const cycle = await createCycle();

      const response = await api.post('/kpi/templates').send({
        cycleId: cycle.id,
        name: uniqueName('น้ำหนักเกิน'),
        items: [
          // Item titles are Length(2, 200): a one-character title is a 400 on
          // its own and would hide whatever the test is really asking about.
          { title: 'ยอดขาย', weight: 70 },
          { title: 'คุณภาพงาน', weight: 70 },
        ],
      });

      expect(response.status).toBe(400);
    });

    it('refuses a template with no items', async () => {
      const cycle = await createCycle();

      const response = await api
        .post('/kpi/templates')
        .send({ cycleId: cycle.id, name: uniqueName('ไม่มีรายการ'), items: [] });

      expect(response.status).toBe(400);
    });

    it('refuses a template whose cycle does not exist', async () => {
      const response = await api.post('/kpi/templates').send({
        cycleId: MISSING_ID,
        name: uniqueName('ไม่มีรอบ'),
        // Length(2, 200) on the item title, so this has to be a real title:
        // a shorter one is a 400 from the ValidationPipe and the cycle lookup
        // under test never runs.
        items: [{ title: 'ยอดขาย', weight: 100 }],
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 when updating a template that does not exist', async () => {
      const cycle = await createCycle();

      const response = await api.put(`/kpi/templates/${MISSING_ID}`).send({
        cycleId: cycle.id,
        name: uniqueName('ไม่มีอยู่จริง'),
        // As above: the payload has to be valid for the 404 to be the answer
        // under test rather than a 400 on the item title.
        items: [{ title: 'ยอดขาย', weight: 100 }],
      });

      expect(response.status).toBe(404);
    });

    it('has no read-one route: GET /kpi/templates/:id is not served', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id);

      // KpiController declares GET /kpi/templates (list), POST and PUT /:id —
      // there is no GET /:id, so the only way to read one template is to fetch
      // the whole list. Recorded rather than skipped.
      const response = await api.get(`/kpi/templates/${template.id}`);

      expect(response.status).toBe(404);
    });

    it('has no delete route: a template is only removed with its setup', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id);

      // DELETE /kpi/templates/:id does not exist either. Templates are cleaned
      // up as a side effect of DELETE /kpi/setups/:id, which removes the ones
      // left with no assignments — asserted in the setup block below.
      const response = await api.delete(`/kpi/templates/${template.id}`);

      expect(response.status).toBe(404);
    });
  });

  describe('KPI evaluator scopes', () => {
    it('creates a scope and returns the refreshed list', async () => {
      const evaluator = await createEmployee(api, { departmentId });

      const response = await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: evaluator.id, departmentId })
        .expect(201);

      const created = response.body.find(
        (row: { evaluatorEmployeeId: string }) => row.evaluatorEmployeeId === evaluator.id,
      );
      expect(created).toBeDefined();
      expect(created.canEvaluate).toBe(true);
      expect(created.department.id).toBe(departmentId);
    });

    it('refuses a second scope for the same evaluator and department', async () => {
      const evaluator = await createEmployee(api, { departmentId });
      await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: evaluator.id, departmentId })
        .expect(201);

      const response = await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: evaluator.id, departmentId });

      expect(response.status).toBe(400);
    });

    it('moves a scope to another department on update', async () => {
      const evaluator = await createEmployee(api, { departmentId });
      const other = await createDepartment(api);
      const created = await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: evaluator.id, departmentId })
        .expect(201);
      const scopeId = created.body.find(
        (row: { evaluatorEmployeeId: string }) => row.evaluatorEmployeeId === evaluator.id,
      ).id;

      const response = await api
        .put(`/kpi/evaluator-scopes/${scopeId}`)
        .send({ evaluatorEmployeeId: evaluator.id, departmentId: other.id, canEvaluate: false })
        .expect(200);

      const updated = response.body.find((row: { id: string }) => row.id === scopeId);
      expect(updated.departmentId).toBe(other.id);
      expect(updated.canEvaluate).toBe(false);
    });

    it('deletes a scope through its POST /:id/delete route', async () => {
      const evaluator = await createEmployee(api, { departmentId });
      const created = await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: evaluator.id, departmentId })
        .expect(201);
      const scopeId = created.body.find(
        (row: { evaluatorEmployeeId: string }) => row.evaluatorEmployeeId === evaluator.id,
      ).id;

      await api.post(`/kpi/evaluator-scopes/${scopeId}/delete`).expect(201);

      const list = await api.get('/kpi/evaluator-scopes').expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).not.toContain(scopeId);
    });

    it('refuses a scope for an employee of no tenant', async () => {
      const response = await api
        .post('/kpi/evaluator-scopes')
        .send({ evaluatorEmployeeId: MISSING_ID, departmentId });

      expect(response.status).toBe(404);
    });

    it('answers 404 when deleting a scope that does not exist', async () => {
      const response = await api.post(`/kpi/evaluator-scopes/${MISSING_ID}/delete`);

      expect(response.status).toBe(404);
    });

    it('lists the candidates of a department', async () => {
      const employee = await createEmployee(api, { departmentId });

      const response = await api
        .get('/kpi/evaluator-candidates')
        .query({ departmentId })
        .expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).toContain(employee.id);
    });

    it('answers with an empty list when no department is given', async () => {
      // listEvaluatorCandidates returns [] rather than the whole tenant when
      // departmentId is missing — the picker is department-first by design.
      const response = await api.get('/kpi/evaluator-candidates').expect(200);

      expect(response.body).toEqual([]);
    });

    it('answers 404 for the candidates of a department that does not exist', async () => {
      const response = await api
        .get('/kpi/evaluator-candidates')
        .query({ departmentId: MISSING_ID });

      expect(response.status).toBe(404);
    });
  });

  describe('KPI evaluation setups', () => {
    it('creates a setup in draft with its evaluator selections', async () => {
      const cycle = await createCycle();

      const setup = await createSetup(cycle.id);

      expect(setup.status).toBe('draft');
      expect(setup.workflowStatus).toBe('pending');
      expect(setup.evaluators).toHaveLength(1);
      expect(setup.evaluators[0].evaluatorEmployeeId).toBe(manager.id);
    });

    it('upserts rather than duplicating when a cycle already has a setup', async () => {
      const cycle = await createCycle();
      const first = await createSetup(cycle.id);
      const second = await createEmployee(api, { departmentId });

      // The table carries UQ_kpi_evaluation_setups_tenant_cycle, and
      // createEvaluationSetup answers a repeat POST by updating the existing
      // row instead of failing — the setup screen saves with POST every time.
      const response = await api
        .post('/kpi/setups')
        .send({
          cycleId: cycle.id,
          evaluatorSelections: [{ evaluatorEmployeeId: second.id, departmentId }],
        })
        .expect(201);

      expect(response.body.id).toBe(first.id);
      expect(response.body.evaluators).toHaveLength(1);
      expect(response.body.evaluators[0].evaluatorEmployeeId).toBe(second.id);
    });

    it('reads a setup back by id', async () => {
      const cycle = await createCycle();
      const setup = await createSetup(cycle.id);

      const response = await api.get(`/kpi/setups/${setup.id}`).expect(200);

      expect(response.body.id).toBe(setup.id);
      expect(response.body.cycle.id).toBe(cycle.id);
    });

    it('lists the setup with its assignment summary', async () => {
      const built = await scenario();

      const response = await api.get('/kpi/setups').expect(200);

      const listed = response.body.find((row: { id: string }) => row.id === built.setupId);
      expect(listed.totalAssignments).toBe(1);
      expect(listed.workflowStatus).toBe('pending');
    });

    it('refuses an evaluator who does not belong to the selected department', async () => {
      const cycle = await createCycle();
      const other = await createDepartment(api);
      const outsider = await createEmployee(api, { departmentId: other.id });

      const response = await api.post('/kpi/setups').send({
        cycleId: cycle.id,
        evaluatorSelections: [{ evaluatorEmployeeId: outsider.id, departmentId }],
      });

      expect(response.status).toBe(400);
    });

    it('refuses a setup with no evaluator selections', async () => {
      const cycle = await createCycle();

      const response = await api
        .post('/kpi/setups')
        .send({ cycleId: cycle.id, evaluatorSelections: [] });

      expect(response.status).toBe(400);
    });

    it('refuses a setup whose cycle does not exist', async () => {
      const response = await api.post('/kpi/setups').send({
        cycleId: MISSING_ID,
        evaluatorSelections: [{ evaluatorEmployeeId: manager.id, departmentId }],
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 when reading a setup that does not exist', async () => {
      const response = await api.get(`/kpi/setups/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('releases the setup, moves its assignments to reviewing and mints a link', async () => {
      const built = await scenario();

      const response = await api.post(`/kpi/setups/${built.setupId}/release`).send({}).expect(201);

      expect(response.body.setup.status).toBe('review');
      expect(response.body.setup.workflowStatus).toBe('reviewing');
      expect(response.body.link.token).toEqual(expect.any(String));
      expect(response.body.link.linkPath).toBe(`/kpi/evaluate/${response.body.link.token}`);
      // Releasing is what makes the assignment evaluable: it was pending a
      // moment ago, and nobody touched the assignment itself.
      expect((await readAssignment(built.assignmentId)).workflowStatus).toBe('reviewing');
    });

    it('answers 404 when releasing a setup that does not exist', async () => {
      const response = await api.post(`/kpi/setups/${MISSING_ID}/release`).send({});

      expect(response.status).toBe(404);
    });

    it('refuses a release link whose expiry is in the past', async () => {
      const built = await scenario();

      const response = await api
        .post(`/kpi/setups/${built.setupId}/release`)
        .send({ expiresAt: '2020-01-01T00:00:00.000Z' });

      expect(response.status).toBe(400);
    });

    it('brings returned assignments back to reviewing on submit-revision', async () => {
      const built = await scenario();
      await release(built.setupId);
      await api
        .post(`/kpi/assignments/${built.assignmentId}/return-to-hr`)
        .send({ reason: 'ตัวเลขไม่ตรง' })
        .expect(201);
      expect((await readAssignment(built.assignmentId)).workflowStatus).toBe('awaiting_revision');

      const response = await api.post(`/kpi/setups/${built.setupId}/submit-revision`).expect(201);

      expect(response.body.workflowStatus).toBe('reviewing');
      expect((await readAssignment(built.assignmentId)).workflowStatus).toBe('reviewing');
    });

    it('deletes a setup together with its assignments and orphaned templates', async () => {
      const built = await scenario();

      const response = await api.delete(`/kpi/setups/${built.setupId}`).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        deletedAssignmentCount: 1,
        // The template had no assignment left, so it goes with the setup —
        // this is the only delete path a KPI template has.
        deletedTemplateCount: 1,
      });
      await api.get(`/kpi/assignments/${built.assignmentId}`).expect(404);
      const templates = await api.get('/kpi/templates').expect(200);
      expect(templates.body.map((row: { id: string }) => row.id)).not.toContain(built.templateId);
    });

    it('refuses to delete a setup whose assignments are already evaluated', async () => {
      const built = await scenario();
      await release(built.setupId);
      await api.post(`/kpi/assignments/${built.assignmentId}/approve`).expect(201);

      const response = await api.delete(`/kpi/setups/${built.setupId}`);

      expect(response.status).toBe(400);
      await api.get(`/kpi/setups/${built.setupId}`).expect(200);
    });

    it('answers 404 when deleting a setup that does not exist', async () => {
      const response = await api.delete(`/kpi/setups/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });
  });

  describe('KPI assignments', () => {
    it('copies the template items onto the assignment', async () => {
      const built = await scenario();

      const assignment = await readAssignment(built.assignmentId);

      expect(assignment.workflowStatus).toBe('pending');
      expect(assignment.items).toHaveLength(2);
      expect(assignment.items.map((item: { weight: string }) => Number(item.weight))).toEqual([
        60, 40,
      ]);
      expect(assignment.employeeName).toContain(built.employee.firstName);
    });

    it('adds custom items alongside the template ones', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id, {
        items: [{ title: 'ยอดขาย', weight: 60 }],
      });
      const setup = await createSetup(cycle.id);
      const employee = await createEmployee(api, { departmentId });

      const assignment = await createAssignment(setup.id, cycle.id, template.id, employee.id, {
        customItems: [{ title: 'งานพิเศษ', weight: 40 }],
      });

      expect(assignment.items).toHaveLength(2);
      expect(assignment.items[1]).toMatchObject({ title: 'งานพิเศษ', templateItemId: null });
    });

    it('filters the list by cycle and by employee', async () => {
      const built = await scenario();

      const byCycle = await api
        .get('/kpi/assignments')
        .query({ cycleId: built.cycleId })
        .expect(200);
      const byEmployee = await api
        .get('/kpi/assignments')
        .query({ employeeId: built.employee.id })
        .expect(200);

      expect(byCycle.body.map((row: { id: string }) => row.id)).toEqual([built.assignmentId]);
      expect(byEmployee.body.map((row: { id: string }) => row.id)).toEqual([built.assignmentId]);
    });

    it('saves scores through /results and reads them back weighted', async () => {
      const built = await scenario();
      await release(built.setupId);

      const saved = await api
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({
          comment: 'ทำได้ดี',
          items: [
            { id: built.itemIds[0], managerScore: 90 },
            { id: built.itemIds[1], managerScore: 80 },
          ],
        })
        .expect(200);

      // No target value on the items, so the manager's score is the item score
      // and the roll-up is the weighted mean: (90*60 + 80*40) / 100 = 86 → A.
      expect(Number(saved.body.overallScore)).toBe(86);
      expect(saved.body.grade).toBe('A');

      const reread = await readAssignment(built.assignmentId);
      expect(Number(reread.items[0].managerScore)).toBe(90);
      expect(Number(reread.items[1].managerScore)).toBe(80);
      expect(Number(reread.overallScore)).toBe(86);
      expect(reread.comment).toBe('ทำได้ดี');
    });

    it('scores an item against its target value when one is set', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id, {
        items: [{ title: 'ยอดขาย', weight: 100, targetValue: 200 }],
      });
      const setup = await createSetup(cycle.id);
      const employee = await createEmployee(api, { departmentId });
      const assignment = await createAssignment(setup.id, cycle.id, template.id, employee.id);

      const saved = await api
        .put(`/kpi/assignments/${assignment.id}/results`)
        .send({ items: [{ id: assignment.items[0].id, actualValue: 150 }] })
        .expect(200);

      // 150 of a 200 target is 75% — resolveItemScore normalises against the
      // target and clamps the result to 0..100.
      expect(Number(saved.body.overallScore)).toBe(75);
      expect(saved.body.grade).toBe('B');
    });

    it('refuses a second assignment for the same employee and cycle', async () => {
      const built = await scenario();

      const response = await api.post('/kpi/assignments').send({
        setupId: built.setupId,
        cycleId: built.cycleId,
        templateId: built.templateId,
        employeeId: built.employee.id,
        managerId: manager.id,
      });

      expect(response.status).toBe(400);
    });

    it('refuses an assignment with no setup', async () => {
      const cycle = await createCycle();
      const template = await createTemplate(cycle.id);
      const employee = await createEmployee(api, { departmentId });

      const response = await api.post('/kpi/assignments').send({
        cycleId: cycle.id,
        templateId: template.id,
        employeeId: employee.id,
        managerId: manager.id,
      });

      expect(response.status).toBe(400);
    });

    it('refuses an assignment whose manager is not an evaluator of the setup', async () => {
      const built = await scenario();
      const employee = await createEmployee(api, { departmentId });
      const stranger = await createEmployee(api, { departmentId });

      const response = await api.post('/kpi/assignments').send({
        setupId: built.setupId,
        cycleId: built.cycleId,
        templateId: built.templateId,
        employeeId: employee.id,
        managerId: stranger.id,
      });

      // ensureSetupEvaluatorOrThrow — only the evaluators chosen on the setup
      // may be named as the manager of one of its assignments.
      expect(response.status).toBe(403);
    });

    it('refuses an assignment whose cycle does not match the setup', async () => {
      const built = await scenario();
      const otherCycle = await createCycle();
      const employee = await createEmployee(api, { departmentId });

      const response = await api.post('/kpi/assignments').send({
        setupId: built.setupId,
        cycleId: otherCycle.id,
        templateId: built.templateId,
        employeeId: employee.id,
        managerId: manager.id,
      });

      expect(response.status).toBe(400);
    });

    it('refuses an assignment for an employee of no tenant', async () => {
      const built = await scenario();

      const response = await api.post('/kpi/assignments').send({
        setupId: built.setupId,
        cycleId: built.cycleId,
        templateId: built.templateId,
        employeeId: MISSING_ID,
        managerId: manager.id,
      });

      expect(response.status).toBe(404);
    });

    it('refuses a results payload with no items', async () => {
      const built = await scenario();

      const response = await api
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({ items: [] });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a result item that belongs to another assignment', async () => {
      const built = await scenario();
      const other = await scenario();

      const response = await api
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({ items: [{ id: other.itemIds[0], managerScore: 50 }] });

      expect(response.status).toBe(404);
    });

    it('refuses to edit the results of an evaluated assignment', async () => {
      const built = await scenario();
      await release(built.setupId);
      await api.post(`/kpi/assignments/${built.assignmentId}/approve`).expect(201);

      const response = await api
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({ items: [{ id: built.itemIds[0], managerScore: 10 }] });

      expect(response.status).toBe(400);
    });

    it('refuses an illegal workflow transition', async () => {
      const built = await scenario();

      // pending may only move to reviewing; approving straight away is refused.
      const response = await api.post(`/kpi/assignments/${built.assignmentId}/approve`);

      expect(response.status).toBe(400);
    });

    it('answers 404 when reading an assignment that does not exist', async () => {
      const response = await api.get(`/kpi/assignments/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('deletes an assignment', async () => {
      const built = await scenario();

      await api.delete(`/kpi/assignments/${built.assignmentId}`).expect(200);

      await api.get(`/kpi/assignments/${built.assignmentId}`).expect(404);
    });

    it('answers 404 when deleting an assignment that does not exist', async () => {
      const response = await api.delete(`/kpi/assignments/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });
  });

  describe('KPI dashboard and lookups', () => {
    it('rolls a saved score up into the dashboard', async () => {
      const built = await scenario();
      await release(built.setupId);
      await api
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({
          items: [
            { id: built.itemIds[0], managerScore: 90 },
            { id: built.itemIds[1], managerScore: 80 },
          ],
        })
        .expect(200);

      const response = await api.get('/kpi/dashboard').expect(200);

      const recent = response.body.recentAssignments.find(
        (row: { id: string }) => row.id === built.assignmentId,
      );
      expect(recent).toBeDefined();
      expect(Number(recent.overallScore)).toBe(86);
      expect(recent.grade).toBe('A');
      expect(response.body.summary.assignments).toBeGreaterThan(0);
      expect(response.body.distribution.A).toBeGreaterThan(0);
      expect(response.body.byStatus.map((row: { status: string }) => row.status)).toEqual([
        'pending',
        'awaiting_revision',
        'revising',
        'reviewing',
        'evaluated',
      ]);
    });

    it('offers the cycles, templates, departments and employees the forms need', async () => {
      const built = await scenario();

      const response = await api.get('/kpi/lookups').expect(200);

      expect(response.body.cycles.map((row: { id: string }) => row.id)).toContain(built.cycleId);
      expect(response.body.templates.map((row: { id: string }) => row.id)).toContain(
        built.templateId,
      );
      expect(response.body.departments.map((row: { id: string }) => row.id)).toContain(
        departmentId,
      );
      expect(response.body.employees.map((row: { id: string }) => row.id)).toContain(
        built.employee.id,
      );
    });
  });

  // ─── the public KPI evaluation link ────────────────────────────────────────
  // KpiEvaluationLinkController carries no guard at all: every route below is
  // reachable by anyone holding the token. That is the point of the link, and
  // also why these are the highest-risk routes in the module.

  describe('KPI evaluation links', () => {
    it('describes the link to an anonymous holder of the token', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await publicApi.get(`/kpi/evaluation-links/${token}`).expect(200);

      expect(response.body.tenantId).toBe(loadTestEnv().tenantId);
      expect(response.body.cycle.id).toBe(built.cycleId);
      expect(response.body.setupStatus).toBe('review');
    });

    it('returns the assignment of its own setup', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await publicApi
        .get(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}`)
        .expect(200);

      expect(response.body.id).toBe(built.assignmentId);
      expect(response.body.items).toHaveLength(2);
    });

    it('refuses to show an assignment that belongs to another setup', async () => {
      const mine = await scenario();
      const theirs = await scenario();
      const token = await release(mine.setupId);

      const response = await publicApi.get(
        `/kpi/evaluation-links/${token}/assignments/${theirs.assignmentId}`,
      );

      // The property that makes these links safe to email: a token is scoped
      // to its setup and cannot be walked sideways onto another one.
      expect(response.status).toBe(403);
    });

    it('answers 404 for an assignment that does not exist in the link tenant', async () => {
      const mine = await scenario();
      const token = await release(mine.setupId);

      const response = await publicApi.get(
        `/kpi/evaluation-links/${token}/assignments/${MISSING_ID}`,
      );

      expect(response.status).toBe(404);
    });

    it('saves scores submitted through the link and evaluates the assignment', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const saved = await publicApi
        .put(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/results`)
        .send({
          items: [
            { id: built.itemIds[0], managerScore: 90 },
            { id: built.itemIds[1], managerScore: 80 },
          ],
        })
        .expect(200);
      expect(Number(saved.body.overallScore)).toBe(86);

      const evaluated = await publicApi
        .post(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/evaluate`)
        .expect(201);

      expect(evaluated.body.workflowStatus).toBe('evaluated');
      // HR sees the same numbers the evaluator entered.
      const reread = await readAssignment(built.assignmentId);
      expect(Number(reread.overallScore)).toBe(86);
      expect(reread.grade).toBe('A');
    });

    it('returns an assignment to HR through the link', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await publicApi
        .post(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/return-to-hr`)
        .send({ reason: 'เป้าหมายไม่ถูกต้อง' })
        .expect(201);

      expect(response.body.workflowStatus).toBe('awaiting_revision');
      const reread = await readAssignment(built.assignmentId);
      expect(reread.returnToHrComment).toBe('เป้าหมายไม่ถูกต้อง');
    });

    it('refuses to return an assignment that is not under review', async () => {
      const built = await scenario();
      const token = await release(built.setupId);
      await publicApi
        .post(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/evaluate`)
        .expect(201);

      const response = await publicApi
        .post(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/return-to-hr`)
        .send({ reason: 'สายเกินไป' });

      expect(response.status).toBe(400);
    });

    it('confirms the review and moves the setup to pending', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await publicApi.post(`/kpi/evaluation-links/${token}/confirm`).expect(201);

      expect(response.body.status).toBe('pending');
      expect((await api.get(`/kpi/setups/${built.setupId}`).expect(200)).body.status).toBe(
        'pending',
      );
    });

    it('answers 404 for a token that was never issued', async () => {
      const response = await publicApi.get('/kpi/evaluation-links/not-a-real-token');

      expect(response.status).toBe(404);
    });

    it('rejects a token that a later release superseded', async () => {
      const built = await scenario();
      const first = await release(built.setupId);
      const second = await release(built.setupId);

      const response = await publicApi.get(`/kpi/evaluation-links/${first}`);

      // createSetupEvaluationLink revokes the setup's previous links, so a
      // forwarded copy of an old mail stops working the moment HR re-releases.
      expect(response.status).toBe(400);
      await publicApi.get(`/kpi/evaluation-links/${second}`).expect(200);
    });

    it('reads the latest link of an assignment back for HR', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await api
        .get(`/kpi/assignments/${built.assignmentId}/evaluation-link`)
        .expect(200);

      expect(response.body.token).toBe(token);
    });

    it('mints a fresh link for an assignment on demand', async () => {
      const built = await scenario();
      await release(built.setupId);

      const response = await api
        .post(`/kpi/assignments/${built.assignmentId}/evaluation-link`)
        .send({})
        .expect(201);

      expect(response.body.token).toEqual(expect.any(String));
      // It is the setup's link — the assignment route is a convenience wrapper.
      const viaSetup = await api.get(`/kpi/setups/${built.setupId}`).expect(200);
      expect(viaSetup.body.linkPath).toBe(`/kpi/evaluate/${response.body.token}`);
    });

    test.failing('requires an HR session before scores are written through a link', async () => {
      const built = await scenario();
      const token = await release(built.setupId);

      const response = await publicApi
        .put(`/kpi/evaluation-links/${token}/assignments/${built.assignmentId}/results`)
        .send({ items: [{ id: built.itemIds[0], managerScore: 100 }] });

      // DEFECT. findAccessibleEvaluationAssignment (kpi-evaluation-link.service.ts)
      // looks for an Authorization header or an HR cookie, and when it finds
      // neither it returns the assignment with no check at all:
      //
      //   const candidates = this.extractAuthTokenCandidates(...);
      //   if (!candidates.length) return assignment;
      //
      // Anyone who sees the link — a forwarded mail, a browser history, a chat
      // log — can therefore read and rewrite the scores of every assignment in
      // that setup, and finish the evaluation, without ever signing in. The
      // login endpoint exists and the evaluator identity check runs only for
      // callers who volunteer a token, so the check is opt-in. Correct
      // behaviour is 401.
      expect(response.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 360 feedback
  // ═══════════════════════════════════════════════════════════════════════════

  describe('360 templates', () => {
    it('creates a template with its competencies and questions', async () => {
      const template = await create360Template();

      expect(template.year).toBe(2026);
      expect(template.status).toBe('active');
      expect(template.competencies).toHaveLength(1);
      expect(template.competencies[0].questions).toHaveLength(2);
    });

    it('lists the template back', async () => {
      const template = await create360Template();

      const response = await api.get('/360/templates').expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).toContain(template.id);
    });

    it('replaces the structure on update', async () => {
      const template = await create360Template();

      const response = await api
        .put(`/360/templates/${template.id}`)
        .send(
          feedbackTemplate({
            name: template.name,
            competencies: [
              {
                name: 'ภาวะผู้นำ',
                weight: 100,
                questions: [{ question: 'ตัดสินใจได้ดี', weight: 1, scaleMin: 1, scaleMax: 5 }],
              },
            ],
          }),
        )
        .expect(200);

      expect(response.body.competencies).toHaveLength(1);
      expect(response.body.competencies[0].name).toBe('ภาวะผู้นำ');
      expect(response.body.competencies[0].questions).toHaveLength(1);
    });

    it('refuses competency weights that do not total 100', async () => {
      const response = await api.post('/360/templates').send(
        feedbackTemplate({
          competencies: [
            { name: 'ครึ่งเดียว', weight: 50, questions: [{ question: 'คำถาม', weight: 1 }] },
          ],
        }),
      );

      expect(response.status).toBe(400);
    });

    it('refuses a competency with no questions', async () => {
      const response = await api.post('/360/templates').send(
        feedbackTemplate({
          competencies: [{ name: 'ไม่มีคำถาม', weight: 100, questions: [] }],
        }),
      );

      expect(response.status).toBe(400);
    });

    it('refuses a year outside 2000–2100', async () => {
      const response = await api.post('/360/templates').send(feedbackTemplate({ year: 1990 }));

      expect(response.status).toBe(400);
    });

    it('refuses a question whose scale maximum is above 10', async () => {
      const response = await api.post('/360/templates').send(
        feedbackTemplate({
          competencies: [
            {
              name: 'สเกลเกิน',
              weight: 100,
              questions: [{ question: 'คำถาม', weight: 1, scaleMin: 1, scaleMax: 20 }],
            },
          ],
        }),
      );

      expect(response.status).toBe(400);
    });

    it('answers 404 when updating a template that does not exist', async () => {
      const response = await api.put(`/360/templates/${MISSING_ID}`).send(feedbackTemplate());

      expect(response.status).toBe(404);
    });

    it('answers 404 when deleting a template that does not exist', async () => {
      const response = await api.delete(`/360/templates/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('deletes a template in use together with everything hanging off it', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [peer.id],
      });
      const evaluationId = assigned.assigned[0].evaluationId;

      const response = await api.delete(`/360/templates/${template.id}`).expect(200);

      // deleteTemplate is a documented cascade: answers, evaluators,
      // evaluations, questions, competencies and links all go with it. There
      // is no "template in use" guard, which is deliberate — the 360 screens
      // treat the template as the campaign itself.
      expect(response.body).toEqual({ id: template.id, deleted: true });
      await api.get(`/360/evaluations/${evaluationId}`).expect(404);
    });

    it('requires credentials', async () => {
      await publicApi.get('/360/templates').expect(401);
    });
  });

  describe('360 evaluations', () => {
    it('assigns an evaluation with a manager and a peer evaluator', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });

      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        managerId: manager.id,
        peerIds: [peer.id],
      });

      expect(assigned.total).toBe(1);
      expect(assigned.assigned[0].created).toBe(true);
      const evaluation = await read360(assigned.assigned[0].evaluationId);
      expect(evaluation.evaluators).toHaveLength(2);
      expect(evaluatorOf(evaluation, 'manager').evaluatorId).toBe(manager.id);
      // Peers and subordinates answer anonymously; the manager does not.
      expect(evaluatorOf(evaluation, 'peer').isAnonymous).toBe(true);
      expect(evaluatorOf(evaluation, 'manager').isAnonymous).toBe(false);
    });

    it('re-assigning the same employee and template updates the existing evaluation', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });
      const first = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [peer.id],
      });

      const second = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [],
        managerId: manager.id,
      });

      expect(second.assigned[0].created).toBe(false);
      expect(second.assigned[0].evaluationId).toBe(first.assigned[0].evaluationId);
      const evaluation = await read360(second.assigned[0].evaluationId);
      // The peer that is no longer selected is removed, not merely deactivated.
      expect(evaluation.evaluators.map((row: { type: string }) => row.type)).toEqual(['manager']);
    });

    it('never makes an employee their own evaluator', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });

      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        managerId: employee.id,
        peerIds: [employee.id],
      });

      const evaluation = await read360(assigned.assigned[0].evaluationId);
      expect(evaluation.evaluators).toHaveLength(0);
    });

    it('filters the list by template and by employee', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [peer.id],
      });

      const byTemplate = await api
        .get('/360/evaluations')
        .query({ templateId: template.id })
        .expect(200);
      const byEmployee = await api
        .get('/360/evaluations')
        .query({ employeeId: employee.id })
        .expect(200);

      expect(byTemplate.body.map((row: { id: string }) => row.id)).toEqual([
        assigned.assigned[0].evaluationId,
      ]);
      expect(byEmployee.body.map((row: { id: string }) => row.id)).toEqual([
        assigned.assigned[0].evaluationId,
      ]);
    });

    it('refuses an assignment naming an employee of no tenant', async () => {
      const template = await create360Template();

      const response = await api
        .post('/360/evaluations/assign')
        .send({ templateId: template.id, employeeIds: [MISSING_ID] });

      expect(response.status).toBe(404);
    });

    it('refuses an assignment with an empty employee list', async () => {
      const template = await create360Template();

      const response = await api
        .post('/360/evaluations/assign')
        .send({ templateId: template.id, employeeIds: [] });

      expect(response.status).toBe(400);
    });

    it('refuses an assignment whose template does not exist', async () => {
      const employee = await createEmployee(api, { departmentId });

      const response = await api
        .post('/360/evaluations/assign')
        .send({ templateId: MISSING_ID, employeeIds: [employee.id] });

      expect(response.status).toBe(404);
    });

    it('answers 404 when reading an evaluation that does not exist', async () => {
      const response = await api.get(`/360/evaluations/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('deletes an evaluation with its evaluators and answers', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [peer.id],
      });

      const response = await api
        .delete(`/360/evaluations/${assigned.assigned[0].evaluationId}`)
        .expect(200);

      expect(response.body).toEqual({ id: assigned.assigned[0].evaluationId, deleted: true });
      await api.get(`/360/evaluations/${assigned.assigned[0].evaluationId}`).expect(404);
    });

    it('answers 404 when deleting an evaluation that does not exist', async () => {
      const response = await api.delete(`/360/evaluations/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('has no patch route: an evaluation is changed by re-assigning it', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        managerId: manager.id,
      });

      // Feedback360Controller serves GET, DELETE and POST /assign only. The
      // deadline and the evaluator set are edited by POSTing /assign again,
      // which the "updates the existing evaluation" test above covers.
      const response = await api
        .patch(`/360/evaluations/${assigned.assigned[0].evaluationId}`)
        .send({ comment: 'แก้ไข' });

      expect(response.status).toBe(404);
    });
  });

  describe('360 answers and report', () => {
    /** An evaluation with a single peer evaluator, ready to be answered. */
    async function feedbackScenario() {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const peer = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        peerIds: [peer.id],
      });
      const evaluationId = assigned.assigned[0].evaluationId;
      const evaluation = await read360(evaluationId);

      return {
        templateId: template.id,
        employee,
        evaluationId,
        evaluatorAssignmentId: evaluatorOf(evaluation, 'peer').id,
        questionIds: questionIdsOf(evaluation),
      };
    }

    it('stores the answers and marks the evaluation submitted', async () => {
      const built = await feedbackScenario();

      const response = await api
        .post('/360/answers')
        .send({
          evaluatorAssignmentId: built.evaluatorAssignmentId,
          markSubmitted: true,
          answers: built.questionIds.map((questionId) => ({ questionId, score: 4 })),
        })
        .expect(201);

      // The only evaluator has answered, so the whole evaluation is submitted.
      expect(response.body.status).toBe('submitted');
      expect(response.body.submittedEvaluators).toBe(1);
      expect(response.body.pendingEvaluators).toBe(0);
      expect(response.body.summary.overallScore).toBe(4);
      expect(response.body.summary.competencyBreakdown[0].averageScore).toBe(4);
    });

    it('keeps the evaluation open while an answer is saved but not submitted', async () => {
      const built = await feedbackScenario();

      const response = await api
        .post('/360/answers')
        .send({
          evaluatorAssignmentId: built.evaluatorAssignmentId,
          answers: [{ questionId: built.questionIds[0], score: 3 }],
        })
        .expect(201);

      expect(response.body.status).toBe('pending');
      expect(response.body.submittedEvaluators).toBe(0);
    });

    it('rolls the submitted scores up into the employee report', async () => {
      const built = await feedbackScenario();
      await api
        .post('/360/answers')
        .send({
          evaluatorAssignmentId: built.evaluatorAssignmentId,
          markSubmitted: true,
          answers: built.questionIds.map((questionId) => ({ questionId, score: 5 })),
        })
        .expect(201);

      const response = await api.get(`/360/report/${built.employee.id}`).expect(200);

      expect(response.body.employeeId).toBe(built.employee.id);
      expect(response.body.totalEvaluations).toBe(1);
      expect(response.body.evaluations[0].id).toBe(built.evaluationId);
      expect(response.body.evaluations[0].summary.overallScore).toBe(5);
      expect(response.body.evaluations[0].summary.evaluatorSummary.peer).toEqual({
        count: 1,
        averageScore: 5,
      });
    });

    it('leaves an untouched evaluation out of the report', async () => {
      const built = await feedbackScenario();

      const response = await api.get(`/360/report/${built.employee.id}`).expect(200);

      // getReportByEmployee only counts in_progress, submitted and locked — a
      // draft campaign nobody has answered yet does not inflate the numbers.
      expect(response.body.totalEvaluations).toBe(0);
    });

    it('refuses a score outside the question scale', async () => {
      const built = await feedbackScenario();

      const response = await api.post('/360/answers').send({
        evaluatorAssignmentId: built.evaluatorAssignmentId,
        answers: [{ questionId: built.questionIds[0], score: 9 }],
      });

      // The questions are scaled 1–5. The DTO allows up to 10, so it is the
      // service that enforces the per-question scale.
      expect(response.status).toBe(400);
    });

    it('refuses a score the DTO itself rejects', async () => {
      const built = await feedbackScenario();

      const response = await api.post('/360/answers').send({
        evaluatorAssignmentId: built.evaluatorAssignmentId,
        answers: [{ questionId: built.questionIds[0], score: 50 }],
      });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a question that belongs to another template', async () => {
      const built = await feedbackScenario();
      const other = await feedbackScenario();

      const response = await api.post('/360/answers').send({
        evaluatorAssignmentId: built.evaluatorAssignmentId,
        answers: [{ questionId: other.questionIds[0], score: 4 }],
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 for an evaluator assignment that does not exist', async () => {
      const built = await feedbackScenario();

      const response = await api.post('/360/answers').send({
        evaluatorAssignmentId: MISSING_ID,
        answers: [{ questionId: built.questionIds[0], score: 4 }],
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 for the report of an employee of no tenant', async () => {
      const response = await api.get(`/360/report/${MISSING_ID}`);

      expect(response.status).toBe(404);
    });

    it('offers the templates, departments and evaluator types the forms need', async () => {
      const template = await create360Template();

      const response = await api.get('/360/lookups').expect(200);

      expect(response.body.templates.map((row: { id: string }) => row.id)).toContain(template.id);
      expect(response.body.departments.map((row: { id: string }) => row.id)).toContain(
        departmentId,
      );
      expect(response.body.evaluatorTypes).toEqual(['manager', 'peer', 'subordinate']);
    });
  });

  // ─── the public 360 evaluation link ────────────────────────────────────────
  // Feedback360EvaluationLinkController carries no guard either, but unlike the
  // KPI one every route past the landing page insists on a real HR session.

  describe('360 evaluation links', () => {
    /**
     * A 360 campaign whose manager evaluator is the suite's own HR user — the
     * only employee whose access token this suite can present to the link
     * routes, which identify the caller from the token alone.
     */
    async function linkScenario(evaluationIds?: (id: string) => string[]) {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        managerId: hrEmployeeId,
      });
      const evaluationId = assigned.assigned[0].evaluationId;
      const link = expectOk(
        await api.post('/360/evaluation-links').send({
          templateId: template.id,
          ...(evaluationIds ? { evaluationIds: evaluationIds(evaluationId) } : {}),
        }),
        'a 360 evaluation link',
      );

      return { templateId: template.id, employee, evaluationId, token: link.token as string };
    }

    it('creates a link for a template and reads it back', async () => {
      const template = await create360Template();

      const created = await api
        .post('/360/evaluation-links')
        .send({ templateId: template.id })
        .expect(201);

      expect(created.body.token).toEqual(expect.any(String));
      const latest = await api
        .get('/360/evaluation-links')
        .query({ templateId: template.id })
        .expect(200);
      expect(latest.body.token).toBe(created.body.token);
    });

    it('refuses a link that names neither a template nor any evaluations', async () => {
      const response = await api.post('/360/evaluation-links').send({});

      expect(response.status).toBe(400);
    });

    it('refuses a link whose expiry has already passed', async () => {
      const template = await create360Template();

      const response = await api
        .post('/360/evaluation-links')
        .send({ templateId: template.id, expiresAt: '2020-01-01T00:00:00.000Z' });

      expect(response.status).toBe(400);
    });

    it('refuses a link naming an evaluation of another template', async () => {
      const template = await create360Template();
      const other = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: other.id,
        employeeIds: [employee.id],
        managerId: manager.id,
      });

      const response = await api
        .post('/360/evaluation-links')
        .send({ templateId: template.id, evaluationIds: [assigned.assigned[0].evaluationId] });

      expect(response.status).toBe(404);
    });

    it('shows the anonymous holder of a token only the campaign it belongs to', async () => {
      const built = await linkScenario();

      const response = await publicApi.get(`/360/evaluation-links/${built.token}`).expect(200);

      // The landing page is deliberately public — it tells the evaluator which
      // campaign they are about to sign in to, and nothing about any person.
      expect(response.body.templateId).toBe(built.templateId);
      expect(response.body.tenantId).toBe(loadTestEnv().tenantId);
      expect(response.body.employee).toBeUndefined();
    });

    it('answers 404 for a token that was never issued', async () => {
      const response = await publicApi.get('/360/evaluation-links/not-a-real-token');

      expect(response.status).toBe(404);
    });

    it('refuses to list the evaluations of a link to an anonymous caller', async () => {
      const built = await linkScenario();

      const response = await publicApi.get(`/360/evaluation-links/${built.token}/evaluations`);

      expect(response.status).toBe(401);
    });

    it('refuses to accept answers from an anonymous caller', async () => {
      const built = await linkScenario();

      const response = await publicApi
        .post(`/360/evaluation-links/${built.token}/evaluations/${built.evaluationId}/submit`)
        .send({ answers: [] });

      // The contrast with the KPI link is the point: here the identity check
      // is unconditional, so the token on its own buys nothing.
      expect(response.status).toBe(401);
    });

    it('lists the signed-in evaluator their own evaluations', async () => {
      const built = await linkScenario();

      const response = await api
        .get(`/360/evaluation-links/${built.token}/evaluations`)
        .expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).toContain(built.evaluationId);
    });

    it('lets the manager confirm the review and unblock the other evaluators', async () => {
      const built = await linkScenario();

      const response = await api
        .post(
          `/360/evaluation-links/${built.token}/evaluations/${built.evaluationId}/confirm-review`,
        )
        .expect(201);

      expect(response.body).toEqual({ success: true, evaluationId: built.evaluationId });
      expect((await read360(built.evaluationId)).status).toBe('pending');
    });

    it('lets the manager send an evaluation back for revision', async () => {
      const built = await linkScenario();

      const response = await api
        .post(
          `/360/evaluation-links/${built.token}/evaluations/${built.evaluationId}/return-for-revision`,
        )
        .send({ note: 'กรุณาทบทวนคำถามข้อ 2' })
        .expect(201);

      expect(response.body).toMatchObject({ success: true, note: 'กรุณาทบทวนคำถามข้อ 2' });
      const listed = await api
        .get('/360/evaluations')
        .query({ employeeId: built.employee.id })
        .expect(200);
      expect(listed.body[0].status).toBe('revision_requested');
    });

    it('refuses to review an evaluation the caller does not manage', async () => {
      const built = await linkScenario();
      const other = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: other.id,
        employeeIds: [employee.id],
        managerId: manager.id,
      });

      const response = await api.get(
        `/360/evaluation-links/${built.token}/evaluations/${assigned.assigned[0].evaluationId}`,
      );

      expect(response.status).toBe(401);
    });

    it('refuses the review detail of an evaluation outside the link batch', async () => {
      const inBatch = await linkScenario((id) => [id]);
      const employee = await createEmployee(api, { departmentId });
      const alsoMine = await assign360({
        templateId: inBatch.templateId,
        employeeIds: [employee.id],
        managerId: hrEmployeeId,
      });

      const response = await api.get(
        `/360/evaluation-links/${inBatch.token}/evaluations/${alsoMine.assigned[0].evaluationId}`,
      );

      // getEvaluationReviewDetail checks link.evaluationIds — a token issued
      // for one batch cannot be used to read another person's review.
      expect(response.status).toBe(404);
    });

    test.failing('refuses to confirm an evaluation outside the link batch', async () => {
      const inBatch = await linkScenario((id) => [id]);
      const employee = await createEmployee(api, { departmentId });
      const outOfBatch = await assign360({
        templateId: inBatch.templateId,
        employeeIds: [employee.id],
        managerId: hrEmployeeId,
      });

      const response = await api.post(
        `/360/evaluation-links/${inBatch.token}/evaluations/${outOfBatch.assigned[0].evaluationId}/confirm-review`,
      );

      // DEFECT. getEvaluationReviewDetail guards the batch:
      //
      //   if (Array.isArray(link.evaluationIds) && link.evaluationIds.length > 0
      //       && !link.evaluationIds.includes(evaluationId)) throw NotFound
      //
      // managerConfirmReview, managerReturnForRevision and submitEvaluatorAnswers
      // (feedback-360-evaluation-link.service.ts) omit that check entirely and
      // go straight to the evaluator lookup, so a link scoped to one batch of
      // evaluations still acts on any other evaluation the caller happens to
      // evaluate. The batch scope is enforced on the read and on none of the
      // writes. Correct behaviour is the same 404 the read gives.
      expect(response.status).toBe(404);
    });
  });

  // ─── tenant-wide KPI links ─────────────────────────────────────────────────
  // These run last: createTenantEvaluationLink revokes every non-revoked link
  // of the tenant, not only the tenant-wide ones, so calling it earlier would
  // silently invalidate the tokens the blocks above depend on.

  describe('tenant-wide KPI evaluation links', () => {
    it('mints a tenant link and reads it back', async () => {
      const created = await api.post('/kpi/evaluation-links').send({}).expect(201);

      expect(created.body.token).toEqual(expect.any(String));
      const latest = await api.get('/kpi/evaluation-links').expect(200);
      expect(latest.body.token).toBe(created.body.token);
    });

    it('refuses a tenant link whose expiry has already passed', async () => {
      const response = await api
        .post('/kpi/evaluation-links')
        .send({ expiresAt: '2020-01-01T00:00:00.000Z' });

      expect(response.status).toBe(400);
    });

    test.failing('keeps a tenant-wide link away from an unrelated assignment', async () => {
      const built = await scenario();
      await release(built.setupId);
      const tenantLink = await api.post('/kpi/evaluation-links').send({}).expect(201);

      const response = await publicApi.get(
        `/kpi/evaluation-links/${tenantLink.body.token}/assignments/${built.assignmentId}`,
      );

      // DEFECT. findEvaluationAssignmentByTokenOrThrow only compares setups
      // when the link has one:
      //
      //   if (link.setupId && assignment.setupId !== link.setupId) throw Forbidden
      //
      // A link minted by POST /kpi/evaluation-links has no setup_id, so the
      // comparison is skipped and the token reads — and, through the results
      // route, rewrites — every KPI assignment in the tenant. Together with
      // the missing authentication asserted above, one such link is a master
      // key to the tenant's whole appraisal round. A link scoped to no setup
      // should grant access to no assignment.
      expect(response.status).toBe(403);
    });
  });

  // ─── tenant scoping ────────────────────────────────────────────────────────

  describe('tenant scoping', () => {
    /**
     * A neighbouring tenant, numeric and derived from this worker's own id so
     * parallel workers cannot collide — several tenant-scoped tables store
     * `tenant_id` as an integer, where a UUID would collapse to 0.
     */
    const neighbourTenantId = `${loadTestEnv().tenantId}98`;
    let neighbour: ApiClient;

    beforeAll(async () => {
      neighbour = await apiClient(await hrUserFor(neighbourTenantId));
    });

    afterAll(async () => {
      await purgeTenantData(neighbourTenantId);
    });

    it('hides a KPI cycle, template and assignment from another tenant', async () => {
      const built = await scenario();

      const cycles = await neighbour.get('/kpi/cycles').expect(200);
      const templates = await neighbour.get('/kpi/templates').expect(200);
      const assignments = await neighbour.get('/kpi/assignments').expect(200);

      expect(cycles.body.map((row: { id: string }) => row.id)).not.toContain(built.cycleId);
      expect(templates.body.map((row: { id: string }) => row.id)).not.toContain(built.templateId);
      expect(assignments.body.map((row: { id: string }) => row.id)).not.toContain(
        built.assignmentId,
      );
    });

    it('answers 404 when another tenant reads the assignment by id', async () => {
      const built = await scenario();

      const response = await neighbour.get(`/kpi/assignments/${built.assignmentId}`);

      expect(response.status).toBe(404);
    });

    it('refuses to let another tenant write the assignment results', async () => {
      const built = await scenario();
      await release(built.setupId);

      const response = await neighbour
        .put(`/kpi/assignments/${built.assignmentId}/results`)
        .send({ items: [{ id: built.itemIds[0], managerScore: 5 }] });

      expect(response.status).toBe(404);
      expect(Number((await readAssignment(built.assignmentId)).overallScore)).toBe(0);
    });

    it('answers 404 when another tenant reads the KPI setup', async () => {
      const built = await scenario();

      const response = await neighbour.get(`/kpi/setups/${built.setupId}`);

      expect(response.status).toBe(404);
    });

    it('hides a 360 template and evaluation from another tenant', async () => {
      const template = await create360Template();
      const employee = await createEmployee(api, { departmentId });
      const assigned = await assign360({
        templateId: template.id,
        employeeIds: [employee.id],
        managerId: manager.id,
      });

      const templates = await neighbour.get('/360/templates').expect(200);
      const evaluations = await neighbour.get('/360/evaluations').expect(200);

      expect(templates.body.map((row: { id: string }) => row.id)).not.toContain(template.id);
      expect(evaluations.body.map((row: { id: string }) => row.id)).not.toContain(
        assigned.assigned[0].evaluationId,
      );
      await neighbour.get(`/360/evaluations/${assigned.assigned[0].evaluationId}`).expect(404);
    });

    it('refuses to let another tenant delete a 360 template', async () => {
      const template = await create360Template();

      const response = await neighbour.delete(`/360/templates/${template.id}`);

      expect(response.status).toBe(404);
      const stillThere = await api.get('/360/templates').expect(200);
      expect(stillThere.body.map((row: { id: string }) => row.id)).toContain(template.id);
    });

    it('answers 404 for another tenant asking for the 360 report', async () => {
      const employee = await createEmployee(api, { departmentId });

      const response = await neighbour.get(`/360/report/${employee.id}`);

      expect(response.status).toBe(404);
    });
  });
});
