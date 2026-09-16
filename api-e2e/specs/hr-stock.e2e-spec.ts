/**
 * HR stock: uniforms, safety gear and IT hardware, and the reserve / release /
 * issue movements that draw them down.
 *
 * Stock is arithmetic that people act on — someone gets a uniform or does not —
 * so the suite follows quantities through a whole movement cycle and checks
 * that the books balance at every step, rather than just that endpoints answer.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';

interface StockItem {
  erpItemCode: string;
  qtyOnHand: number;
  qtyReserved: number;
  availableQty: number;
}

describe('HR stock (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  const listed = (body: any): any[] =>
    Array.isArray(body) ? body : (body.items ?? body.data ?? []);

  /** Creates an item and returns the code the API assigned it. */
  const createItem = async (initialQty = 100) => {
    const response = await api.post('/hr-stock/items').send({
      nameTh: uniqueName('ชุดยูนิฟอร์มทดสอบ'),
      nameEn: 'Test uniform',
      category: 'UNIFORM',
      section: 'uniform',
      unit: 'ตัว',
      initialQty,
    });

    if (response.status >= 300) {
      throw new Error(
        `Could not create a stock item (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }

    const code = response.body.erpItemCode ?? response.body.itemCode ?? response.body.code;
    if (!code) {
      throw new Error(`Stock item fixture returned no code: ${JSON.stringify(response.body)}`);
    }
    return String(code);
  };

  const readItem = async (code: string): Promise<StockItem> => {
    const response = await api.get('/hr-stock').query({ includeInactive: 'true' }).expect(200);
    const found = listed(response.body).find(
      (item) => String(item.erpItemCode ?? item.itemCode) === code,
    );

    if (!found) throw new Error(`Stock item ${code} is not in the list`);
    return {
      erpItemCode: code,
      qtyOnHand: Number(found.qtyOnHand ?? 0),
      qtyReserved: Number(found.qtyReserved ?? 0),
      availableQty: Number(found.availableQty ?? 0),
    };
  };

  describe('item master', () => {
    it('creates an item with its opening quantity available', async () => {
      const code = await createItem(40);
      const item = await readItem(code);

      expect(item.qtyOnHand).toBe(40);
      expect(item.qtyReserved).toBe(0);
      expect(item.availableQty).toBe(40);
    });

    it('rejects an item with no Thai name', async () => {
      const response = await api.post('/hr-stock/items').send({ nameEn: 'No Thai name' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('nameTh');
    });

    it('rejects a negative opening quantity', async () => {
      const response = await api.post('/hr-stock/items').send({
        nameTh: uniqueName('จำนวนติดลบ'),
        initialQty: -5,
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('initialQty');
    });

    it('rejects a section outside the allowed set', async () => {
      const response = await api.post('/hr-stock/items').send({
        nameTh: uniqueName('หมวดผิด'),
        section: 'not-a-section',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('section');
    });

    it('renames an item', async () => {
      const code = await createItem();
      const nameTh = uniqueName('ชื่อใหม่');

      await api.patch(`/hr-stock/items/${code}`).send({ nameTh }).expect(200);

      const response = await api.get('/hr-stock').expect(200);
      const found = listed(response.body).find(
        (item) => String(item.erpItemCode ?? item.itemCode) === code,
      );
      expect(found.nameTh).toBe(nameTh);
    });
  });

  describe('reserve, release and issue', () => {
    it('moves quantity from available to reserved when reserving', async () => {
      const code = await createItem(50);

      await api.post(`/hr-stock/${code}/reserve`).send({ qty: 12 }).expect(201);

      const item = await readItem(code);
      expect(item.qtyOnHand).toBe(50);
      expect(item.qtyReserved).toBe(12);
      expect(item.availableQty).toBe(38);
    });

    it('puts quantity back when releasing a reservation', async () => {
      const code = await createItem(50);

      await api.post(`/hr-stock/${code}/reserve`).send({ qty: 12 }).expect(201);
      await api.post(`/hr-stock/${code}/release`).send({ qty: 12 }).expect(201);

      const item = await readItem(code);
      expect(item.qtyReserved).toBe(0);
      expect(item.availableQty).toBe(50);
    });

    it('reduces stock on hand when issuing', async () => {
      const code = await createItem(50);

      // Issuing records who received the goods, so employeeName is required.
      await api
        .post(`/hr-stock/${code}/issue`)
        .send({ qty: 20, employeeName: 'ผู้รับของทดสอบ' })
        .expect(201);

      const item = await readItem(code);
      expect(item.qtyOnHand).toBe(30);
      expect(item.availableQty).toBe(30);
    });

    it('refuses to reserve more than is available', async () => {
      const code = await createItem(5);

      const response = await api.post(`/hr-stock/${code}/reserve`).send({ qty: 6 });

      expect(response.status).toBe(400);

      // The refusal must leave the books untouched — a rejected movement that
      // still moved stock is worse than one that never happened.
      const item = await readItem(code);
      expect(item.qtyOnHand).toBe(5);
      expect(item.qtyReserved).toBe(0);
    });

    it('rejects a zero or negative quantity', async () => {
      const code = await createItem(10);

      for (const qty of [0, -3]) {
        const response = await api.post(`/hr-stock/${code}/reserve`).send({ qty });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('qty');
      }
    });

    it('refuses to issue stock without naming who received it', async () => {
      const code = await createItem(10);

      const response = await api.post(`/hr-stock/${code}/issue`).send({ qty: 1 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('employeeName');
    });

    it('answers 404 for an item that does not exist', async () => {
      const response = await api.post('/hr-stock/NO-SUCH-ITEM/reserve').send({ qty: 1 });

      expect(response.status).toBe(404);
    });

    it('records every movement in the movement log', async () => {
      const code = await createItem(30);

      await api.post(`/hr-stock/${code}/reserve`).send({ qty: 3 }).expect(201);
      await api
        .post(`/hr-stock/${code}/issue`)
        .send({ qty: 2, employeeName: 'ผู้รับของทดสอบ' })
        .expect(201);

      const response = await api.get('/hr-stock/movements').query({ limit: 200 }).expect(200);
      const mine = listed(response.body).filter(
        (row) => String(row.erpItemCode ?? row.itemCode) === code,
      );

      expect(mine.length).toBeGreaterThanOrEqual(2);
    });
  });
});
