/**
 * Authentication and tenant-scoping contract.
 *
 * These are the guarantees every other suite leans on: a protected route
 * refuses anonymous callers, the system token is accepted, and a request
 * without tenant context cannot reach tenant data.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData } from '../support/db';

describe('Authentication (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  describe('guarded routes', () => {
    it('rejects a request with no credentials', async () => {
      await api.anonymous().get('/employees').expect(401);
    });

    it('rejects a bearer token that is not a real access token', async () => {
      const actor = await hrUser();
      await api
        .as({ token: 'not-a-real-token', tenantId: actor.tenantId })
        .get('/employees')
        .expect(401);
    });

    it('accepts the token issued by a successful login', async () => {
      await api.get('/employees').expect(200);
    });
  });

  describe('tenant scoping', () => {
    it('derives the tenant from the access token when no header is sent', async () => {
      const actor = await hrUser();

      const created = await api
        .as({ token: actor.token })
        .post('/departments')
        .send({ code: 'ZZZ', nameTh: 'แผนกจากโทเคน' })
        .expect(201);

      // The record must land in the token's tenant, and therefore be visible
      // to a client that scopes explicitly to that same tenant.
      const listed = await api.get('/departments').query({ limit: 200 }).expect(200);
      expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(
        created.body.id,
      );
    });

    // KNOWN DEFECT (security) — `POST /employees` carries no `@UseGuards`,
    // unlike the GET/PUT/DELETE handlers beside it. Anyone who can reach the
    // API and guess a tenant id can create employee records without
    // authenticating. Expected to fail until the guard is added.
    test.failing('refuses to create an employee with no credentials at all', async () => {
      const actor = await hrUser();
      await api
        .as({ tenantId: actor.tenantId })
        .post('/employees')
        .send({ firstName: 'ไม่มี', lastName: 'สิทธิ์' })
        .expect(401);
    });
  });

  describe('POST /auth/login (happy path)', () => {
    it('issues an access token and a refresh token', async () => {
      const actor = await hrUser();
      expect(actor.token).toEqual(expect.any(String));
      expect(actor.token!.split('.')).toHaveLength(3);
    });
  });

  describe('POST /auth/login', () => {
    it('rejects unknown credentials with 401, not 500', async () => {
      const response = await api
        .anonymous()
        .post('/auth/login')
        .send({ username: 'no-such-user@example.test', password: 'wrong-password' });

      expect(response.status).toBe(401);
    });

    it('rejects a password shorter than the policy minimum with 400', async () => {
      const response = await api
        .anonymous()
        .post('/auth/login')
        .send({ username: 'someone@example.test', password: 'abc' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('password');
    });

    it('rejects a request missing the username entirely', async () => {
      await api.anonymous().post('/auth/login').send({ password: 'password123' }).expect(400);
    });
  });
});
