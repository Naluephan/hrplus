/**
 * Employee fixtures.
 *
 * `createEmployee` builds the minimum an employee needs to exist; pass
 * overrides for the fields the test under way actually cares about, and leave
 * everything else to the defaults so the spec reads as its own intent.
 */
import { ApiClient } from '../api-client';
import { uniqueName } from '../db';

export interface EmployeeFixture {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  departmentId?: string;
  positionId?: string;
}

export interface CreateEmployeeOptions {
  firstName?: string;
  lastName?: string;
  email?: string;
  departmentId?: string;
  positionId?: string;
  startDate?: string;
  salary?: number;
}

export async function createEmployee(
  api: ApiClient,
  options: CreateEmployeeOptions = {},
): Promise<EmployeeFixture> {
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4);

  const payload = {
    firstName: options.firstName ?? 'ทดสอบ',
    lastName: options.lastName ?? `พนักงาน${suffix}`,
    email: options.email ?? `e2e.${suffix}@example.test`,
    departmentId: options.departmentId,
    positionId: options.positionId,
    startDate: options.startDate ?? '2024-01-01',
    salary: options.salary,
  };

  const response = await postWithDeadlockRetry(api, stripUndefined(payload));

  if (response.status >= 300 || !response.body?.id) {
    throw new Error(
      `Failed to create employee fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return {
    id: response.body.id,
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    departmentId: payload.departmentId,
    positionId: payload.positionId,
  };
}

/**
 * Creating an employee is a long transaction: it writes the employee, its login
 * and its leave entitlements for every active leave type. Four Jest workers doing
 * that at once take the same row locks in different orders, and MySQL resolves it
 * by killing one of them ("Deadlock found when trying to get lock"). That is the
 * database working as designed — the loser is expected to try again — so the
 * fixture retries rather than failing a test for a collision it did not cause.
 */
async function postWithDeadlockRetry(
  api: ApiClient,
  payload: Record<string, unknown>,
  attempts = 4,
): Promise<{ status: number; body: any }> {
  let response = await api.post('/employees').send(payload);

  for (let attempt = 1; attempt < attempts && isDeadlock(response); attempt += 1) {
    // Back off a little, and differently per worker, so the retries do not
    // collide with each other the way the original writes just did.
    await new Promise((resolve) =>
      setTimeout(resolve, 100 * attempt + Math.floor(Math.random() * 150)),
    );
    response = await api.post('/employees').send(payload);
  }

  return response;
}

function isDeadlock(response: { status: number; body?: any }): boolean {
  if (response.status < 500) return false;
  const message = String(response.body?.message ?? '');
  return message.includes('Deadlock') || message.includes('Lock wait timeout');
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
