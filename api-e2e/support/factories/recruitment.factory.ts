/**
 * Recruitment fixtures: manpower requests (MR), application links and the
 * applications that arrive through them.
 *
 * The module is a chain — an MR has to be approved before a link may point at
 * it, and a link has to exist before anyone can apply — so the factories are
 * written as the steps of that chain rather than as one opaque "make me an
 * application" helper. A spec composes only the steps it needs, and a failure
 * names the step that broke.
 */
import { ApiClient } from '../api-client';
import { uniqueName } from '../db';

export interface JobPostingFixture {
  id: string;
  title: string;
  /** The MR document number; unique per tenant, so tests may search on it. */
  mrNote: string;
}

export interface RecruitmentLinkFixture {
  id: string;
  /** Public token the applicant form posts to. */
  token: string;
  jobPostingIds: string[];
}

export interface ApplicationFixture {
  id: string;
  fullName: string;
  email?: string;
}

export interface CreateJobPostingOptions {
  title?: string;
  mrNote?: string;
  department?: string;
  position?: string;
  headcount?: number;
  /** Set to gate the MR behind an approver level from the approval matrix. */
  requiredLevelId?: string;
  [key: string]: unknown;
}

/**
 * Creates an MR. It starts life as `mrStatus: 'pending_approval'` — the
 * service forces that regardless of the payload — so it is not yet usable for
 * a recruitment link.
 */
export async function createJobPosting(
  api: ApiClient,
  options: CreateJobPostingOptions = {},
): Promise<JobPostingFixture> {
  const { title, mrNote, ...rest } = options;
  const payload = {
    title: title ?? uniqueName('ตำแหน่งทดสอบ'),
    // mr_note is unique per tenant, so every fixture brings its own.
    mrNote: mrNote ?? uniqueName('MR-E2E').replace(/\s+/g, '-').slice(0, 60),
    department: 'ฝ่ายทดสอบ',
    position: 'เจ้าหน้าที่ทดสอบ',
    headcount: 1,
    employmentType: 'พนักงานประจำ',
    ...rest,
  };

  const response = await api.post('/recruitment/jobs').send(payload);
  expectCreated(response, 'job posting');

  return { id: response.body.id, title: payload.title, mrNote: payload.mrNote };
}

/**
 * Walks an MR through every pending approval step until it is approved.
 *
 * The number of steps is configuration, not a constant: an MR without a
 * required level gets three unrestricted steps, while one with a level gets a
 * step per row of the approval matrix. Looping on the reported `mrStatus`
 * keeps the fixture correct under either setup.
 */
export async function approveMrFully(api: ApiClient, jobPostingId: string): Promise<void> {
  await api.post(`/recruitment/jobs/${jobPostingId}/mr/submit`).send({}).expect(201);

  for (let step = 0; step < 10; step += 1) {
    const posting = await api.get(`/recruitment/jobs/${jobPostingId}`).expect(200);
    if (posting.body.mrStatus === 'approved') return;

    const response = await api
      .post(`/recruitment/jobs/${jobPostingId}/mr/approve`)
      .send({ comment: 'อนุมัติโดยชุดทดสอบ' });

    if (response.status >= 300) {
      throw new Error(
        `Could not approve MR ${jobPostingId} (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
      );
    }
  }

  throw new Error(`MR ${jobPostingId} never reached the approved state`);
}

/** An MR that is already approved — the usual starting point for a link. */
export async function createApprovedJobPosting(
  api: ApiClient,
  options: CreateJobPostingOptions = {},
): Promise<JobPostingFixture> {
  const posting = await createJobPosting(api, options);
  await approveMrFully(api, posting.id);
  return posting;
}

export async function createRecruitmentLink(
  api: ApiClient,
  jobPostingIds: string[],
  overrides: Record<string, unknown> = {},
): Promise<RecruitmentLinkFixture> {
  const response = await api
    .post('/recruitment/links')
    .send({ title: uniqueName('ลิงก์รับสมัครทดสอบ'), jobPostingIds, ...overrides });

  expectCreated(response, 'recruitment link');

  return { id: response.body.id, token: response.body.token, jobPostingIds };
}

export interface SubmitApplicationOptions {
  fullName?: string;
  /** Omit deliberately to test the paths that need an applicant e-mail. */
  email?: string | null;
  phone?: string;
  applicationSource?: string;
}

/**
 * Applies for a job the way the public form does: through the link token.
 *
 * The request is sent with the suite's credentials purely for convenience —
 * the endpoint itself is unauthenticated and derives the tenant from the link.
 */
export async function submitApplication(
  api: ApiClient,
  link: RecruitmentLinkFixture,
  jobPostingId: string,
  options: SubmitApplicationOptions = {},
): Promise<ApplicationFixture> {
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const fullName = options.fullName ?? `ผู้สมัคร ทดสอบ${suffix}`;
  const email = options.email === null ? undefined : (options.email ?? `e2e.${suffix}@example.test`);

  const payload: Record<string, unknown> = {
    fullName,
    phone: options.phone ?? '0800000000',
    applicationSource: options.applicationSource ?? 'เว็บไซต์บริษัท',
  };
  if (email) payload.email = email;

  const response = await api
    .post(`/recruitment/apply/${link.token}/jobs/${jobPostingId}`)
    .send(payload);

  if (response.status >= 300 || !response.body?.applicationId) {
    throw new Error(
      `Failed to submit an application (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { id: response.body.applicationId, fullName, email };
}

/** A level in the tenant's level ladder — the unit the approval matrix speaks in. */
export interface LevelFixture {
  id: string;
  level: number;
}

export async function createLevel(api: ApiClient, level: number): Promise<LevelFixture> {
  const response = await api
    .post('/settings/levels')
    .send({ nameTh: uniqueName(`ระดับ ${level}`), level });

  expectCreated(response, `level ${level}`);
  return { id: response.body.id, level };
}

/** Fails loudly with the server's own error body. See org.factory. */
function expectCreated(response: { status: number; body: any }, what: string): void {
  if (response.status >= 300 || !response.body?.id) {
    throw new Error(
      `Failed to create ${what} fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
}
