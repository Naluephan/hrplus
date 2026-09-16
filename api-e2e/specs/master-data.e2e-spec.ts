/**
 * Master data: the reference lists the rest of the product is built on
 * (nationalities, personalities, employee statuses, rejection reasons) plus
 * the read-only catalogues (countries, banks, institutions).
 *
 * These modules share one CRUD shape, so the lifecycle is exercised through a
 * single table-driven suite. What differs per resource — its payload and where
 * its name lives in the response — is declared once, in `RESOURCES` below,
 * which is also the place to add the next one.
 */
import { ApiClient, apiClient, systemActor } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';

interface CrudResource {
  /** Name used in test titles. */
  label: string;
  /** Route the resource is served at. */
  path: string;
  /** HTTP verb the resource uses for updates. */
  updateVerb: 'put' | 'patch';
  /** Builds a valid creation payload. */
  build: (api: ApiClient) => Promise<Record<string, unknown>>;
  /** Builds a payload that must be rejected, with the field expected to be named. */
  invalid: () => { payload: Record<string, unknown>; field: string };
  /** Reads the human-readable label out of a record. */
  nameOf: (record: any) => string;
  /** Builds an update that changes the label. */
  rename: (name: string) => Record<string, unknown>;
}

const suffix = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4);

/**
 * An ISO-alpha-2 code that nothing is using yet.
 *
 * Nationalities are global rather than tenant-scoped, so the suite's tenant
 * purge does not free codes and the ~270 seeded rows already occupy most of
 * them. Picking at random out of 676 combinations collides regularly, so the
 * codes in use are read first and the pool is filled in from what is left.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Upper bound on parallel workers the ISO pool is divided between. */
const ISO_POOL_SHARDS = 16;
let freeIsoCodes: string[] | undefined;

async function reserveIsoCode(api: ApiClient): Promise<string> {
  if (!freeIsoCodes) {
    const response = await api.get('/nationalities').query({ limit: 500 });
    const rows = Array.isArray(response.body)
      ? response.body
      : (response.body.items ?? response.body.data ?? []);
    const taken = new Set(
      rows.map((row: { isoAlpha2Code?: string }) => row.isoAlpha2Code).filter(Boolean),
    );

    // Nationalities are global, so parallel workers draw from the same pool.
    // Each worker keeps only its own slice of it; they can never pick the same code.
    const shard = (Number(process.env.JEST_WORKER_ID ?? '1') - 1) % ISO_POOL_SHARDS;
    freeIsoCodes = [];
    let index = 0;
    for (const first of ALPHABET) {
      for (const second of ALPHABET) {
        const code = `${first}${second}`;
        if (!taken.has(code) && index++ % ISO_POOL_SHARDS === shard) freeIsoCodes.push(code);
      }
    }
  }

  const code = freeIsoCodes.pop();
  if (!code) {
    throw new Error('No unused ISO alpha-2 codes are left — clean up the test nationalities.');
  }
  return code;
}

const RESOURCES: CrudResource[] = [
  {
    label: 'nationalities',
    path: '/nationalities',
    updateVerb: 'put',
    build: async (api) => ({
      isoAlpha2Code: await reserveIsoCode(api),
      englishName: `Testland ${suffix()}`,
      thaiName: uniqueName('สัญชาติทดสอบ'),
      allowedInThailand: true,
    }),
    invalid: () => ({
      payload: {
        isoAlpha2Code: 'TOO-LONG',
        englishName: 'Testland',
        thaiName: 'ทดสอบ',
      },
      field: 'isoAlpha2Code',
    }),
    nameOf: (record) => record.thaiName,
    rename: (name) => ({ thaiName: name }),
  },
  {
    label: 'personalities',
    path: '/personalities',
    updateVerb: 'put',
    build: async () => ({
      code: `P${suffix()}`.slice(0, 10),
      name: uniqueName('บุคลิกทดสอบ'),
      description: 'created by the e2e suite',
    }),
    invalid: () => ({
      payload: { name: uniqueName('ไม่มีรหัส') },
      field: 'code',
    }),
    nameOf: (record) => record.name,
    rename: (name) => ({ name }),
  },
  {
    label: 'employee statuses',
    path: '/employee-statuses',
    updateVerb: 'put',
    build: async () => ({
      name: uniqueName('สถานะทดสอบ'),
      description: 'created by the e2e suite',
    }),
    invalid: () => ({ payload: { description: 'no name' }, field: 'name' }),
    nameOf: (record) => record.name,
    rename: (name) => ({ name }),
  },
  {
    label: 'rejection reasons',
    path: '/rejection-reasons',
    updateVerb: 'patch',
    build: async () => ({ reason: uniqueName('เหตุผลทดสอบ'), order: 1 }),
    invalid: () => ({ payload: {}, field: 'reason' }),
    nameOf: (record) => record.reason,
    rename: (reason) => ({ reason }),
  },
];

/**
 * Nationalities are global, so the tenant purge never removes them. Without
 * this, every run would permanently consume ISO codes until none were left.
 */
async function removeTestNationalities(api: ApiClient): Promise<void> {
  const response = await api.get('/nationalities').query({ limit: 500 });
  const rows = Array.isArray(response.body)
    ? response.body
    : (response.body.items ?? response.body.data ?? []);

  for (const row of rows as Array<{ id: string; englishName?: string }>) {
    if (row.englishName?.startsWith('Testland ')) {
      await api.delete(`/nationalities/${row.id}`);
    }
  }
}

describe('Master data (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(async () => {
    await removeTestNationalities(api);
    await purgeTestTenantData();
  });

  describe.each(RESOURCES)('$label', (resource) => {
    const listOf = (body: any): any[] =>
      Array.isArray(body) ? body : (body.items ?? body.data ?? []);

    const create = async () => {
      const payload = await resource.build(api);
      const response = await api.post(resource.path).send(payload);

      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a ${resource.label} record (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return { id: response.body.id as string, payload };
    };

    it('creates a record and returns it in the list', async () => {
      const { id } = await create();

      const list = await api.get(resource.path).expect(200);
      expect(listOf(list.body).map((item) => item.id)).toContain(id);
    });

    it('renames a record and the change sticks', async () => {
      const { id } = await create();
      const renamed = uniqueName('เปลี่ยนชื่อแล้ว');

      await api[resource.updateVerb](`${resource.path}/${id}`)
        .send(resource.rename(renamed))
        .expect(200);

      const list = await api.get(resource.path).expect(200);
      const found = listOf(list.body).find((item) => item.id === id);

      expect(found).toBeDefined();
      expect(resource.nameOf(found)).toBe(renamed);
    });

    it('deletes a record so it leaves the list', async () => {
      const { id } = await create();

      await api.delete(`${resource.path}/${id}`).expect(200);

      const list = await api.get(resource.path).expect(200);
      expect(listOf(list.body).map((item) => item.id)).not.toContain(id);
    });

    // KNOWN DEFECT for rejection reasons — RejectionReasonsController types its
    // body as a plain TypeScript `type`, not a decorated class, so the global
    // ValidationPipe has nothing to check and an empty body is accepted with
    // 201, creating a reason with no text. Every other resource here validates.
    const validates = resource.label === 'rejection reasons' ? test.failing : it;

    validates('rejects an invalid payload and names the offending field', async () => {
      const { payload, field } = resource.invalid();

      const response = await api.post(resource.path).send(payload);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(field);
    });

    it('answers 404 when updating a record that does not exist', async () => {
      const response = await api[resource.updateVerb](
        `${resource.path}/00000000-0000-4000-8000-00000000dead`,
      ).send(resource.rename(uniqueName('ไม่มีอยู่จริง')));

      expect(response.status).toBe(404);
    });
  });

  describe('read-only catalogues', () => {
    it('lists countries', async () => {
      const response = await api.get('/countries').expect(200);

      const items = Array.isArray(response.body)
        ? response.body
        : (response.body.items ?? response.body.data ?? []);
      expect(items.length).toBeGreaterThan(0);
    });

    it('offers banks as selectable options for a tenant that has them', async () => {
      // Banks are seeded per tenant, so the suite's own (freshly purged)
      // tenant legitimately has none — ask a seeded tenant instead.
      //
      // The system token is used rather than the HR user's, because an HR
      // token carries its own tenant and TenantScopeMiddleware rightly ignores
      // an x-tenant-id header that disagrees with it. The system token is
      // pinned to tenant '3', which is the seeded tenant wanted here.
      const response = await apiClient(systemActor()).then((client) =>
        client.get('/banks/options').expect(200),
      );

      const items = Array.isArray(response.body)
        ? response.body
        : (response.body.items ?? response.body.data ?? []);
      expect(items.length).toBeGreaterThan(0);
    });

    it('returns an empty bank list for a tenant with none configured', async () => {
      const response = await api.get('/banks/options').expect(200);

      const items = Array.isArray(response.body)
        ? response.body
        : (response.body.items ?? response.body.data ?? []);
      expect(items).toHaveLength(0);
    });

    it('searches institutions', async () => {
      const response = await api.get('/institutions/search').query({ q: 'ม' });

      expect(response.status).toBe(200);
    });
  });
});
