/**
 * Recruitment: the manpower request (MR), the public application link, the
 * applications that arrive through it, and the hire at the end.
 *
 * The suite follows that chain in order, because the product enforces it: a
 * link may only point at an approved MR, only an approved MR is open for
 * applications, and only a candidate who passed and holds an approved offer
 * (MO) becomes an employee. Each stage therefore builds on the one above it,
 * and a failure points at the stage that broke rather than at a heap of
 * unrelated fixtures.
 */
import { ApiClient } from '../support/api-client';
import { hrApi } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData, uniqueName } from '../support/db';
import {
  approveMrFully,
  createApprovedJobPosting,
  createJobPosting,
  createLevel,
  createRecruitmentLink,
  submitApplication,
  type ApplicationFixture,
  type JobPostingFixture,
  type LevelFixture,
  type RecruitmentLinkFixture,
} from '../support/factories';

/** An id that is a well-formed UUID but belongs to nothing. */
const MISSING_ID = '00000000-0000-4000-8000-00000000dead';

describe('Recruitment (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  /** `GET /recruitment/jobs` and the application list both answer `{ items }`. */
  const listed = (body: any): any[] =>
    Array.isArray(body) ? body : (body.items ?? body.data ?? []);

  // ───────────────────────────────────────────────────────────────────────
  // MR — the request itself
  // ───────────────────────────────────────────────────────────────────────

  describe('MR (job postings)', () => {
    it('creates an MR that waits for approval before it is usable', async () => {
      const posting = await createJobPosting(api, { headcount: 2 });

      const response = await api.get(`/recruitment/jobs/${posting.id}`).expect(200);

      expect(response.body).toMatchObject({
        title: posting.title,
        mrNote: posting.mrNote,
        headcount: 2,
        // The service forces this regardless of what the caller sent: a brand
        // new MR is always a request, never an already-approved one.
        mrStatus: 'pending_approval',
      });
    });

    it('lists the new MR and finds it by its document number', async () => {
      const posting = await createJobPosting(api);

      const all = await api.get('/recruitment/jobs').query({ limit: 100 }).expect(200);
      expect(listed(all.body).map((item) => item.id)).toContain(posting.id);

      const searched = await api
        .get('/recruitment/jobs')
        .query({ search: posting.mrNote, limit: 100 })
        .expect(200);
      expect(listed(searched.body).map((item) => item.id)).toEqual([posting.id]);
    });

    it('suggests the next MR document number', async () => {
      const response = await api
        .get('/recruitment/jobs/mr/next-number')
        .query({ mrType: 'office' })
        .expect(200);

      expect(typeof response.body.number).toBe('string');
      expect(response.body.number.length).toBeGreaterThan(0);
    });

    it('updates the MR and the change sticks', async () => {
      const posting = await createJobPosting(api);
      const title = uniqueName('ตำแหน่งที่แก้ไขแล้ว');

      await api
        .put(`/recruitment/jobs/${posting.id}`)
        .send({ title, headcount: 5, workLocation: 'สำนักงานใหญ่' })
        .expect(200);

      const response = await api.get(`/recruitment/jobs/${posting.id}`).expect(200);
      expect(response.body).toMatchObject({ title, headcount: 5 });
    });

    it('removes a deleted MR from the list', async () => {
      const posting = await createJobPosting(api);

      await api.delete(`/recruitment/jobs/${posting.id}`).expect(200);

      const response = await api.get('/recruitment/jobs').query({ limit: 100 }).expect(200);
      expect(listed(response.body).map((item) => item.id)).not.toContain(posting.id);
      await api.get(`/recruitment/jobs/${posting.id}`).expect(404);
    });

    it('answers 404 for an MR that does not exist', async () => {
      await api.get(`/recruitment/jobs/${MISSING_ID}`).expect(404);
      await api.put(`/recruitment/jobs/${MISSING_ID}`).send({ headcount: 1 }).expect(404);
      await api.delete(`/recruitment/jobs/${MISSING_ID}`).expect(404);
    });

    it('refuses a second MR with the same document number', async () => {
      const first = await createJobPosting(api);

      const response = await api
        .post('/recruitment/jobs')
        .send({ title: uniqueName('เลขซ้ำ'), mrNote: first.mrNote });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(first.mrNote);
    });

    it('rejects a headcount below one', async () => {
      const response = await api
        .post('/recruitment/jobs')
        .send({ title: uniqueName('จำนวนไม่ถูกต้อง'), headcount: 0 });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('headcount');
    });

    it('rejects a posting status outside the enum', async () => {
      const response = await api
        .post('/recruitment/jobs')
        .send({ title: uniqueName('สถานะผิด'), status: 'archived' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('status');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // MR approval — the part that decides whether hiring may start at all
  // ───────────────────────────────────────────────────────────────────────

  describe('MR approval', () => {
    it('opens approval steps when the MR is submitted', async () => {
      const posting = await createJobPosting(api);

      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);

      const response = await api.get(`/recruitment/jobs/${posting.id}/mr/approvals`).expect(200);
      const approvals = listed(response.body);

      expect(approvals.length).toBeGreaterThan(0);
      expect(approvals.every((step: any) => step.status === 'pending')).toBe(true);
      // Steps are numbered so the UI can show "step 2 of 3".
      expect(approvals.map((step: any) => step.step)).toEqual(
        approvals.map((_: unknown, index: number) => index + 1),
      );
    });

    it('opens the job for applications once every step has approved', async () => {
      const posting = await createJobPosting(api);

      await approveMrFully(api, posting.id);

      const response = await api.get(`/recruitment/jobs/${posting.id}`).expect(200);
      expect(response.body.mrStatus).toBe('approved');
      // The behaviour that matters downstream: approval is what makes the job
      // postable on a public link and open to applicants.
      expect(response.body.status).toBe('open');
    });

    it('tells an approver whether this step is theirs to approve', async () => {
      const posting = await createJobPosting(api);
      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);

      const pending = await api
        .get(`/recruitment/jobs/${posting.id}/mr/can-approve`)
        .expect(200);
      // No required level on this MR, so the step is not restricted.
      expect(pending.body.canApprove).toBe(true);

      await approveMrFully(api, posting.id);

      const settled = await api
        .get(`/recruitment/jobs/${posting.id}/mr/can-approve`)
        .expect(200);
      expect(settled.body.canApprove).toBe(false);
      expect(settled.body.reason).toBeTruthy();
    });

    it('refuses to approve an MR that is already approved', async () => {
      const posting = await createJobPosting(api);
      await approveMrFully(api, posting.id);

      const response = await api
        .post(`/recruitment/jobs/${posting.id}/mr/approve`)
        .send({ comment: 'อนุมัติซ้ำ' });

      expect(response.status).toBe(400);
    });

    it('refuses to submit an MR that is already approved', async () => {
      const posting = await createJobPosting(api);
      await approveMrFully(api, posting.id);

      const response = await api
        .post(`/recruitment/jobs/${posting.id}/mr/submit`)
        .send({ mrNote: posting.mrNote });

      expect(response.status).toBe(400);
    });

    it('marks the MR rejected and lets the requester submit it again', async () => {
      const posting = await createJobPosting(api);
      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);

      await api
        .post(`/recruitment/jobs/${posting.id}/mr/reject`)
        .send({ comment: 'งบประมาณยังไม่พร้อม' })
        .expect(201);

      const rejected = await api.get(`/recruitment/jobs/${posting.id}`).expect(200);
      expect(rejected.body.mrStatus).toBe('rejected');

      // A rejected MR is a draft again, not a dead end: re-submitting clears
      // the old decisions and starts a fresh round of approvals.
      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);

      const approvals = await api
        .get(`/recruitment/jobs/${posting.id}/mr/approvals`)
        .expect(200);
      expect(listed(approvals.body).every((step: any) => step.status === 'pending')).toBe(true);
    });

    it('rejects a rejection with no comment', async () => {
      const posting = await createJobPosting(api);
      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);

      const response = await api.post(`/recruitment/jobs/${posting.id}/mr/reject`).send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('comment');
    });

    it('cancels an approved MR so it stops being a live request', async () => {
      const posting = await createJobPosting(api);
      await approveMrFully(api, posting.id);

      await api
        .post(`/recruitment/jobs/${posting.id}/mr/cancel`)
        .send({ reason: 'ยกเลิกโดยชุดทดสอบ' })
        .expect(201);

      const response = await api.get(`/recruitment/jobs/${posting.id}`).expect(200);
      expect(response.body.mrStatus).toBe('rejected');
    });

    it('refuses to cancel an MR that was already rejected', async () => {
      const posting = await createJobPosting(api);
      await api.post(`/recruitment/jobs/${posting.id}/mr/submit`).send({}).expect(201);
      await api
        .post(`/recruitment/jobs/${posting.id}/mr/reject`)
        .send({ comment: 'ไม่อนุมัติ' })
        .expect(201);

      const response = await api.post(`/recruitment/jobs/${posting.id}/mr/cancel`).send({});
      expect(response.status).toBe(400);
    });

    // KNOWN DEFECT — `duplicateMr` copies `mrNote` verbatim into the new row,
    // but migration 1833000000000-AddUniqueMrNoteToJobPostings adds a real
    // `UNIQUE (tenant_id, mr_note)` constraint, and unlike `create` the
    // duplicate path never calls `assertMrNoteUnique`. Duplicating any MR that
    // carries a document number therefore hits the constraint and answers 500.
    // Expected to fail until the copy is given a document number of its own.
    test.failing('duplicates an approved MR as a fresh request', async () => {
      const original = await createJobPosting(api, { headcount: 3 });
      await approveMrFully(api, original.id);

      const response = await api
        .post(`/recruitment/jobs/${original.id}/mr/duplicate`)
        .send({})
        .expect(201);

      expect(response.body.id).not.toBe(original.id);
      const copy = await api.get(`/recruitment/jobs/${response.body.id}`).expect(200);
      expect(copy.body.headcount).toBe(3);
      expect(copy.body.title).toContain('(สำเนา)');
      // A document number identifies exactly one request, so the copy needs
      // its own rather than a second claim on the original's.
      expect(copy.body.mrNote).not.toBe(original.mrNote);
      // The copy is a new request; approval is never inherited.
      expect(copy.body.mrStatus).toBe('pending_approval');
    });

    it('answers 404 for the approvals of an MR that does not exist', async () => {
      await api.get(`/recruitment/jobs/${MISSING_ID}/mr/approvals`).expect(404);
      await api.get(`/recruitment/jobs/${MISSING_ID}/mr/can-approve`).expect(404);
      await api
        .post(`/recruitment/jobs/${MISSING_ID}/mr/submit`)
        .send({})
        .expect(404);
    });

    describe('when the step is reserved for a level', () => {
      let approverLevel: LevelFixture;
      let gated: JobPostingFixture;

      beforeAll(async () => {
        // A two-rung ladder: a level-1 request is approved by a level-2 user.
        const requestedLevel = await createLevel(api, 1);
        approverLevel = await createLevel(api, 2);

        await api
          .put('/recruitment/approval-matrix')
          .query({ kind: 'mr' })
          .send({
            entries: [
              { requestedLevel: requestedLevel.level, approverLevel: approverLevel.level },
            ],
          })
          .expect(200);

        gated = await createJobPosting(api, { requiredLevelId: requestedLevel.id });
        await api.post(`/recruitment/jobs/${gated.id}/mr/submit`).send({}).expect(201);
      });

      it('refuses an approver who does not hold the required level', async () => {
        // The suite's HR account has no level on its employee record, so it
        // has no authority over this step however senior its role is.
        const response = await api
          .post(`/recruitment/jobs/${gated.id}/mr/approve`)
          .send({ comment: 'พยายามอนุมัติโดยไม่มีสิทธิ์' });

        expect(response.status).toBe(400);

        const posting = await api.get(`/recruitment/jobs/${gated.id}`).expect(200);
        expect(posting.body.mrStatus).toBe('pending_approval');
      });

      it('says so through can-approve, with the level it wants', async () => {
        const response = await api
          .get(`/recruitment/jobs/${gated.id}/mr/can-approve`)
          .expect(200);

        expect(response.body.canApprove).toBe(false);
        expect(response.body.requiredLevel).toBe(approverLevel.level);
        expect(response.body.reason).toBeTruthy();
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Application links
  // ───────────────────────────────────────────────────────────────────────

  describe('application links', () => {
    let approved: JobPostingFixture;

    beforeAll(async () => {
      approved = await createApprovedJobPosting(api);
    });

    it('refuses a link for an MR that has not been approved', async () => {
      const pending = await createJobPosting(api);

      const response = await api
        .post('/recruitment/links')
        .send({ title: uniqueName('ลิงก์ก่อนอนุมัติ'), jobPostingIds: [pending.id] });

      // Publishing a job nobody approved is the whole thing the MR exists to
      // prevent, so this must fail even though the job row exists.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(pending.title);
    });

    it('creates a link for an approved MR and returns it by id', async () => {
      const link = await createRecruitmentLink(api, [approved.id]);

      const response = await api.get(`/recruitment/links/${link.id}`).expect(200);
      expect(response.body.status).toBe('active');
      expect(response.body.token).toEqual(expect.any(String));
      expect(
        (response.body.linkJobs ?? []).map((row: any) => row.jobPostingId ?? row.jobPosting?.id),
      ).toContain(approved.id);
    });

    it('lists the links of the tenant', async () => {
      const link = await createRecruitmentLink(api, [approved.id]);

      const response = await api.get('/recruitment/links').query({ limit: 100 }).expect(200);
      expect(listed(response.body).map((item) => item.id)).toContain(link.id);
    });

    it('closes a link by switching it to inactive', async () => {
      const link = await createRecruitmentLink(api, [approved.id]);
      const title = uniqueName('ลิงก์ที่ปิดแล้ว');

      await api
        .put(`/recruitment/links/${link.id}`)
        .send({ title, status: 'inactive' })
        .expect(200);

      const response = await api.get(`/recruitment/links/${link.id}`).expect(200);
      expect(response.body).toMatchObject({ title, status: 'inactive' });
    });

    it('removes a deleted link from the list', async () => {
      const link = await createRecruitmentLink(api, [approved.id]);

      await api.delete(`/recruitment/links/${link.id}`).expect(200);

      await api.get(`/recruitment/links/${link.id}`).expect(404);
    });

    it('answers 404 for a link that does not exist', async () => {
      await api.get(`/recruitment/links/${MISSING_ID}`).expect(404);
      await api.put(`/recruitment/links/${MISSING_ID}`).send({ title: 'x' }).expect(404);
      await api.delete(`/recruitment/links/${MISSING_ID}`).expect(404);
    });

    it('rejects a link that points at no job at all', async () => {
      const response = await api
        .post('/recruitment/links')
        .send({ title: uniqueName('ลิงก์ว่าง'), jobPostingIds: [] });

      expect(response.status).toBe(400);
    });

    it('rejects a job posting id that is not a UUID', async () => {
      const response = await api
        .post('/recruitment/links')
        .send({ title: uniqueName('ไอดีผิดรูปแบบ'), jobPostingIds: ['not-a-uuid'] });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('jobPostingIds');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Applications
  // ───────────────────────────────────────────────────────────────────────

  describe('applications', () => {
    let job: JobPostingFixture;
    let link: RecruitmentLinkFixture;

    /** A candidate who has just applied, on their own fresh job and link. */
    const applyToNewJob = async (): Promise<ApplicationFixture> =>
      submitApplication(api, link, job.id);

    beforeAll(async () => {
      job = await createApprovedJobPosting(api, { headcount: 10 });
      link = await createRecruitmentLink(api, [job.id]);
    });

    it('records an application against the job it was sent for', async () => {
      const application = await applyToNewJob();

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);

      expect(response.body).toMatchObject({ status: 'new', jobPostingId: job.id });
      expect(response.body.applicant.fullName).toBe(application.fullName);
      // The number is derived from the MR document number, which is how HR
      // reads an application back to the request that authorised it.
      expect(response.body.applicationNumber).toContain(job.mrNote);
    });

    it('lists the application for the tenant and for its job', async () => {
      const application = await applyToNewJob();

      const all = await api
        .get('/recruitment/applications')
        .query({ limit: 100 })
        .expect(200);
      expect(listed(all.body).map((item) => item.id)).toContain(application.id);

      const byJob = await api
        .get(`/recruitment/applications/by-job/${job.id}`)
        .expect(200);
      expect(listed(byJob.body).map((item) => item.id)).toContain(application.id);
    });

    it('finds an application by the candidate name', async () => {
      const application = await applyToNewJob();

      const response = await api
        .get('/recruitment/applications')
        .query({ search: application.fullName, limit: 100 })
        .expect(200);

      expect(listed(response.body).map((item) => item.id)).toEqual([application.id]);
    });

    it('answers 404 for an application that does not exist', async () => {
      await api.get(`/recruitment/applications/${MISSING_ID}`).expect(404);
      await api
        .put(`/recruitment/applications/${MISSING_ID}/interview`)
        .send({ interviewDate: '2026-06-01', interviewTime: '09:00' })
        .expect(404);
    });

    it('schedules an interview without moving the application forward', async () => {
      const application = await applyToNewJob();

      await api
        .put(`/recruitment/applications/${application.id}/interview`)
        .send({
          interviewDate: '2026-06-01',
          interviewTime: '09:00-10:00',
          interviewNote: 'สัมภาษณ์รอบแรก',
        })
        .expect(200);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(response.body.interviewTime).toBe('09:00-10:00');
      // Booking a slot is not a decision: the status only moves when a result
      // is recorded.
      expect(response.body.status).toBe('new');
    });

    it('rejects an interview time that is not HH:mm', async () => {
      const application = await applyToNewJob();

      const response = await api
        .put(`/recruitment/applications/${application.id}/interview`)
        .send({ interviewDate: '2026-06-01', interviewTime: '9am' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('interviewTime');
    });

    it('moves a passing candidate into the passed list', async () => {
      const application = await applyToNewJob();

      await api
        .put(`/recruitment/applications/${application.id}/result`)
        .send({ result: 'passed', resultDate: '2026-06-02', score: 80 })
        .expect(200);

      const response = await api
        .get('/recruitment/applications')
        .query({ status: 'passed', limit: 100 })
        .expect(200);
      expect(listed(response.body).map((item) => item.id)).toContain(application.id);
    });

    it('keeps a failed candidate out of the passed list and out of the offer stage', async () => {
      const application = await applyToNewJob();

      await api
        .put(`/recruitment/applications/${application.id}/result`)
        .send({ result: 'failed', resultDate: '2026-06-02', resultNote: 'ยังไม่ตรงคุณสมบัติ' })
        .expect(200);

      const passed = await api
        .get('/recruitment/applications')
        .query({ status: 'passed', limit: 100 })
        .expect(200);
      expect(listed(passed.body).map((item) => item.id)).not.toContain(application.id);

      // And the guard holds even if the UI lets someone try anyway.
      const offer = await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 30000 });
      expect(offer.status).toBe(400);
    });

    it('rejects a result outside the allowed set', async () => {
      const application = await applyToNewJob();

      const response = await api
        .put(`/recruitment/applications/${application.id}/result`)
        .send({ result: 'maybe', resultDate: '2026-06-02' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('result');
    });

    it('sets the status a recruiter picks from the board', async () => {
      const application = await applyToNewJob();

      await api
        .put(`/recruitment/applications/${application.id}/status`)
        .send({ status: 'screening' })
        .expect(200);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(response.body.status).toBe('screening');
    });

    // KNOWN DEFECT — `PUT /applications/:id/status` reads the status with
    // `@Body('status')` as a bare string and `updateApplicationStatus` casts it
    // with `as any` straight onto the entity. There is no DTO and no enum
    // check, and the column is a plain varchar(20), so any word at all is
    // persisted as a status and every list filter and guard downstream then
    // reasons about a value the domain does not define. Expected to fail until
    // the body is validated against JobApplicationStatus.
    test.failing('refuses a status that is not part of the lifecycle', async () => {
      const application = await applyToNewJob();

      const response = await api
        .put(`/recruitment/applications/${application.id}/status`)
        .send({ status: 'not-a-status' });

      expect(response.status).toBe(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // MO — the offer, and the hire it turns into
  // ───────────────────────────────────────────────────────────────────────

  describe('MO (offer) and hiring', () => {
    let job: JobPostingFixture;
    let link: RecruitmentLinkFixture;

    /** A candidate who has passed the interview — the entry point of an offer. */
    const passedCandidate = async (
      options: { email?: string | null } = {},
    ): Promise<ApplicationFixture> => {
      const application = await submitApplication(api, link, job.id, options);
      await api
        .put(`/recruitment/applications/${application.id}/result`)
        .send({ result: 'passed', resultDate: '2026-06-02' })
        .expect(200);
      return application;
    };

    /** Approves every pending MO step, the way approveMrFully does for an MR. */
    const approveMoFully = async (applicationId: string): Promise<void> => {
      for (let step = 0; step < 10; step += 1) {
        const current = await api
          .get(`/recruitment/applications/${applicationId}`)
          .expect(200);
        if (current.body.status !== 'mo_pending_approval') return;

        const response = await api
          .post(`/recruitment/applications/${applicationId}/mo/approve`)
          .send({ comment: 'อนุมัติข้อเสนอโดยชุดทดสอบ' });
        if (response.status >= 300) {
          throw new Error(
            `Could not approve MO ${applicationId} (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
          );
        }
      }
      throw new Error(`MO ${applicationId} never left the pending state`);
    };

    beforeAll(async () => {
      job = await createApprovedJobPosting(api, { headcount: 10 });
      link = await createRecruitmentLink(api, [job.id]);
    });

    it('puts an offer up for approval and opens its steps', async () => {
      const application = await passedCandidate();

      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 35000, offerPosition: 'เจ้าหน้าที่ทดสอบ' })
        .expect(200);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(response.body.status).toBe('mo_pending_approval');
      expect(Number(response.body.offerSalary)).toBe(35000);

      const approvals = await api
        .get(`/recruitment/applications/${application.id}/mo/approvals`)
        .expect(200);
      expect(listed(approvals.body).length).toBeGreaterThan(0);
      expect(listed(approvals.body).every((step: any) => step.status === 'pending')).toBe(true);

      const canApprove = await api
        .get(`/recruitment/applications/${application.id}/mo/can-approve`)
        .expect(200);
      expect(canApprove.body.canApprove).toBe(true);
    });

    it('creates a real employee record once the offer is fully approved', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 32000 })
        .expect(200);

      await approveMoFully(application.id);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      // A fully approved offer lands on 'mo_created', or straight on
      // 'onboarding' when the offer already carries a start date
      // (recruitment.service.ts sets workStartDate and skips ahead).
      expect(['mo_created', 'onboarding']).toContain(response.body.status);
      // An approved offer is not paperwork: the service hires the candidate,
      // and the employee it creates has to be a real, readable record.
      expect(response.body.employeeId).toEqual(expect.any(String));

      const employee = await api
        .get(`/employees/${response.body.employeeId}`)
        .expect(200);
      expect(employee.body.email).toBe(application.email);
    });

    it('refuses to hire the same candidate twice', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 31000 })
        .expect(200);
      await approveMoFully(application.id);

      const response = await api.post(
        `/recruitment/applications/${application.id}/create-employee`,
      );

      expect(response.status).toBe(400);
    });

    it('refuses to hire a candidate who left no e-mail address', async () => {
      // The candidate applied without an e-mail, so the automatic hire at the
      // end of the MO silently did nothing and HR is left to do it by hand.
      const application = await passedCandidate({ email: null });
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 30000 })
        .expect(200);
      await approveMoFully(application.id);

      const before = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(before.body.employeeId).toBeFalsy();

      const response = await api.post(
        `/recruitment/applications/${application.id}/create-employee`,
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('อีเมล');
    });

    it('refuses to hire a candidate whose offer is still pending', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 30000 })
        .expect(200);

      const response = await api.post(
        `/recruitment/applications/${application.id}/create-employee`,
      );
      expect(response.status).toBe(400);
    });

    it('sends a rejected offer back so HR can offer again', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 90000 })
        .expect(200);

      await api
        .post(`/recruitment/applications/${application.id}/mo/reject`)
        .send({ comment: 'เกินกรอบงบประมาณ' })
        .expect(201);

      const rejected = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(rejected.body.status).toBe('mo_rejected');
      expect(rejected.body.resultNote).toContain('เกินกรอบงบประมาณ');
      expect(rejected.body.employeeId).toBeFalsy();

      // mo_rejected is explicitly a state a new offer may start from.
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 40000 })
        .expect(200);
      const reopened = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(reopened.body.status).toBe('mo_pending_approval');
    });

    it('rejects an offer rejection with no comment', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 30000 })
        .expect(200);

      const response = await api
        .post(`/recruitment/applications/${application.id}/mo/reject`)
        .send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('comment');
    });

    it('refuses to approve an offer that is not waiting for approval', async () => {
      const application = await passedCandidate();

      const response = await api
        .post(`/recruitment/applications/${application.id}/mo/approve`)
        .send({ comment: 'อนุมัติทั้งที่ยังไม่มีข้อเสนอ' });

      expect(response.status).toBe(400);
    });

    it('answers 404 for the offer of an application that does not exist', async () => {
      await api.get(`/recruitment/applications/${MISSING_ID}/mo/approvals`).expect(404);
      await api.get(`/recruitment/applications/${MISSING_ID}/mo/can-approve`).expect(404);
      await api
        .post(`/recruitment/applications/${MISSING_ID}/mo/approve`)
        .send({})
        .expect(404);
    });

    it('refuses a start date before there is an approved offer', async () => {
      const application = await passedCandidate();

      const response = await api
        .put(`/recruitment/applications/${application.id}/start-date`)
        .send({ workStartDate: '2026-07-01' });

      expect(response.status).toBe(400);
    });

    it('moves the hire into onboarding when the start date is set', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 33000 })
        .expect(200);
      await approveMoFully(application.id);

      await api
        .put(`/recruitment/applications/${application.id}/start-date`)
        .send({ workStartDate: '2026-07-01' })
        .expect(200);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(response.body.workStartDate).toContain('2026-07-01');
      expect(response.body.status).toBe('onboarding');
    });

    it('rejects a start date that is not a date', async () => {
      const application = await passedCandidate();

      const response = await api
        .put(`/recruitment/applications/${application.id}/start-date`)
        .send({ workStartDate: 'next monday' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('workStartDate');
    });

    it('accepts the candidate when the start is confirmed', async () => {
      // No e-mail, so no employee record was created automatically — which is
      // the one path where confirmation is purely about the application.
      const application = await passedCandidate({ email: null });
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({ offerSalary: 30000, offerStartDate: '2026-07-01' })
        .expect(200);
      await approveMoFully(application.id);

      await api
        .post(`/recruitment/applications/${application.id}/confirm-start`)
        .expect(201);

      const response = await api
        .get(`/recruitment/applications/${application.id}`)
        .expect(200);
      expect(response.body.status).toBe('accepted');
      expect(response.body.confirmedAt).toBeTruthy();
    });

    it('refuses to confirm a start that was never scheduled', async () => {
      const application = await passedCandidate();

      const response = await api.post(
        `/recruitment/applications/${application.id}/confirm-start`,
      );

      expect(response.status).toBe(400);
    });

    // KNOWN DEFECT — `confirmStartDate` treats `offerNote` as JSON:
    //   const noteData = app.offerNote ? JSON.parse(app.offerNote) : null;
    // with no try/catch, while `CreateMoDto.offerNote` is validated as a free
    // `@IsString()` and the UI offers it as a notes field. A note a human typed
    // therefore raises a SyntaxError and the caller gets 500 instead of a
    // message about the missing probation evaluator. Worse, the application has
    // already been saved as `accepted` by then, so the failed call still moved
    // the record. Expected to fail until the parse is guarded.
    test.failing('answers 400, not 500, when the offer note is not JSON', async () => {
      const application = await passedCandidate();
      await api
        .put(`/recruitment/applications/${application.id}/mo`)
        .send({
          offerSalary: 30000,
          offerStartDate: '2026-07-01',
          offerNote: 'เริ่มงานหลังสงกรานต์',
        })
        .expect(200);
      await approveMoFully(application.id);

      const response = await api.post(
        `/recruitment/applications/${application.id}/confirm-start`,
      );

      expect(response.status).toBe(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Approval matrix — who may approve what
  // ───────────────────────────────────────────────────────────────────────

  describe('approval matrix', () => {
    let levelOne: LevelFixture;
    let levelTwo: LevelFixture;

    beforeAll(async () => {
      // The suite's earlier MR tests already put levels 1 and 2 in place; the
      // list endpoint is the honest way to find them again.
      const response = await api.get('/settings/levels').expect(200);
      const levels = listed(response.body);
      const find = async (level: number): Promise<LevelFixture> => {
        const found = levels.find((item: any) => item.level === level);
        return found ? { id: found.id, level } : createLevel(api, level);
      };
      levelOne = await find(1);
      levelTwo = await find(2);
    });

    it('stores the rows an administrator configures', async () => {
      await api
        .put('/recruitment/approval-matrix')
        .query({ kind: 'mr' })
        .send({
          entries: [
            { requestedLevel: levelOne.level, approverLevel: levelTwo.level },
            { requestedLevel: levelTwo.level, approverLevel: levelTwo.level },
          ],
        })
        .expect(200);

      const response = await api
        .get('/recruitment/approval-matrix')
        .query({ kind: 'mr' })
        .expect(200);

      expect(response.body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestedLevel: levelOne.level,
            approverLevel: levelTwo.level,
          }),
        ]),
      );
    });

    it('shares one configuration between MR and MO', async () => {
      await api
        .put('/recruitment/approval-matrix')
        .query({ kind: 'mr' })
        .send({
          entries: [{ requestedLevel: levelOne.level, approverLevel: levelTwo.level }],
        })
        .expect(200);

      // The offer stage reads the same rows, so configuring MR configures both.
      const response = await api
        .get('/recruitment/approval-matrix')
        .query({ kind: 'mo' })
        .expect(200);

      expect(response.body.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestedLevel: levelOne.level,
            approverLevel: levelTwo.level,
          }),
        ]),
      );
    });

    it('refuses an approver junior to the level being requested', async () => {
      const response = await api
        .put('/recruitment/approval-matrix')
        .query({ kind: 'mr' })
        .send({
          entries: [{ requestedLevel: levelTwo.level, approverLevel: levelOne.level }],
        });

      expect(response.status).toBe(400);
    });

    it('refuses a level the tenant does not have', async () => {
      const response = await api
        .put('/recruitment/approval-matrix')
        .query({ kind: 'mr' })
        .send({ entries: [{ requestedLevel: 1, approverLevel: 250 }] });

      expect(response.status).toBe(400);
    });

    it('rejects a request that does not say which matrix it means', async () => {
      const missingKind = await api.get('/recruitment/approval-matrix');
      expect(missingKind.status).toBe(400);

      const wrongKind = await api
        .get('/recruitment/approval-matrix')
        .query({ kind: 'payroll' });
      expect(wrongKind.status).toBe(400);
    });
  });
});
