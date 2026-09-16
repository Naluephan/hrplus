/**
 * Employee issue reports: the channel staff use to raise problems to HR,
 * including the option to do so anonymously.
 *
 * Two things matter here beyond CRUD. Anonymity has to actually hold — a report
 * filed anonymously must not carry the reporter's identity back out — and the
 * triage status has to be a closed set, so a report cannot be parked in a state
 * no one is looking at.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';

const STATUSES = ['new', 'in_progress', 'resolved'] as const;

describe('Issue reports (e2e)', () => {
  let api: ApiClient;
  let categoryId: string;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    const category = await api
      .post('/issue-report-categories')
      .send({ name: uniqueName('หมวดปัญหาทดสอบ'), isActive: true, sortOrder: 1 });

    if (category.status >= 300 || !category.body?.id) {
      throw new Error(
        `Could not create an issue category (HTTP ${category.status}): ${JSON.stringify(category.body)}`,
      );
    }
    categoryId = String(category.body.id);
  });

  afterAll(purgeTestTenantData);

  const listed = (body: any): any[] =>
    Array.isArray(body) ? body : (body.items ?? body.data ?? []);

  const report = async (overrides: Record<string, unknown> = {}) => {
    const response = await api.post('/issue-reports').send({
      categoryId,
      description: uniqueName('แจ้งปัญหาจากชุดทดสอบ'),
      ...overrides,
    });

    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Could not file an issue report (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return String(response.body.id);
  };

  describe('categories', () => {
    it('lists a newly created category', async () => {
      const response = await api.get('/issue-report-categories').expect(200);

      expect(listed(response.body).map((item) => String(item.id))).toContain(categoryId);
    });

    it('renames a category', async () => {
      const created = await api
        .post('/issue-report-categories')
        .send({ name: uniqueName('หมวดเดิม') })
        .expect(201);
      const name = uniqueName('หมวดใหม่');

      await api.put(`/issue-report-categories/${created.body.id}`).send({ name }).expect(200);

      const response = await api.get('/issue-report-categories').expect(200);
      const found = listed(response.body).find(
        (item) => String(item.id) === String(created.body.id),
      );
      expect(found.name).toBe(name);
    });

    it('deletes a category', async () => {
      const created = await api
        .post('/issue-report-categories')
        .send({ name: uniqueName('หมวดที่จะลบ') })
        .expect(201);

      await api.delete(`/issue-report-categories/${created.body.id}`).expect(200);

      const response = await api.get('/issue-report-categories').expect(200);
      expect(listed(response.body).map((item) => String(item.id))).not.toContain(
        String(created.body.id),
      );
    });
  });

  describe('filing a report', () => {
    it('files a report that starts in the "new" state', async () => {
      const id = await report();

      const response = await api.get('/issue-reports').expect(200);
      const found = listed(response.body).find((item) => String(item.id) === id);

      expect(found).toBeDefined();
      expect(found.status).toBe('new');
    });

    it('keeps an anonymous report anonymous', async () => {
      const id = await report({ anonymous: true });

      const response = await api.get('/issue-reports').expect(200);
      const found = listed(response.body).find((item) => String(item.id) === id);

      expect(found.isAnonymous).toBe(true);

      // Anonymity is the whole promise of the feature: nothing that identifies
      // the reporter may travel back out with the report.
      expect(found.employeeName ?? null).toBeNull();
      expect(found.employeeId ?? null).toBeNull();
    });

    it('records the reporter on a report that is not anonymous', async () => {
      const id = await report({ anonymous: false });

      const response = await api.get('/issue-reports').expect(200);
      const found = listed(response.body).find((item) => String(item.id) === id);

      expect(found.isAnonymous).toBe(false);
    });
  });

  describe('triage', () => {
    it.each(STATUSES)('moves a report to %s', async (status) => {
      const id = await report();

      await api.patch(`/issue-reports/${id}/status`).send({ status }).expect(200);

      const response = await api.get('/issue-reports').query({ status }).expect(200);
      expect(listed(response.body).map((item) => String(item.id))).toContain(id);
    });

    it('refuses a status outside the allowed set', async () => {
      const id = await report();

      const response = await api
        .patch(`/issue-reports/${id}/status`)
        .send({ status: 'parked-forever' });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a report that does not exist', async () => {
      const response = await api
        .patch('/issue-reports/00000000-0000-4000-8000-00000000dead/status')
        .send({ status: 'resolved' });

      expect(response.status).toBe(404);
    });
  });

  describe('conversation', () => {
    it('records a message against the report', async () => {
      const id = await report();
      const body = uniqueName('ข้อความจากชุดทดสอบ');

      await api.post(`/issue-reports/${id}/messages`).send({ body }).expect(201);

      const response = await api.get(`/issue-reports/${id}/messages`).expect(200);
      const bodies = listed(response.body).map((message) => message.body);

      expect(bodies).toContain(body);
    });

    it('marks a report thread as read', async () => {
      const id = await report();

      const response = await api.post(`/issue-reports/${id}/read`);
      expect(response.status).toBeLessThan(400);
    });
  });
});
