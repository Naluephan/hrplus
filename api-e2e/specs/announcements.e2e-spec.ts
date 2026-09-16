/**
 * Announcements and the notifications they generate.
 *
 * An announcement is the one thing in the product that is deliberately
 * broadcast, so the questions are about reach and lifecycle: does a draft stay
 * hidden, does a published one appear, and does deleting it take it away.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';

/** Mirrors AnnouncementStatus in the entity. */
const STATUS = { draft: 0, scheduled: 1, published: 2, archived: 3 } as const;
/** Mirrors AnnouncementVisibility in the entity. */
const VISIBILITY = { public: 1, internal: 2, custom: 3 } as const;

describe('Announcements (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  const listed = (body: any): any[] =>
    Array.isArray(body) ? body : (body.items ?? body.data ?? []);

  const createAnnouncement = async (overrides: Record<string, unknown> = {}) => {
    const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    const payload = {
      code: `E2E-${suffix}`.slice(0, 120),
      title: uniqueName('ประกาศทดสอบ'),
      summary: 'สรุปย่อจากชุดทดสอบ',
      content: '<p>เนื้อหาประกาศจากชุดทดสอบ</p>',
      status: STATUS.published,
      visibility: VISIBILITY.internal,
      pinned: false,
      ...overrides,
    };

    const response = await api.post('/announcements').send(payload);
    if (response.status >= 300 || !response.body?.id) {
      throw new Error(
        `Could not create an announcement (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
    return { id: String(response.body.id), payload };
  };

  describe('POST /announcements', () => {
    it('creates an announcement and returns it by id', async () => {
      const { id, payload } = await createAnnouncement();

      const response = await api.get(`/announcements/${id}`).expect(200);
      expect(response.body).toMatchObject({
        code: payload.code,
        title: payload.title,
      });
    });

    // KNOWN DEFECT — AnnouncementsController types the body as
    // `CreateAnnouncementDto | undefined`. TypeScript emits `Object` as the
    // design-time type for a union, so the global ValidationPipe treats it as a
    // native type and skips validation entirely: CreateAnnouncementDto's rules
    // never run and any payload is accepted. Expected to fail until the body is
    // typed as the DTO alone.
    test.failing('rejects an announcement with no content', async () => {
      const response = await api.post('/announcements').send({
        code: `E2E-${Date.now().toString(36)}`,
        title: uniqueName('ไม่มีเนื้อหา'),
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('content');
    });

    test.failing('rejects a status outside the enum', async () => {
      const response = await api.post('/announcements').send({
        code: `E2E-${Date.now().toString(36)}`,
        title: uniqueName('สถานะผิด'),
        content: '<p>x</p>',
        status: 99,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('status');
    });
  });

  describe('GET /announcements', () => {
    it('lists announcements of the caller tenant only', async () => {
      const { id } = await createAnnouncement();

      const response = await api.get('/announcements').query({ limit: 100 }).expect(200);
      const items = listed(response.body);
      const { tenantId } = await hrUser();

      expect(items.map((item) => String(item.id))).toContain(id);
      for (const item of items) {
        expect(String(item.tenantId)).toBe(tenantId);
      }
    });

    it('keeps a pinned announcement flagged as pinned', async () => {
      const { id } = await createAnnouncement({ pinned: true });

      const response = await api.get(`/announcements/${id}`).expect(200);
      expect(response.body.pinned).toBe(true);
    });
  });

  describe('PUT /announcements/:id', () => {
    it('publishes a draft and the new status sticks', async () => {
      const { id } = await createAnnouncement({ status: STATUS.draft });

      const before = await api.get(`/announcements/${id}`).expect(200);
      expect(before.body.status).toBe(STATUS.draft);

      await api.put(`/announcements/${id}`).send({ status: STATUS.published }).expect(200);

      const after = await api.get(`/announcements/${id}`).expect(200);
      expect(after.body.status).toBe(STATUS.published);
    });

    it('answers 404 for an announcement that does not exist', async () => {
      const response = await api.put('/announcements/99999999').send({ pinned: true });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /announcements/:id', () => {
    it('removes the announcement from the list', async () => {
      const { id } = await createAnnouncement();

      await api.delete(`/announcements/${id}`).expect(200);

      const response = await api.get('/announcements').query({ limit: 100 }).expect(200);
      expect(listed(response.body).map((item) => String(item.id))).not.toContain(id);
    });
  });

  describe('GET /notifications/my', () => {
    it('answers with the caller own notifications', async () => {
      const response = await api.get('/notifications/my').expect(200);

      const items = listed(response.body);
      expect(Array.isArray(items)).toBe(true);
    });

    it('answers 404 when marking a notification that does not exist as read', async () => {
      const response = await api.patch(
        '/notifications/my/00000000-0000-4000-8000-00000000dead/read',
      );

      expect(response.status).toBe(404);
    });
  });
});
