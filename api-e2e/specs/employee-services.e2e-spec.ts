/**
 * Employee services: the five modules an employee actually feels — the kit they
 * are issued (equipment requisitions), the points they earn (Organics points),
 * the birthday gift they choose, the training they watch, and the probation
 * they have to pass.
 *
 * The suite is arithmetic- and state-first. Each module is exercised along the
 * path the product walks it — issue, reserve, send, receive, return; add points
 * and read the balance back; pick a gift and watch the stock fall; pass three
 * probation rounds and be made permanent — because those are the facts people
 * act on. A status code alone proves nothing about whether the books balance.
 *
 * Three things shape most of what follows:
 *
 *   1. Equipment has two fulfilment modes. The tenant default is `erp`, where
 *      "send to the warehouse" talks to an external ERP over HTTP; `standalone`
 *      draws on the tenant's own `hr_stocks`. Every stock assertion here is made
 *      in `standalone`, and every endpoint that would call the ERP is skipped
 *      and named in the comments.
 *   2. A requisition row's mode is a snapshot taken at creation. Switching the
 *      organisation setting does not move rows that already exist, so each block
 *      creates its rows after it has set the mode it needs.
 *   3. Several of these controllers take untyped bodies (`equipment-category-config`,
 *      `organics-point-reasons`) or ignore a path parameter in favour of a body
 *      field. Where that leaves a real hole the test asserts the behaviour the
 *      endpoint should have and is marked `test.failing`, the house convention.
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
import {
  createApprovedJobPosting,
  createDepartment,
  createEmployee,
  createRecruitmentLink,
  submitApplication,
  type RecruitmentLinkFixture,
} from '../support/factories';

/** Well-formed UUID that belongs to nothing, for the 404 paths. */
const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

describe('Employee services (e2e)', () => {
  let api: ApiClient;
  let departmentId: string;
  /**
   * The employee row behind the logged-in HR user. Several endpoints here read
   * the caller's identity out of the token rather than from the URL — equipment
   * "confirm receipt", the probation evaluator check, the Organics operator —
   * so the suite needs it as a first-class value.
   */
  let actorEmployeeId: string;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();

    const department = await createDepartment(api);
    departmentId = department.id;

    actorEmployeeId = subjectOf((await hrUser()).token!);
  });

  afterAll(purgeTestTenantData);

  // ─── local helpers ─────────────────────────────────────────────────────────
  // These live in the spec rather than in support/factories: no other suite
  // needs them, and the factories are shared ground.

  /** The `sub` claim of a JWT, read without verifying — it is our own token. */
  function subjectOf(token: string): string {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
    ) as { sub?: string };
    if (!payload.sub) throw new Error('The HR token carries no `sub` claim');
    return payload.sub;
  }

  const newEmployee = () => createEmployee(api, { departmentId });

  const today = () => new Date().toISOString().slice(0, 10);

  // ═══════════════════════════════════════════════════════════════════════════
  // Equipment requisitions
  // ═══════════════════════════════════════════════════════════════════════════
  describe('equipment requisitions', () => {
    /**
     * A stock item in the tenant's own warehouse. Its code is what makes a
     * requisition row "physical": a row without one is refused outright, except
     * for IT access grants (see below).
     */
    const createStockItem = async (initialQty = 50): Promise<string> => {
      const response = await api.post('/hr-stock/items').send({
        nameTh: uniqueName('อุปกรณ์ทดสอบ'),
        nameEn: 'Test equipment',
        category: 'UNIFORM',
        section: 'uniform',
        unit: 'ชิ้น',
        initialQty,
      });
      if (response.status >= 300) {
        throw new Error(
          `Could not create a stock item (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      const code = response.body.erpItemCode ?? response.body.itemCode ?? response.body.code;
      if (!code) throw new Error(`Stock item fixture returned no code: ${JSON.stringify(response.body)}`);
      return String(code);
    };

    interface StockLevels {
      qtyOnHand: number;
      qtyReserved: number;
      availableQty: number;
    }

    const readStock = async (code: string): Promise<StockLevels> => {
      const response = await api.get('/hr-stock').query({ includeInactive: 'true' }).expect(200);
      const rows: any[] = Array.isArray(response.body)
        ? response.body
        : (response.body.items ?? response.body.data ?? []);
      const found = rows.find((row) => String(row.erpItemCode ?? row.itemCode) === code);
      if (!found) throw new Error(`Stock item ${code} is not in the list`);
      return {
        qtyOnHand: Number(found.qtyOnHand ?? 0),
        qtyReserved: Number(found.qtyReserved ?? 0),
        availableQty: Number(found.availableQty ?? 0),
      };
    };

    /** Switches the whole tenant between the `erp` and `standalone` flows. */
    const setFulfillmentMode = (mode: 'erp' | 'standalone') =>
      api.patch('/organization-settings').send({ equipmentFulfillmentMode: mode }).expect(200);

    const createRequisition = async (
      subjectId: string,
      overrides: Record<string, unknown> = {},
    ) => {
      const payload = {
        itemName: uniqueName('เสื้อยูนิฟอร์ม'),
        quantity: 1,
        category: 'uniform',
        ...overrides,
      };
      const response = await api.post(`/equipment-requisitions/subjects/${subjectId}`).send(payload);
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a requisition (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return { id: String(response.body.id), payload, body: response.body };
    };

    /** The row as the subject's own equipment page sees it. */
    const readRow = async (subjectId: string, id: string) => {
      const response = await api.get(`/equipment-requisitions/subjects/${subjectId}`).expect(200);
      return (response.body as any[]).find((row) => row.id === id);
    };

    // ── the row itself ───────────────────────────────────────────────────────
    describe('issuing a row', () => {
      it('creates a physical row as a draft that the subject page shows back', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();

        const { id, payload } = await createRequisition(employee.id, { erpItemCode, quantity: 2 });

        const row = await readRow(employee.id, id);
        expect(row).toMatchObject({
          itemName: payload.itemName,
          quantity: 2,
          category: 'uniform',
          // Nothing has been reserved or sent yet, so the row is a draft and the
          // employee has been promised nothing.
          batchStatus: 'draft',
        });
        // `item_received` is declared `type: 'tinyint'` on the entity
        // (equipment-requisition.entity.ts:148), so the driver hands it back as
        // 0/1 and it serialises as a number, not a JSON boolean.
        expect(Number(row.itemReceived)).toBe(0);
      });

      it('refuses a physical row with no stock code', async () => {
        const employee = await newEmployee();

        // A uniform row typed by hand would sit as a permanent draft: it can
        // neither be reserved nor sent, because nothing knows what to fetch.
        const response = await api
          .post(`/equipment-requisitions/subjects/${employee.id}`)
          .send({ itemName: 'เสื้อที่พิมพ์ชื่อเอง', category: 'uniform' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('รหัสสินค้า');
      });

      it('grants an IT access row immediately, with no receipt step', async () => {
        const employee = await newEmployee();

        // An IT row with no stock code is a system permission — an e-mail
        // account, a licence — which HR gives on the spot. It is the one case
        // where a missing item code is legitimate.
        const { id } = await createRequisition(employee.id, {
          itemName: 'บัญชีอีเมลบริษัท',
          category: 'it',
        });

        const row = await readRow(employee.id, id);
        expect(row.batchStatus).toBe('received');
        expect(Number(row.itemReceived)).toBe(1);
      });

      it('refuses a negative quantity', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();

        const response = await api
          .post(`/equipment-requisitions/subjects/${employee.id}`)
          .send({ itemName: 'ของติดลบ', quantity: -1, category: 'uniform', erpItemCode });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('quantity');
      });

      it('refuses a row with no item name', async () => {
        const employee = await newEmployee();

        const response = await api
          .post(`/equipment-requisitions/subjects/${employee.id}`)
          .send({ category: 'uniform' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('itemName');
      });

      it('answers 404 for a subject who is neither employee nor applicant', async () => {
        const response = await api
          .post(`/equipment-requisitions/subjects/${MISSING_ID}`)
          .send({ itemName: 'ของใครก็ไม่รู้', category: 'it' });

        expect(response.status).toBe(404);
      });

      it('edits a row in place, keeping its id and its issue date', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });
        const before = await readRow(employee.id, id);

        const renamed = uniqueName('เสื้อที่แก้ชื่อแล้ว');
        await api
          .patch(`/equipment-requisitions/${id}`)
          .send({ itemName: renamed, serialNumber: 'SN-0001', note: 'แก้ไขโดยชุดทดสอบ' })
          .expect(200);

        const after = await readRow(employee.id, id);
        // The edit must not re-stamp "เบิกเมื่อ": HR editing a typo would
        // otherwise look like the kit was issued again today.
        expect(after.id).toBe(before.id);
        expect(after.createdAt).toBe(before.createdAt);
        expect(after.itemName).toBe(renamed);
        expect(after.serialNumber).toBe('SN-0001');
      });

      it('answers 404 when editing a row that does not exist', async () => {
        const response = await api
          .patch(`/equipment-requisitions/${MISSING_ID}`)
          .send({ itemName: 'ไม่มีแถวนี้' });

        expect(response.status).toBe(404);
      });

      it('deletes a row and it leaves the subject page', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });

        await api.delete(`/equipment-requisitions/${id}`).expect(200);

        expect(await readRow(employee.id, id)).toBeUndefined();
      });

      it('answers 404 when deleting a row that does not exist', async () => {
        const response = await api.delete(`/equipment-requisitions/${MISSING_ID}`);

        expect(response.status).toBe(404);
      });
    });

    // ── the reading screens ──────────────────────────────────────────────────
    describe('the reading screens', () => {
      it('lists the row tenant-wide', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });

        const response = await api.get('/equipment-requisitions').expect(200);

        expect(response.body.map((row: { id: string }) => row.id)).toContain(id);
      });

      it('paginates the history and filters it to drafts', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id, payload } = await createRequisition(employee.id, { erpItemCode });

        const response = await api
          .get('/equipment-requisitions/history')
          .query({ page: 1, limit: 25, status: 'draft', search: payload.itemName })
          .expect(200);

        expect(response.body).toMatchObject({ page: 1, limit: 25 });
        expect(response.body.items.map((row: { id: string }) => row.id)).toEqual([id]);
        expect(response.body.total).toBe(1);
      });

      it('leaves a received row out of the draft filter', async () => {
        const employee = await newEmployee();
        // An IT access grant is born received, so it is the cheapest way to get
        // a non-draft row without walking the whole send/receive path.
        const { id, payload } = await createRequisition(employee.id, {
          itemName: uniqueName('สิทธิ์เข้าระบบ'),
          category: 'it',
        });

        const drafts = await api
          .get('/equipment-requisitions/history')
          .query({ status: 'draft', search: payload.itemName })
          .expect(200);
        expect(drafts.body.items).toHaveLength(0);

        const received = await api
          .get('/equipment-requisitions/history')
          .query({ status: 'received', search: payload.itemName })
          .expect(200);
        expect(received.body.items.map((row: { id: string }) => row.id)).toEqual([id]);
      });

      it('lists employees as requisition subjects with their item counts', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        await createRequisition(employee.id, { erpItemCode });

        // The list pages (25 by default, 100 at most) and orders by first name,
        // so the fixture is searched for rather than looked for on page one. The
        // rows are keyed by subjectId/employeeId — there is no `id` on them.
        const response = await api
          .get('/equipment-requisitions/subjects')
          .query({ page: 1, limit: 100, departmentId, search: employee.lastName })
          .expect(200);

        const found = response.body.items.find(
          (row: { employeeId: string }) => row.employeeId === employee.id,
        );
        expect(found).toBeDefined();
        expect(found.subjectId).toBe(employee.id);
        expect(found.itemCount).toBe(1);
        expect(response.body.page).toBe(1);
      });

      it('answers the header card of a subject', async () => {
        const employee = await newEmployee();

        const response = await api
          .get(`/equipment-requisitions/subjects/${employee.id}/profile`)
          .expect(200);

        expect(response.body).toMatchObject({
          subjectId: employee.id,
          employeeId: employee.id,
          // Nobody applied for a job here, so the recruitment side is empty —
          // the page still has to render for an ordinary employee.
          fromRecruitment: false,
        });
        expect(response.body.fullName).toContain(employee.firstName);
      });

      it('answers 404 for the profile of a subject that does not exist', async () => {
        const response = await api.get(`/equipment-requisitions/subjects/${MISSING_ID}/profile`);

        expect(response.status).toBe(404);
      });

      it("shows a submitted batch in HR's task feed", async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });

        // A row only becomes a "task" once it carries a warehouse document id.
        // The status is recorded as terminal on purpose: an open batch makes the
        // feed poll the ERP for a fresher status, which this suite must not do.
        await api
          .patch(`/equipment-requisitions/${id}/erp-mr`)
          .send({ mrId: 'MR-E2E-1', mrNumber: 'MR-E2E-0001', status: 'RECEIVED' })
          .expect(200);

        const response = await api
          .get('/equipment-requisitions/my-tasks')
          .query({ scope: 'all' })
          .expect(200);

        const task = response.body.find((row: { subjectId: string }) => row.subjectId === employee.id);
        expect(task).toMatchObject({
          category: 'uniform',
          itemCount: 1,
          erpMrId: 'MR-E2E-1',
          erpMrStatus: 'RECEIVED',
        });
      });

      it('answers 404 when linking a warehouse document to a row that does not exist', async () => {
        const response = await api
          .patch(`/equipment-requisitions/${MISSING_ID}/erp-mr`)
          .send({ mrId: 'MR-E2E-X' });

        expect(response.status).toBe(404);
      });

      it('writes one batch note across every row of a category', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const first = await createRequisition(employee.id, { erpItemCode });
        const second = await createRequisition(employee.id, { erpItemCode });
        await createRequisition(employee.id, { itemName: 'สิทธิ์อีเมล', category: 'it' });

        const response = await api
          .patch(`/equipment-requisitions/subjects/${employee.id}/batch-note/uniform`)
          .send({ note: '  รับที่ห้อง HR ชั้น 2  ' })
          .expect(200);

        // Only the uniform rows: the note belongs to a category batch, not to
        // the employee.
        expect(response.body.updated).toBe(2);
        expect((await readRow(employee.id, first.id)).batchNote).toBe('รับที่ห้อง HR ชั้น 2');
        expect((await readRow(employee.id, second.id)).batchNote).toBe('รับที่ห้อง HR ชั้น 2');
      });

      it('answers 404 for a batch note against a subject that does not exist', async () => {
        const response = await api
          .patch(`/equipment-requisitions/subjects/${MISSING_ID}/batch-note/uniform`)
          .send({ note: 'ไม่มีคนนี้' });

        expect(response.status).toBe(404);
      });
    });

    // ── the standalone warehouse flow ────────────────────────────────────────
    describe('the standalone flow: draft → reserved → sent → received', () => {
      /**
       * Everything in this block runs against the tenant's own `hr_stocks`,
       * where the arithmetic is observable. The mode is set before each row is
       * created because a row snapshots the mode it was born in.
       */
      beforeAll(async () => {
        await setFulfillmentMode('standalone');
      });

      afterAll(async () => {
        // Hand the tenant back on the product default so nothing after this
        // block inherits a mode it did not ask for.
        await setFulfillmentMode('erp');
      });

      it('reserves exactly the quantity asked for, and no more on a second press', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem(40);
        const { id } = await createRequisition(employee.id, { erpItemCode, quantity: 3 });
        const before = await readStock(erpItemCode);

        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        const afterFirst = await readStock(erpItemCode);

        expect(afterFirst.qtyOnHand).toBe(before.qtyOnHand);
        expect(afterFirst.qtyReserved).toBe(before.qtyReserved + 3);
        expect(afterFirst.availableQty).toBe(before.availableQty - 3);

        // Reserving again tops up only what is missing — HR double-clicking the
        // button must not lock away six shirts for a request for three.
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        expect(await readStock(erpItemCode)).toEqual(afterFirst);
      });

      it('refuses to reserve more than the warehouse holds', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem(2);
        const { id } = await createRequisition(employee.id, { erpItemCode, quantity: 5 });

        const response = await api.patch(`/equipment-requisitions/${id}/reserve`);

        expect(response.status).toBe(400);
        expect((await readStock(erpItemCode)).qtyReserved).toBe(0);
      });

      it('refuses a QR before the goods have been reserved', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });

        // The reservation is the only thing standing between "HR printed a QR"
        // and "the shelf is empty when the employee turns up".
        const response = await api.patch(`/equipment-requisitions/${id}/generate-qr`);

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('จองของจากคลัง');
        expect((await readRow(employee.id, id)).batchStatus).toBe('draft');
      });

      it('refuses to send a category batch that is not fully reserved', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        await createRequisition(employee.id, { erpItemCode });

        const response = await api.patch(
          `/equipment-requisitions/subjects/${employee.id}/send/uniform`,
        );

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('จองของจากคลัง');
      });

      it('issues one QR token per row and keeps it across a re-press', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);

        const first = await api.patch(`/equipment-requisitions/${id}/generate-qr`).expect(200);
        expect(first.body.qrToken).toBeTruthy();
        expect((await readRow(employee.id, id)).batchStatus).toBe('sent');

        // A re-press must return the same token: the employee may already be
        // holding a printed copy of it.
        const second = await api.patch(`/equipment-requisitions/${id}/generate-qr`).expect(200);
        expect(second.body.qrToken).toBe(first.body.qrToken);
      });

      it('sends a reserved batch and marks its rows sent', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);

        const response = await api
          .patch(`/equipment-requisitions/subjects/${employee.id}/send/uniform`)
          .expect(200);

        expect(response.body.find((row: { id: string }) => row.id === id).batchStatus).toBe('sent');
      });

      it('confirms receipt of the sent batch for the employee themself', async () => {
        // The confirm endpoint reads the employee out of the token, so the only
        // employee this suite can confirm for is the HR user's own record.
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(actorEmployeeId, { erpItemCode });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        await api.patch(`/equipment-requisitions/subjects/${actorEmployeeId}/send/uniform`).expect(200);

        await api.patch('/equipment-requisitions/my/receive/uniform').expect(200);

        const row = await readRow(actorEmployeeId, id);
        expect(row.batchStatus).toBe('received');
        expect(Number(row.itemReceived)).toBe(1);
        expect(row.receivedByEmployeeId).toBe(actorEmployeeId);
      });

      it('refuses a new QR for a row the employee already has', async () => {
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(actorEmployeeId, {
          erpItemCode,
          itemName: uniqueName('ของที่รับไปแล้ว'),
        });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        await api.patch(`/equipment-requisitions/${id}/generate-qr`).expect(200);
        await api.patch('/equipment-requisitions/my/receive/uniform').expect(200);

        // `received` is terminal on the outward path. Minting a second QR for a
        // row already handed over would let the same shirt be collected twice.
        const response = await api.patch(`/equipment-requisitions/${id}/generate-qr`);

        expect(response.status).toBe(400);
        expect((await readRow(actorEmployeeId, id)).batchStatus).toBe('received');
      });

      it('refuses to reserve a row the employee already has', async () => {
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(actorEmployeeId, {
          erpItemCode,
          itemName: uniqueName('ของที่จองไม่ได้แล้ว'),
        });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        await api.patch(`/equipment-requisitions/${id}/generate-qr`).expect(200);
        await api.patch('/equipment-requisitions/my/receive/uniform').expect(200);

        const response = await api.patch(`/equipment-requisitions/${id}/reserve`);

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('จ่ายของให้พนักงานไปแล้ว');
      });

      it('refuses a return for a row that was never received', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);

        // A state may not be skipped: there is nothing to give back until the
        // employee has confirmed they took it.
        const response = await api.post(`/equipment-requisitions/${id}/return`);

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('ยืนยันรับแล้ว');
      });

      it('returns a received row straight back into the HR warehouse', async () => {
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(actorEmployeeId, {
          erpItemCode,
          itemName: uniqueName('ของที่จะคืน'),
        });
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        await api.patch(`/equipment-requisitions/${id}/generate-qr`).expect(200);
        await api.patch('/equipment-requisitions/my/receive/uniform').expect(200);

        const response = await api.post(`/equipment-requisitions/${id}/return`).expect(201);

        // Standalone has no second warehouse to ask, so the return is final the
        // moment it is made — no 'pending' step.
        expect(response.body.returnStatus).toBe('approved');

        const second = await api.post(`/equipment-requisitions/${id}/return`);
        expect(second.status).toBe(400);
        expect(JSON.stringify(second.body)).toContain('คืน');
      });

      it('answers 404 for a return against a row that does not exist', async () => {
        const response = await api.post(`/equipment-requisitions/${MISSING_ID}/return`);

        expect(response.status).toBe(404);
      });

      it('releases the reservation when the row is deleted', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem(30);
        const { id } = await createRequisition(employee.id, { erpItemCode, quantity: 4 });
        const before = await readStock(erpItemCode);
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);

        await api.delete(`/equipment-requisitions/${id}`).expect(200);

        // Goods held for a request that no longer exists are goods nobody can
        // ever draw — the books have to come back to where they started.
        expect(await readStock(erpItemCode)).toEqual(before);
      });

      it('releases the reservation when the quantity is edited', async () => {
        const employee = await newEmployee();
        const erpItemCode = await createStockItem(30);
        const { id } = await createRequisition(employee.id, { erpItemCode, quantity: 4 });
        const before = await readStock(erpItemCode);
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);

        await api.patch(`/equipment-requisitions/${id}`).send({ quantity: 2 }).expect(200);

        // The old reservation no longer matches the request, so it is dropped
        // whole and HR reserves again — safer than guessing the delta.
        expect(await readStock(erpItemCode)).toEqual(before);
      });

      test.failing('deducts the goods from stock when the employee confirms receipt', async () => {
        // Defect: `receivedByEmployee` (equipment-requisitions.service.ts ~831)
        // marks the rows received and then calls `callErpStockTransfer` — the
        // ERP path — regardless of the row's fulfilment mode. It never calls
        // `issueFromHrStock`, which is what `scanReceive` uses for standalone
        // rows. So on this route the goods are handed over, the reservation is
        // never converted into an issue, and `hr_stocks` keeps showing the item
        // as both on hand and reserved forever.
        const erpItemCode = await createStockItem(20);
        const { id } = await createRequisition(actorEmployeeId, {
          erpItemCode,
          quantity: 2,
          itemName: uniqueName('ของที่ต้องตัดสต็อก'),
        });
        const before = await readStock(erpItemCode);
        await api.patch(`/equipment-requisitions/${id}/reserve`).expect(200);
        await api.patch(`/equipment-requisitions/subjects/${actorEmployeeId}/send/uniform`).expect(200);

        await api.patch('/equipment-requisitions/my/receive/uniform').expect(200);

        const after = await readStock(erpItemCode);
        expect(after.qtyOnHand).toBe(before.qtyOnHand - 2);
        expect(after.qtyReserved).toBe(before.qtyReserved);
      });
    });

    // ── the ERP-mode guards we can assert without calling the ERP ────────────
    describe('the ERP mode', () => {
      it('refuses a warehouse reservation on an ERP-mode row', async () => {
        // The tenant default is `erp`, where the goods live in someone else's
        // warehouse: there is nothing local to reserve.
        const employee = await newEmployee();
        const erpItemCode = await createStockItem();
        const { id } = await createRequisition(employee.id, { erpItemCode });

        const response = await api.patch(`/equipment-requisitions/${id}/reserve`);

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('ERP');
      });

      it('answers 404 when reserving a row that does not exist', async () => {
        const response = await api.patch(`/equipment-requisitions/${MISSING_ID}/reserve`);

        expect(response.status).toBe(404);
      });

      it('answers 404 when generating a QR for a row that does not exist', async () => {
        const response = await api.patch(`/equipment-requisitions/${MISSING_ID}/generate-qr`);

        expect(response.status).toBe(404);
      });
    });

    // ── item → section configuration ─────────────────────────────────────────
    describe('category configuration', () => {
      it('assigns an item to a section and lists it back', async () => {
        const erpItemCode = await createStockItem();

        const saved = await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'it' }] })
          .expect(200);

        expect(
          saved.body.find((row: { erpItemCode: string }) => row.erpItemCode === erpItemCode).section,
        ).toBe('it');

        const listed = await api.get('/equipment-category-config').expect(200);
        expect(listed.body.map((row: { erpItemCode: string }) => row.erpItemCode)).toContain(
          erpItemCode,
        );
      });

      it('moves an item between sections without creating a second row', async () => {
        const erpItemCode = await createStockItem();
        await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'uniform' }] })
          .expect(200);

        const response = await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'it' }] })
          .expect(200);

        const rows = response.body.filter(
          (row: { erpItemCode: string }) => row.erpItemCode === erpItemCode,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].section).toBe('it');
      });

      it('unassigns an item when the section is cleared', async () => {
        const erpItemCode = await createStockItem();
        await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'it' }] })
          .expect(200);

        const response = await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: null }] })
          .expect(200);

        expect(response.body.map((row: { erpItemCode: string }) => row.erpItemCode)).not.toContain(
          erpItemCode,
        );
      });

      it('accepts an empty body as "change nothing"', async () => {
        // The config screen saves the whole form; an untouched form posts no
        // items and must not be an error.
        const response = await api.put('/equipment-category-config').send({}).expect(200);

        expect(Array.isArray(response.body)).toBe(true);
      });

      test.failing('refuses an unknown section instead of silently unassigning', async () => {
        // Defect: `save` (equipment-category-config.service.ts ~46) treats any
        // section outside {uniform, it} as "unassign" and deletes the row. The
        // body is an untyped `{ items?: CategoryConfigInput[] }` with no DTO, so
        // a typo such as 'IT' — or a renamed section from a newer client — does
        // not fail: it quietly drops the assignment and the item disappears from
        // both requisition screens with a 200 in the response.
        const erpItemCode = await createStockItem();
        await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'it' }] })
          .expect(200);

        const response = await api
          .put('/equipment-category-config')
          .send({ items: [{ erpItemCode, section: 'IT' }] });

        expect(response.status).toBe(400);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Organics points
  // ═══════════════════════════════════════════════════════════════════════════
  describe('organics points', () => {
    /**
     * Awards or docks points and returns the transaction the API produced.
     * `operatorId` is a free string on the DTO but is read back as the HR user
     * who acted, so the suite always sends its own employee id.
     */
    const award = async (overrides: Record<string, unknown> = {}) => {
      const payload = {
        type: 'add',
        points: 10,
        reason: 'ทดสอบระบบแต้ม',
        operatorId: actorEmployeeId,
        ...overrides,
      };
      const response = await api.post('/organics-points/transactions').send(payload);
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a points transaction (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return { id: String(response.body.id), body: response.body, payload };
    };

    /** The employee's row on the points board — `id` here is the balance id. */
    const readBoardRow = async (employeeId: string) => {
      const response = await api
        .get('/organics-points/employees')
        .query({ limit: 200 })
        .expect(200);
      return (response.body.data as any[]).find((row) => row.employeeDbId === employeeId);
    };

    const balanceIdOf = async (employeeId: string): Promise<string> => {
      const row = await readBoardRow(employeeId);
      if (!row) throw new Error(`Employee ${employeeId} has no points balance yet`);
      return String(row.id);
    };

    describe('awarding and docking points', () => {
      it('moves the balance by exactly the points awarded and records the history', async () => {
        const employee = await newEmployee();

        const { id } = await award({ employeeIds: [employee.id], points: 10 });

        const row = await readBoardRow(employee.id);
        expect(row.totalPoints).toBe(10);

        const history = await api
          .get(`/organics-points/employees/${row.id}/history`)
          .expect(200);
        // The ledger is the record of account: a balance with no row behind it
        // is a number nobody can explain to the employee.
        expect(history.body.history).toHaveLength(1);
        // `getEmployeeHistory` maps the stored 'add'/'subtract' to the Thai
        // label the screen prints (organics-points.service.ts ~1540).
        expect(history.body.history[0]).toMatchObject({
          action: 'เพิ่ม',
          amount: 10,
          pointsBefore: 0,
          pointsAfter: 10,
        });
        expect(history.body.employee.currentPoints).toBe(10);
        expect(history.body.summary).toMatchObject({ totalAdded: 10, totalSubtracted: 0 });

        const detail = await api.get(`/organics-points/transactions/${id}`).expect(200);
        expect(detail.body.employeeCount).toBe(1);
        expect(detail.body.employees[0]).toMatchObject({ pointsBefore: 0, pointsAfter: 10 });
      });

      it('adds a second award on top rather than replacing it', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 10 });

        await award({ employeeIds: [employee.id], points: 5 });

        expect((await readBoardRow(employee.id)).totalPoints).toBe(15);
      });

      it('docks points and leaves the difference', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 20 });

        await award({ employeeIds: [employee.id], type: 'subtract', points: 8, reason: 'มาสาย' });

        const row = await readBoardRow(employee.id);
        expect(row.totalPoints).toBe(12);

        const history = await api.get(`/organics-points/employees/${row.id}/history`).expect(200);
        expect(history.body.summary).toMatchObject({ totalAdded: 20, totalSubtracted: 8 });
      });

      it('awards the same points to everyone named in one transaction', async () => {
        const first = await newEmployee();
        const second = await newEmployee();

        const { body } = await award({ employeeIds: [first.id, second.id], points: 7 });

        expect(body.employeeCount).toBe(2);
        expect((await readBoardRow(first.id)).totalPoints).toBe(7);
        expect((await readBoardRow(second.id)).totalPoints).toBe(7);
      });

      it('refuses to dock more points than the employee holds', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 3 });

        const response = await api.post('/organics-points/transactions').send({
          type: 'subtract',
          points: 10,
          reason: 'หักเกินยอด',
          employeeIds: [employee.id],
          operatorId: actorEmployeeId,
        });

        // A negative balance is not a thing the product can explain, so the
        // whole transaction is refused rather than clamped.
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('ไม่เพียงพอ');
        expect((await readBoardRow(employee.id)).totalPoints).toBe(3);
      });

      it('refuses a transaction naming an employee of another tenant', async () => {
        const response = await api.post('/organics-points/transactions').send({
          type: 'add',
          points: 5,
          reason: 'ข้ามบริษัท',
          employeeIds: [MISSING_ID],
          operatorId: actorEmployeeId,
        });

        expect(response.status).toBe(400);
      });

      it('refuses zero points', async () => {
        const employee = await newEmployee();

        const response = await api.post('/organics-points/transactions').send({
          type: 'add',
          points: 0,
          reason: 'ศูนย์แต้ม',
          employeeIds: [employee.id],
          operatorId: actorEmployeeId,
        });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('points');
      });

      it('refuses a transaction with no reason', async () => {
        const employee = await newEmployee();

        const response = await api.post('/organics-points/transactions').send({
          type: 'add',
          points: 5,
          employeeIds: [employee.id],
          operatorId: actorEmployeeId,
        });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('reason');
      });

      it('refuses an unknown transaction type', async () => {
        const employee = await newEmployee();

        const response = await api.post('/organics-points/transactions').send({
          type: 'multiply',
          points: 5,
          reason: 'ชนิดที่ไม่มีอยู่',
          employeeIds: [employee.id],
          operatorId: actorEmployeeId,
        });

        expect(response.status).toBe(400);
      });
    });

    describe('the quick edit on the points board', () => {
      it('adds points to a balance and leaves a history row behind', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 10 });
        const balanceId = await balanceIdOf(employee.id);

        await api
          .patch(`/organics-points/employees/${employee.id}/points`)
          .send({
            balanceId,
            type: 'add',
            points: 4,
            reason: 'ช่วยงานกิจกรรม',
            operatorId: actorEmployeeId,
          })
          .expect(200);

        expect((await readBoardRow(employee.id)).totalPoints).toBe(14);
        const history = await api.get(`/organics-points/employees/${balanceId}/history`).expect(200);
        expect(history.body.history).toHaveLength(2);
        // Both rows are written in the same second and the ledger is ordered by
        // createdAt alone, so the quick edit is located by what it did, not by
        // its position. `action` is the Thai label the screen prints, not the
        // stored code (organics-points.service.ts ~1540).
        const quickEdit = (history.body.history as any[]).find((row) => row.pointsAfter === 14);
        expect(quickEdit).toMatchObject({
          action: 'เพิ่ม',
          amount: 4,
          pointsBefore: 10,
          pointsAfter: 14,
        });
      });

      it('sets a balance to an exact figure', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 10 });
        const balanceId = await balanceIdOf(employee.id);

        await api
          .patch(`/organics-points/employees/${employee.id}/points`)
          .send({
            balanceId,
            type: 'set',
            points: 25,
            reason: 'ปรับยอดตามเอกสาร',
            operatorId: actorEmployeeId,
          })
          .expect(200);

        // 'set' is stored as the difference it made, so the ledger still adds up
        // to the new figure rather than jumping without explanation.
        expect((await readBoardRow(employee.id)).totalPoints).toBe(25);
        const history = await api.get(`/organics-points/employees/${balanceId}/history`).expect(200);
        // The ledger is ordered by createdAt alone, and both rows land in the
        // same second, so the adjustment is looked up by what it did rather
        // than by its position in the list.
        const adjustment = (history.body.history as any[]).find((row) => row.pointsAfter === 25);
        expect(adjustment).toMatchObject({ pointsBefore: 10, pointsAfter: 25, amount: 15 });
      });

      it('refuses to subtract past zero', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 2 });
        const balanceId = await balanceIdOf(employee.id);

        const response = await api
          .patch(`/organics-points/employees/${employee.id}/points`)
          .send({
            balanceId,
            type: 'subtract',
            points: 9,
            reason: 'หักเกิน',
            operatorId: actorEmployeeId,
          });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('Insufficient');
        expect((await readBoardRow(employee.id)).totalPoints).toBe(2);
      });

      it('answers 404 for a balance that does not exist', async () => {
        const employee = await newEmployee();

        const response = await api
          .patch(`/organics-points/employees/${employee.id}/points`)
          .send({
            balanceId: MISSING_ID,
            type: 'add',
            points: 1,
            reason: 'ไม่มียอดนี้',
            operatorId: actorEmployeeId,
          });

        expect(response.status).toBe(404);
      });

      it('refuses a quick edit with no operator', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 5 });
        const balanceId = await balanceIdOf(employee.id);

        // Who moved someone's points is not optional — it is the whole audit.
        const response = await api
          .patch(`/organics-points/employees/${employee.id}/points`)
          .send({ balanceId, type: 'add', points: 1, reason: 'ไม่ระบุผู้ทำรายการ' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('operatorId');
      });

      test.failing('refuses a quick edit whose balance belongs to another employee', async () => {
        // Defect: the controller takes `:employeeId` on the URL and then ignores
        // it — `updateEmployeePoints` (organics-points.service.ts ~1616) resolves
        // the row from `dto.balanceId` alone. The board sends both, so a stale
        // row on screen, or a mismatched pair from any client, silently moves a
        // different person's points and reports success against the employee in
        // the URL. Correct behaviour is to refuse the mismatch outright.
        const target = await newEmployee();
        const bystander = await newEmployee();
        await award({ employeeIds: [target.id, bystander.id], points: 10 });
        const bystanderBalanceId = await balanceIdOf(bystander.id);

        const response = await api
          .patch(`/organics-points/employees/${target.id}/points`)
          .send({
            balanceId: bystanderBalanceId,
            type: 'add',
            points: 50,
            reason: 'ยอดไม่ตรงกับพนักงานบน URL',
            operatorId: actorEmployeeId,
          });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect((await readBoardRow(bystander.id)).totalPoints).toBe(10);
      });
    });

    describe('the reading screens', () => {
      it('sums the tenant total on the dashboard', async () => {
        const employee = await newEmployee();
        const before = await api.get('/organics-points/dashboard').expect(200);

        await award({ employeeIds: [employee.id], points: 11 });

        const after = await api.get('/organics-points/dashboard').expect(200);
        expect(after.body.totalPoints).toBe(before.body.totalPoints + 11);
        expect(after.body.totalEmployees).toBe(before.body.totalEmployees + 1);
      });

      it('lists an employee with no points at all under employees/all', async () => {
        const employee = await newEmployee();

        const response = await api
          .get('/organics-points/employees/all')
          .query({ limit: 500 })
          .expect(200);

        // The picker for "who gets points" has to show people who have never
        // had any — otherwise nobody can ever be given their first.
        expect(
          (response.body.data as any[]).some(
            (row) => row.employeeDbId === employee.id || row.id === employee.id,
          ),
        ).toBe(true);
      });

      it('pages the transaction list and reports its running totals', async () => {
        const employee = await newEmployee();
        await award({ employeeIds: [employee.id], points: 6 });

        const response = await api
          .get('/organics-points/transactions')
          .query({ page: 1, limit: 10 })
          .expect(200);

        expect(response.body.pagination).toMatchObject({ page: 1, limit: 10 });
        expect(response.body.summary.netChange).toBe(
          response.body.summary.totalAdded - response.body.summary.totalSubtracted,
        );
      });

      it('answers 404 for a transaction that does not exist', async () => {
        const response = await api.get(`/organics-points/transactions/${MISSING_ID}`);

        expect(response.status).toBe(404);
      });

      it('answers 404 for the history of a balance that does not exist', async () => {
        const response = await api.get(`/organics-points/employees/${MISSING_ID}/history`);

        expect(response.status).toBe(404);
      });

      it('refuses a page number that is not a number', async () => {
        const response = await api
          .get('/organics-points/transactions')
          .query({ page: 'first' });

        expect(response.status).toBe(400);
      });
    });

    describe('QR codes', () => {
      const createQr = async (overrides: Record<string, unknown> = {}) => {
        const response = await api.post('/organics-points/qr-codes').send({
          points: 5,
          reason: 'สแกนรับแต้มกิจกรรม',
          ...overrides,
        });
        if (response.status >= 300 || !response.body?.id) {
          throw new Error(
            `Could not create a QR code (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
          );
        }
        return response.body as { id: string; token: string; isActive: boolean; points: number };
      };

      it('creates an active QR and lists it', async () => {
        const qr = await createQr({ points: 5, scanRepeatPolicy: 'once_per_day' });

        const response = await api.get('/organics-points/qr-codes').expect(200);

        const found = response.body.find((row: { id: string }) => row.id === qr.id);
        expect(found).toMatchObject({
          points: 5,
          type: 'add',
          scanRepeatPolicy: 'once_per_day',
          isActive: true,
        });
        expect(found.token).toBeTruthy();
      });

      it('deactivates a QR rather than deleting it', async () => {
        const qr = await createQr();

        await api.delete(`/organics-points/qr-codes/${qr.id}`).expect(200);

        const response = await api.get('/organics-points/qr-codes').expect(200);
        const found = response.body.find((row: { id: string }) => row.id === qr.id);
        // The code stays on file: the points it already gave out have to remain
        // explainable after the campaign ends.
        expect(found).toBeDefined();
        expect(found.isActive).toBe(false);
      });

      it('answers 404 when deactivating a QR that does not exist', async () => {
        const response = await api.delete(`/organics-points/qr-codes/${MISSING_ID}`);

        expect(response.status).toBe(404);
      });

      it('refuses a QR worth no points', async () => {
        const response = await api
          .post('/organics-points/qr-codes')
          .send({ points: 0, reason: 'ไม่มีแต้ม' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('points');
      });

      it('refuses an active window that is not HH:MM', async () => {
        const response = await api.post('/organics-points/qr-codes').send({
          points: 5,
          reason: 'เวลาไม่ถูกต้อง',
          activeStartTime: '8am',
          activeEndTime: '17:00',
        });

        expect(response.status).toBe(400);
      });
    });

    describe('the reason catalogue', () => {
      const createReason = async (overrides: Record<string, unknown> = {}) => {
        const response = await api.post('/organics-point-reasons').send({
          label: uniqueName('เหตุผลทดสอบ'),
          type: 'add',
          color: 'green',
          ...overrides,
        });
        if (response.status >= 300 || !response.body?.id) {
          throw new Error(
            `Could not create a reason (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
          );
        }
        return response.body as { id: string; label: string; sortOrder: number; type: string };
      };

      it('seeds the standard reasons the first time the screen is opened', async () => {
        const response = await api.get('/organics-point-reasons').expect(200);

        // A tenant that has never configured anything must still see the
        // choices the product ships with, not an empty screen.
        expect(response.body.length).toBeGreaterThanOrEqual(12);
        expect(response.body.map((row: { label: string }) => row.label)).toContain('ทำความดี');
      });

      it('filters the dropdown to the reasons that apply to the screen in use', async () => {
        const response = await api
          .get('/organics-point-reasons')
          .query({ activeOnly: 'true', type: 'subtract' })
          .expect(200);

        // 'both' reasons belong on either screen; 'add' ones never on this one.
        expect(
          response.body.every((row: { type: string }) => row.type === 'subtract' || row.type === 'both'),
        ).toBe(true);
        expect(response.body.every((row: { isActive: boolean }) => row.isActive)).toBe(true);
      });

      it('creates a reason at the end of the list', async () => {
        const before = await api.get('/organics-point-reasons').expect(200);

        const created = await createReason();

        const after = await api.get('/organics-point-reasons').expect(200);
        expect(after.body).toHaveLength(before.body.length + 1);
        expect(after.body[after.body.length - 1].id).toBe(created.id);
      });

      it('renames a reason', async () => {
        const reason = await createReason();
        const label = uniqueName('เหตุผลที่แก้ชื่อ');

        const response = await api
          .patch(`/organics-point-reasons/${reason.id}`)
          .send({ label, isActive: false })
          .expect(200);

        expect(response.body).toMatchObject({ label, isActive: false });
      });

      it('refuses a second reason with a label already in use', async () => {
        const reason = await createReason();

        const response = await api.post('/organics-point-reasons').send({ label: reason.label });

        // Two identical labels in a dropdown means someone picks the wrong one
        // and nobody can tell afterwards.
        expect(response.status).toBe(400);
      });

      it('refuses a reason with a blank label', async () => {
        const response = await api.post('/organics-point-reasons').send({ label: '   ' });

        expect(response.status).toBe(400);
      });

      it('reorders the list and the new order sticks', async () => {
        const first = await createReason();
        const second = await createReason();

        const response = await api
          .patch('/organics-point-reasons/reorder')
          .send({ ids: [second.id, first.id] })
          .expect(200);

        expect(response.body.updated).toBe(2);
        const listed = await api.get('/organics-point-reasons').expect(200);
        const order = listed.body.map((row: { id: string }) => row.id);
        expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(first.id));
      });

      it('ignores ids that belong to no reason of this tenant', async () => {
        const response = await api
          .patch('/organics-point-reasons/reorder')
          .send({ ids: [MISSING_ID] })
          .expect(200);

        expect(response.body.updated).toBe(0);
      });

      it('hides a deleted reason but keeps the row for old history', async () => {
        const reason = await createReason();

        await api.delete(`/organics-point-reasons/${reason.id}`).expect(200);

        const response = await api.get('/organics-point-reasons').expect(200);
        expect(response.body.map((row: { id: string }) => row.id)).not.toContain(reason.id);
      });

      it('answers 404 for a reason that does not exist', async () => {
        await api.patch(`/organics-point-reasons/${MISSING_ID}`).send({ label: 'x' }).expect(404);
        await api.delete(`/organics-point-reasons/${MISSING_ID}`).expect(404);
      });

      test.failing('refuses an unknown reason type instead of storing "both"', async () => {
        // Defect: `CreateOrganicsPointReasonDto` is a TypeScript interface, so
        // the global ValidationPipe has no metadata and checks nothing.
        // `normalizeType` (organics-point-reasons.service.ts ~215) then maps any
        // unrecognised value to 'both', so a typo does not fail — it produces a
        // reason that shows up on both the add and the subtract screen.
        const response = await api
          .post('/organics-point-reasons')
          .send({ label: uniqueName('ชนิดผิด'), type: 'increase' });

        expect(response.status).toBe(400);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Birthday gifts
  // ═══════════════════════════════════════════════════════════════════════════
  describe('birthday gifts', () => {
    const createCategory = async (overrides: Record<string, unknown> = {}) => {
      const response = await api.post('/birthday-gift-categories').send({
        name: uniqueName('หมวดของขวัญ').slice(0, 80),
        description: 'หมวดสำหรับชุดทดสอบ',
        ...overrides,
      });
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a gift category (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return response.body as { id: string; name: string };
    };

    const createGift = async (overrides: Record<string, unknown> = {}) => {
      const response = await api.post('/birthday-gifts').send({
        name: uniqueName('ของขวัญวันเกิด').slice(0, 150),
        quantity: 5,
        ...overrides,
      });
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a gift (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return response.body as { id: string; name: string; quantity: number };
    };

    const stockOf = async (giftId: string): Promise<number> =>
      Number((await api.get(`/birthday-gifts/${giftId}`).expect(200)).body.quantity);

    /**
     * An employee whose birthday is today.
     *
     * Selection opens `birthdayGiftAdvanceDays` before the birthday and closes
     * the day after it, so "today" is the one date that is inside the window
     * whatever the tenant has configured.
     */
    const birthdayEmployee = async (): Promise<{ id: string }> => {
      const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
      const birthDate = `1990-${today().slice(5)}`;
      const payload = {
        firstName: 'ทดสอบ',
        lastName: `วันเกิด${suffix}`,
        email: `e2e.bd.${suffix}@example.test`,
        startDate: '2024-01-01',
        departmentId,
        birthDate,
      };
      const response = await api.post('/employees').send(payload);
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a birthday employee (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return { id: String(response.body.id) };
    };

    describe('the gift catalogue', () => {
      it('creates a gift with its opening stock and lists it', async () => {
        const category = await createCategory();

        const gift = await createGift({ quantity: 12, categoryId: category.id });

        const response = await api.get('/birthday-gifts').expect(200);
        const found = response.body.find((row: { id: string }) => row.id === gift.id);
        expect(found).toMatchObject({ quantity: 12, isActive: true });
        expect(found.category.id).toBe(category.id);
      });

      it('records a stock adjustment in the gift history', async () => {
        const gift = await createGift({ quantity: 5 });

        await api
          .patch(`/birthday-gifts/${gift.id}`)
          .send({ quantity: 9, reason: 'รับของเพิ่มจากซัพพลายเออร์' })
          .expect(200);

        const history = await api.get(`/birthday-gifts/${gift.id}/stock-history`).expect(200);
        expect(history.body[0]).toMatchObject({
          type: 'manual_increase',
          delta: 4,
          quantityBefore: 5,
          quantityAfter: 9,
          reason: 'รับของเพิ่มจากซัพพลายเออร์',
        });
        expect(await stockOf(gift.id)).toBe(9);
      });

      it('leaves no history row when the quantity did not change', async () => {
        const gift = await createGift({ quantity: 5 });

        await api.patch(`/birthday-gifts/${gift.id}`).send({ description: 'แก้คำอธิบาย' }).expect(200);

        const history = await api.get(`/birthday-gifts/${gift.id}/stock-history`).expect(200);
        expect(history.body).toHaveLength(0);
      });

      it('refuses a second gift with a name already in use', async () => {
        const gift = await createGift();

        const response = await api.post('/birthday-gifts').send({ name: gift.name, quantity: 1 });

        expect(response.status).toBe(409);
      });

      it('refuses a negative stock figure', async () => {
        const response = await api
          .post('/birthday-gifts')
          .send({ name: uniqueName('ของติดลบ'), quantity: -1 });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('quantity');
      });

      it('refuses a gift with no name', async () => {
        const response = await api.post('/birthday-gifts').send({ quantity: 1 });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('name');
      });

      it('deletes a gift', async () => {
        const gift = await createGift();

        await api.delete(`/birthday-gifts/${gift.id}`).expect(200);

        await api.get(`/birthday-gifts/${gift.id}`).expect(404);
      });

      it('answers 404 for a gift that does not exist and 400 for a malformed id', async () => {
        await api.get(`/birthday-gifts/${MISSING_ID}`).expect(404);
        await api.patch(`/birthday-gifts/${MISSING_ID}`).send({ quantity: 1 }).expect(404);
        await api.delete(`/birthday-gifts/${MISSING_ID}`).expect(404);
        // The route pins the id as a UUID, so a junk id is a bad request rather
        // than a miss.
        await api.get('/birthday-gifts/not-a-uuid').expect(400);
      });
    });

    describe('gift categories', () => {
      it('creates, reads, renames and deletes a category', async () => {
        const category = await createCategory();

        const listed = await api.get('/birthday-gift-categories').expect(200);
        expect(listed.body.map((row: { id: string }) => row.id)).toContain(category.id);

        const renamed = uniqueName('หมวดที่แก้ชื่อ').slice(0, 80);
        const updated = await api
          .patch(`/birthday-gift-categories/${category.id}`)
          .send({ name: renamed, isActive: false })
          .expect(200);
        expect(updated.body).toMatchObject({ name: renamed, isActive: false });

        await api.delete(`/birthday-gift-categories/${category.id}`).expect(200);
        await api.get(`/birthday-gift-categories/${category.id}`).expect(404);
      });

      it('refuses a category with no name', async () => {
        const response = await api.post('/birthday-gift-categories').send({ description: 'ไม่มีชื่อ' });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('name');
      });

      it('answers 404 for a category that does not exist', async () => {
        await api.get(`/birthday-gift-categories/${MISSING_ID}`).expect(404);
        await api.patch(`/birthday-gift-categories/${MISSING_ID}`).send({ name: 'x' }).expect(404);
        await api.delete(`/birthday-gift-categories/${MISSING_ID}`).expect(404);
      });
    });

    describe('choosing a gift', () => {
      const chooseGift = async (employeeId: string, giftId: string) => {
        const response = await api
          .post('/birthday-gift-selections')
          .send({ employeeId, birthdayGiftId: giftId });
        if (response.status >= 300 || !response.body?.id) {
          throw new Error(
            `Could not create a gift selection (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
          );
        }
        return response.body as { id: string; status: string };
      };

      it('takes exactly one item off the shelf and says where it went', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift({ quantity: 5 });

        const selection = await chooseGift(employee.id, gift.id);

        // One gift chosen is one gift gone: the stock figure is what HR orders
        // replacements from.
        expect(await stockOf(gift.id)).toBe(4);
        const history = await api.get(`/birthday-gifts/${gift.id}/stock-history`).expect(200);
        expect(history.body[0]).toMatchObject({
          type: 'selection',
          delta: -1,
          quantityBefore: 5,
          quantityAfter: 4,
          referenceId: selection.id,
        });
        expect(history.body[0].employee.id).toBe(employee.id);
      });

      it('puts the item back when the selection is cancelled', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift({ quantity: 5 });
        const selection = await chooseGift(employee.id, gift.id);

        await api.delete(`/birthday-gift-selections/${selection.id}`).expect(200);

        expect(await stockOf(gift.id)).toBe(5);
      });

      it('moves the stock between two gifts when the choice is changed', async () => {
        const employee = await birthdayEmployee();
        const first = await createGift({ quantity: 5 });
        const second = await createGift({ quantity: 5 });
        const selection = await chooseGift(employee.id, first.id);

        await api
          .patch(`/birthday-gift-selections/${selection.id}`)
          .send({ birthdayGiftId: second.id })
          .expect(200);

        expect(await stockOf(first.id)).toBe(5);
        expect(await stockOf(second.id)).toBe(4);
      });

      it('refuses a gift that is out of stock', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift({ quantity: 0 });

        const response = await api
          .post('/birthday-gift-selections')
          .send({ employeeId: employee.id, birthdayGiftId: gift.id });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('out of stock');
      });

      it('refuses a second choice in the same year', async () => {
        const employee = await birthdayEmployee();
        const first = await createGift({ quantity: 5 });
        const second = await createGift({ quantity: 5 });
        await chooseGift(employee.id, first.id);

        const response = await api
          .post('/birthday-gift-selections')
          .send({ employeeId: employee.id, birthdayGiftId: second.id });

        expect(response.status).toBe(409);
        // The refused choice must not have quietly taken the second gift too.
        expect(await stockOf(second.id)).toBe(5);
      });

      it('refuses a choice for an employee with no birth date on file', async () => {
        const employee = await newEmployee();
        const gift = await createGift();

        const response = await api
          .post('/birthday-gift-selections')
          .send({ employeeId: employee.id, birthdayGiftId: gift.id });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain('birth date');
      });

      it('answers 404 for an employee or a gift that does not exist', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift();

        await api
          .post('/birthday-gift-selections')
          .send({ employeeId: MISSING_ID, birthdayGiftId: gift.id })
          .expect(404);
        await api
          .post('/birthday-gift-selections')
          .send({ employeeId: employee.id, birthdayGiftId: MISSING_ID })
          .expect(404);
      });

      it('approves a selection and refuses to unpick it afterwards', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift({ quantity: 5 });
        const selection = await chooseGift(employee.id, gift.id);

        const approved = await api
          .patch(`/birthday-gift-selections/${selection.id}/approve`)
          .send({ status: 'approved', pickupDate: today(), notes: 'รับที่ห้อง HR' })
          .expect(200);

        expect(approved.body.status).toBe('approved');

        // Approval is the hand-over: the gift has left the building, so neither
        // a change of mind nor a cancellation may put it back on the shelf.
        const changed = await api
          .patch(`/birthday-gift-selections/${selection.id}`)
          .send({ notes: 'เปลี่ยนใจ' });
        expect(changed.status).toBe(400);

        const removed = await api.delete(`/birthday-gift-selections/${selection.id}`);
        expect(removed.status).toBe(400);
        expect(await stockOf(gift.id)).toBe(4);
      });

      it('refuses an approval status the flow does not have', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift();
        const selection = await chooseGift(employee.id, gift.id);

        const response = await api
          .patch(`/birthday-gift-selections/${selection.id}/approve`)
          .send({ status: 'rejected' });

        expect(response.status).toBe(400);
      });

      it('answers 404 when approving a selection that does not exist', async () => {
        const response = await api
          .patch(`/birthday-gift-selections/${MISSING_ID}/approve`)
          .send({ status: 'approved' });

        expect(response.status).toBe(404);
      });

      it('summarises who has chosen and who has not', async () => {
        const employee = await birthdayEmployee();
        const gift = await createGift({ quantity: 5 });
        const selection = await chooseGift(employee.id, gift.id);
        await api
          .patch(`/birthday-gift-selections/${selection.id}/approve`)
          .send({ status: 'approved' })
          .expect(200);

        const response = await api
          .get('/birthday-gift-selections/summary')
          .query({ year: new Date().getFullYear() })
          .expect(200);

        // `getSummary` returns the counts at the top level — year/total/selected/
        // notSelected/approved/pending — alongside `employees`
        // (birthday-gift-selections.service.ts ~485).
        expect(response.body.approved).toBeGreaterThanOrEqual(1);
        expect(response.body.selected).toBeGreaterThanOrEqual(1);
        const row = (response.body.employees ?? []).find(
          (item: { employeeId?: string; employee?: { id: string } }) =>
            item.employeeId === employee.id || item.employee?.id === employee.id,
        );
        expect(row).toBeDefined();
        expect(row.selected).toBe(true);
      });

      it('filters the summary to the people who have not chosen yet', async () => {
        const employee = await birthdayEmployee();

        const response = await api
          .get('/birthday-gift-selections/summary')
          .query({ year: new Date().getFullYear(), status: 'not_selected' })
          .expect(200);

        const rows = response.body.employees ?? [];
        expect(rows.every((row: { selected: boolean }) => row.selected === false)).toBe(true);
        expect(
          rows.some(
            (row: { employeeId?: string; employee?: { id: string } }) =>
              row.employeeId === employee.id || row.employee?.id === employee.id,
          ),
        ).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E-training
  // ═══════════════════════════════════════════════════════════════════════════
  describe('e-training', () => {
    const createVideo = async (overrides: Record<string, unknown> = {}) => {
      const response = await api.post('/e-training').send({
        title: uniqueName('วิดีโออบรม').slice(0, 255),
        youtubeUrl: 'https://www.youtube.com/watch?v=e2e-training',
        position: 1,
        ...overrides,
      });
      if (response.status >= 300 || !response.body?.id) {
        throw new Error(
          `Could not create a training video (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
        );
      }
      return response.body as { id: string; title: string; position: number; isActive: boolean };
    };

    afterAll(async () => {
      // Put the reward back on the shipped default: the points a completed
      // video is worth is tenant-wide, and other reads in this file would
      // otherwise inherit whatever the last test set.
      await api.put('/e-training/settings').send({ pointsReward: 5 }).expect(200);
    });

    it('creates a video and lists it in playing order', async () => {
      const first = await createVideo({ position: 1 });
      const second = await createVideo({ position: 2 });

      const response = await api.get('/e-training').expect(200);

      const ids = response.body.map((row: { id: string }) => row.id);
      expect(ids).toContain(first.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    it('edits a video in place', async () => {
      const video = await createVideo();
      const title = uniqueName('วิดีโอที่แก้ชื่อ').slice(0, 255);

      const response = await api
        .put(`/e-training/${video.id}`)
        .send({ title, isActive: false })
        .expect(200);

      expect(response.body).toMatchObject({ id: video.id, title, isActive: false });
    });

    it('deletes a video', async () => {
      const video = await createVideo();

      await api.delete(`/e-training/${video.id}`).expect(200);

      const response = await api.get('/e-training').expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(video.id);
    });

    it('answers 404 for a video that does not exist', async () => {
      await api.get(`/e-training/${MISSING_ID}`).expect(404);
      await api.put(`/e-training/${MISSING_ID}`).send({ title: 'x' }).expect(404);
      await api.delete(`/e-training/${MISSING_ID}`).expect(404);
    });

    it('refuses a video with no title or no link', async () => {
      const noTitle = await api
        .post('/e-training')
        .send({ youtubeUrl: 'https://youtu.be/e2e' });
      expect(noTitle.status).toBe(400);
      expect(JSON.stringify(noTitle.body)).toContain('title');

      const noUrl = await api.post('/e-training').send({ title: 'ไม่มีลิงก์' });
      expect(noUrl.status).toBe(400);
      expect(JSON.stringify(noUrl.body)).toContain('youtubeUrl');
    });

    it('answers the shipped defaults before the tenant configures anything', async () => {
      const response = await api.get('/e-training/settings').expect(200);

      expect(response.body).toMatchObject({
        pointsReward: 5,
        presenceMinInterval: 10,
        presenceMaxInterval: 30,
        presenceCountdown: 10,
      });
    });

    it('saves the settings and leaves the fields it was not given alone', async () => {
      await api.put('/e-training/settings').send({ pointsReward: 8 }).expect(200);

      const response = await api.get('/e-training/settings').expect(200);
      expect(response.body.pointsReward).toBe(8);
      // A partial save is a partial save: the presence timings were not on this
      // form and must not be reset to defaults behind the admin's back.
      expect(response.body.presenceCountdown).toBe(10);
    });

    it('refuses settings outside the ranges the player can honour', async () => {
      const tooManyPoints = await api.put('/e-training/settings').send({ pointsReward: 500 });
      expect(tooManyPoints.status).toBe(400);

      const tooShort = await api.put('/e-training/settings').send({ presenceCountdown: 1 });
      expect(tooShort.status).toBe(400);
    });

    test.failing('refuses a presence window whose minimum exceeds its maximum', async () => {
      // Defect: `UpdateETrainingSettingsDto` validates each field on its own and
      // `updateSettings` (e-training.service.ts ~57) copies them across with no
      // cross-check. A min above the max is accepted and stored; the player then
      // has to pick a random interval from an empty range.
      const response = await api
        .put('/e-training/settings')
        .send({ presenceMinInterval: 200, presenceMaxInterval: 30 });

      expect(response.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Probation
  // ═══════════════════════════════════════════════════════════════════════════
  describe('probation', () => {
    /**
     * Probation sessions cannot be created directly: they are produced when a
     * recruitment application's start date is confirmed. The suite therefore
     * walks the whole hiring chain — MR, link, application, result, offer,
     * offer approval, start date, confirmation — for each candidate it needs.
     *
     * Two details of that chain matter here:
     *   - `confirmStartDate` reads the probation evaluator out of the offer note,
     *     which it parses as JSON. The note is set to `{"evaluatorId": ...}`
     *     accordingly, and the evaluator is the suite's own HR user because only
     *     the assigned evaluator may record a result.
     *   - The work start date is today, so all three deadlines (day 30, 60, 75)
     *     are in the future and no round is out of its grace period.
     */
    let link: RecruitmentLinkFixture;
    let jobId: string;

    beforeAll(async () => {
      const posting = await createApprovedJobPosting(api, { headcount: 20 });
      jobId = posting.id;
      link = await createRecruitmentLink(api, [posting.id]);
    });

    interface ProbationFixture {
      employeeId: string;
      sessions: Array<{ id: string; round: number; status: string }>;
    }

    const hireCandidate = async (): Promise<ProbationFixture> => {
      const application = await submitApplication(api, link, jobId);

      await api
        .put(`/recruitment/applications/${application.id}/result`)
        .send({ result: 'passed', resultDate: today() })
        .expect(200);

      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({
          offerSalary: 30000,
          offerStartDate: today(),
          offerNote: JSON.stringify({ evaluatorId: actorEmployeeId }),
        })
        .expect(200);

      for (let step = 0; step < 10; step += 1) {
        const current = await api
          .get(`/recruitment/applications/${application.id}`)
          .expect(200);
        if (current.body.status !== 'mo_pending_approval') break;
        const approved = await api
          .post(`/recruitment/applications/${application.id}/mo/approve`)
          .send({ comment: 'อนุมัติข้อเสนอโดยชุดทดสอบ' });
        if (approved.status >= 300) {
          throw new Error(
            `Could not approve the offer (HTTP ${approved.status}): ${JSON.stringify(approved.body)}`,
          );
        }
      }

      // Setting the start date is what creates the employee record; confirming
      // it is what opens the three probation rounds.
      await api
        .put(`/recruitment/applications/${application.id}/start-date`)
        .send({ workStartDate: today() })
        .expect(200);
      await api.post(`/recruitment/applications/${application.id}/confirm-start`).expect(201);

      const confirmed = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      const employeeId = confirmed.body.employeeId;
      if (!employeeId) {
        throw new Error(
          `The confirmed application produced no employee: ${JSON.stringify(confirmed.body)}`,
        );
      }

      const sessions = await api.get(`/probation/employees/${employeeId}`).expect(200);
      if (sessions.body.length !== 3) {
        throw new Error(
          `Expected three probation rounds, got ${sessions.body.length} for employee ${employeeId}`,
        );
      }
      return { employeeId, sessions: sessions.body };
    };

    const roundsOf = async (employeeId: string) =>
      (await api.get(`/probation/employees/${employeeId}`).expect(200)).body as Array<{
        id: string;
        round: number;
        status: string;
        result: string | null;
      }>;

    const pass = (sessionId: string) =>
      api.post(`/probation/sessions/${sessionId}/result`).send({ result: 'pass' }).expect(201);

    it('opens three pending rounds when the hire is confirmed', async () => {
      const hire = await hireCandidate();

      const rounds = await roundsOf(hire.employeeId);
      expect(rounds.map((r) => r.round).sort()).toEqual([1, 2, 3]);
      expect(rounds.every((r) => r.status === 'pending')).toBe(true);
      // The evaluator comes from the offer, so nobody has to be chased for it
      // after the person has already started.
      expect(rounds.every((r) => (r as any).evaluatorId === actorEmployeeId)).toBe(true);
    });

    it('lists the employee on the probation board with their rounds', async () => {
      const hire = await hireCandidate();

      const response = await api.get('/probation/employees').expect(200);

      const entry = response.body.find(
        (row: { employee?: { id: string } }) => row.employee?.id === hire.employeeId,
      );
      expect(entry).toBeDefined();
      expect(entry.sessions).toHaveLength(3);
      expect(entry.hasEvaluator).toBe(true);
    });

    it('answers an empty list of rounds for someone who is not on probation', async () => {
      const employee = await newEmployee();

      const response = await api.get(`/probation/employees/${employee.id}`).expect(200);

      expect(response.body).toEqual([]);
    });

    it('reassigns the evaluator across every round at once', async () => {
      const hire = await hireCandidate();
      const evaluator = await newEmployee();

      await api
        .put(`/probation/employees/${hire.employeeId}/evaluator`)
        .send({ evaluatorId: evaluator.id })
        .expect(200);

      const rounds = await roundsOf(hire.employeeId);
      // One person owns the whole probation, not a round each — otherwise a
      // handover has to be done three times and one is always forgotten.
      expect(rounds.every((r) => (r as any).evaluatorId === evaluator.id)).toBe(true);
    });

    it('answers 404 when the evaluator or the employee is unknown', async () => {
      const hire = await hireCandidate();

      await api
        .put(`/probation/employees/${hire.employeeId}/evaluator`)
        .send({ evaluatorId: MISSING_ID })
        .expect(404);
      await api
        .put(`/probation/employees/${MISSING_ID}/evaluator`)
        .send({ evaluatorId: actorEmployeeId })
        .expect(404);
    });

    it('refuses an evaluator assignment with no evaluator', async () => {
      const hire = await hireCandidate();

      const response = await api
        .put(`/probation/employees/${hire.employeeId}/evaluator`)
        .send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('evaluatorId');
    });

    it('records a pass and closes that round only', async () => {
      const hire = await hireCandidate();
      const first = hire.sessions.find((s) => s.round === 1)!;

      await pass(first.id);

      const rounds = await roundsOf(hire.employeeId);
      expect(rounds.find((r) => r.round === 1)).toMatchObject({ status: 'done', result: 'pass' });
      expect(rounds.find((r) => r.round === 2)!.status).toBe('pending');
    });

    it('refuses to record a round that has already been decided', async () => {
      const hire = await hireCandidate();
      const first = hire.sessions.find((s) => s.round === 1)!;
      await pass(first.id);

      const response = await api
        .post(`/probation/sessions/${first.id}/result`)
        .send({ result: 'fail_retry', resultNote: 'ขอประเมินใหม่' });

      // A recorded result is the evaluator's signature; re-recording it would
      // let a pass become a fail with no trace of the first decision.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('บันทึกผลไปแล้ว');
      expect((await roundsOf(hire.employeeId)).find((r) => r.round === 1)!.result).toBe('pass');
    });

    it('refuses a fail with no reason', async () => {
      const hire = await hireCandidate();
      const first = hire.sessions.find((s) => s.round === 1)!;

      const response = await api
        .post(`/probation/sessions/${first.id}/result`)
        .send({ result: 'fail_retry' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('เหตุผล');
    });

    it('refuses a result the flow does not recognise', async () => {
      const hire = await hireCandidate();
      const first = hire.sessions.find((s) => s.round === 1)!;

      const response = await api
        .post(`/probation/sessions/${first.id}/result`)
        .send({ result: 'maybe' });

      expect(response.status).toBe(400);
    });

    it('answers 404 for a session that does not exist', async () => {
      const response = await api
        .post(`/probation/sessions/${MISSING_ID}/result`)
        .send({ result: 'pass' });

      expect(response.status).toBe(404);
    });

    it('skips the remaining rounds when the first one ends the employment', async () => {
      const hire = await hireCandidate();
      const first = hire.sessions.find((s) => s.round === 1)!;

      await api
        .post(`/probation/sessions/${first.id}/result`)
        .send({ result: 'fail_terminate', resultNote: 'ไม่ผ่านการประเมินรอบแรก' })
        .expect(201);

      const rounds = await roundsOf(hire.employeeId);
      // There is nobody left to evaluate, so rounds 2 and 3 are closed rather
      // than left pending forever on the evaluator's list.
      expect(rounds.find((r) => r.round === 2)!.status).toBe('skipped');
      expect(rounds.find((r) => r.round === 3)!.status).toBe('skipped');
    });

    it('refuses to confirm someone as permanent while a round is open', async () => {
      const hire = await hireCandidate();
      await pass(hire.sessions.find((s) => s.round === 1)!.id);

      const response = await api.post(
        `/probation/employees/${hire.employeeId}/confirm-permanent`,
      );

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('ยังไม่เสร็จสิ้น');
    });

    it('refuses to confirm someone who did not pass', async () => {
      const hire = await hireCandidate();
      await pass(hire.sessions.find((s) => s.round === 1)!.id);
      await pass(hire.sessions.find((s) => s.round === 2)!.id);
      await api
        .post(`/probation/sessions/${hire.sessions.find((s) => s.round === 3)!.id}/result`)
        .send({ result: 'fail', resultNote: 'ผลงานไม่ถึงเกณฑ์' })
        .expect(201);

      const response = await api.post(
        `/probation/employees/${hire.employeeId}/confirm-permanent`,
      );

      expect(response.status).toBe(400);
    });

    it('refuses to confirm someone with no probation at all', async () => {
      const employee = await newEmployee();

      const response = await api.post(`/probation/employees/${employee.id}/confirm-permanent`);

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('ไม่พบข้อมูลการประเมิน');
    });

    it('answers 404 when confirming an employee that does not exist', async () => {
      const response = await api.post(`/probation/employees/${MISSING_ID}/confirm-permanent`);

      expect(response.status).toBe(404);
    });

    it('makes the employee permanent once all three rounds are passed', async () => {
      const hire = await hireCandidate();
      for (const round of [1, 2, 3]) {
        await pass(hire.sessions.find((s) => s.round === round)!.id);
      }

      const response = await api
        .post(`/probation/employees/${hire.employeeId}/confirm-permanent`)
        .expect(201);

      // The employment type is the fact the rest of the product reads — payroll
      // and leave both key off it — so the confirmation has to land there.
      expect(response.body.employmentType?.nameTh).toBe('พนักงานประจำ');
    });

    test.failing('drops a confirmed employee off the probation board', async () => {
      // Defect: `confirmPermanent` (probation.service.ts ~511) changes the
      // employee's employment type and nothing else. The probation sessions are
      // left in place, and `listEmployeesWithProbation` groups every session row
      // in the tenant with no filter on whether probation is over — so a
      // permanent employee stays on HR's probation board indefinitely, and the
      // board grows without bound as the company hires.
      const hire = await hireCandidate();
      for (const round of [1, 2, 3]) {
        await pass(hire.sessions.find((s) => s.round === round)!.id);
      }
      await api.post(`/probation/employees/${hire.employeeId}/confirm-permanent`).expect(201);

      const response = await api.get('/probation/employees').expect(200);

      expect(
        response.body.map((row: { employee?: { id: string } }) => row.employee?.id),
      ).not.toContain(hire.employeeId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Tenant scoping
  // ═══════════════════════════════════════════════════════════════════════════
  describe('tenant scoping', () => {
    /**
     * A neighbouring tenant, numeric and derived from this worker's own id so
     * parallel workers cannot collide. Numeric matters: several tenant-scoped
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

    it("hides one tenant's gifts and gift categories from the other", async () => {
      const category = await api
        .post('/birthday-gift-categories')
        .send({ name: uniqueName('หมวดเฉพาะบริษัท').slice(0, 80) })
        .expect(201);
      const gift = await api
        .post('/birthday-gifts')
        .send({ name: uniqueName('ของขวัญเฉพาะบริษัท').slice(0, 150), quantity: 3 })
        .expect(201);

      const gifts = await neighbour.get('/birthday-gifts').expect(200);
      expect(gifts.body.map((row: { id: string }) => row.id)).not.toContain(gift.body.id);
      const categories = await neighbour.get('/birthday-gift-categories').expect(200);
      expect(categories.body.map((row: { id: string }) => row.id)).not.toContain(category.body.id);

      // Not merely absent from the list — unreachable by id, and unchangeable.
      await neighbour.get(`/birthday-gifts/${gift.body.id}`).expect(404);
      await neighbour.patch(`/birthday-gifts/${gift.body.id}`).send({ quantity: 99 }).expect(404);
      expect(Number((await api.get(`/birthday-gifts/${gift.body.id}`).expect(200)).body.quantity)).toBe(3);
    });

    it("keeps one tenant's points off the other's board and dashboard", async () => {
      const employee = await newEmployee();
      const transaction = await api
        .post('/organics-points/transactions')
        .send({
          type: 'add',
          points: 13,
          reason: 'แต้มของบริษัทนี้',
          employeeIds: [employee.id],
          operatorId: actorEmployeeId,
        })
        .expect(201);

      const board = await neighbour
        .get('/organics-points/employees')
        .query({ limit: 200 })
        .expect(200);
      expect(
        (board.body.data as any[]).some((row) => row.employeeDbId === employee.id),
      ).toBe(false);

      await neighbour.get(`/organics-points/transactions/${transaction.body.id}`).expect(404);
    });

    it("hides one tenant's training videos from the other", async () => {
      const video = await api
        .post('/e-training')
        .send({
          title: uniqueName('วิดีโอเฉพาะบริษัท').slice(0, 255),
          youtubeUrl: 'https://www.youtube.com/watch?v=e2e-scope',
        })
        .expect(201);

      const response = await neighbour.get('/e-training').expect(200);
      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(video.body.id);
      await neighbour.get(`/e-training/${video.body.id}`).expect(404);
    });

    it("hides one tenant's equipment requisitions from the other", async () => {
      const employee = await newEmployee();
      const { body: stock } = await api
        .post('/hr-stock/items')
        .send({
          nameTh: uniqueName('ของเฉพาะบริษัท'),
          category: 'UNIFORM',
          section: 'uniform',
          unit: 'ชิ้น',
          initialQty: 5,
        })
        .expect(201);
      const created = await api
        .post(`/equipment-requisitions/subjects/${employee.id}`)
        .send({
          itemName: uniqueName('เสื้อเฉพาะบริษัท'),
          category: 'uniform',
          erpItemCode: stock.erpItemCode ?? stock.itemCode ?? stock.code,
        })
        .expect(201);

      const list = await neighbour.get('/equipment-requisitions').expect(200);
      expect(list.body.map((row: { id: string }) => row.id)).not.toContain(created.body.id);

      // The subject is not theirs either, so the whole subject page is a 404
      // rather than an empty list that looks like "this person has nothing".
      await neighbour.get(`/equipment-requisitions/subjects/${employee.id}`).expect(404);
      await neighbour.patch(`/equipment-requisitions/${created.body.id}`).send({ quantity: 9 }).expect(404);
      await neighbour.delete(`/equipment-requisitions/${created.body.id}`).expect(404);
    });

    it("keeps one tenant's probation board out of the other's", async () => {
      const response = await neighbour.get('/probation/employees').expect(200);

      // The neighbour has hired nobody, so its board is empty however many
      // people are on probation next door.
      expect(response.body).toEqual([]);
    });

    it('gives each tenant its own copy of the reason catalogue', async () => {
      const label = uniqueName('เหตุผลเฉพาะบริษัท');
      const reason = await api.post('/organics-point-reasons').send({ label }).expect(201);

      const response = await neighbour.get('/organics-point-reasons').expect(200);

      expect(response.body.map((row: { id: string }) => row.id)).not.toContain(reason.body.id);
      // The neighbour still gets the shipped defaults seeded for itself.
      expect(response.body.length).toBeGreaterThanOrEqual(12);
      await neighbour.patch(`/organics-point-reasons/${reason.body.id}`).send({ label: 'x' }).expect(404);
    });
  });
});
