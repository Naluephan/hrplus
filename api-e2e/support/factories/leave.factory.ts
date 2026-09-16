/**
 * Leave fixtures: leave types and leave requests, created through the API.
 */
import { ApiClient } from '../api-client';
import { uniqueName } from '../db';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
}

export async function createLeaveType(
  api: ApiClient,
  overrides: Partial<LeaveType> & { maxDaysPerYear?: number; allowHalfDay?: boolean } = {},
): Promise<LeaveType> {
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const payload = {
    code: overrides.code ?? `E2E-${suffix}`.slice(0, 50),
    name: overrides.name ?? uniqueName('ลาทดสอบ'),
    isPaid: true,
    maxDaysPerYear: overrides.maxDaysPerYear ?? 10,
    allowHalfDay: overrides.allowHalfDay ?? true,
    status: '1',
  };

  const response = await api.post('/leaves/type').send(payload);
  if (response.status >= 300 || !response.body?.id) {
    throw new Error(
      `Failed to create leave type fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { id: response.body.id, code: payload.code, name: payload.name };
}

/**
 * Grants an employee a leave balance for a year.
 *
 * A leave request is refused outright when the employee has no entitlement
 * for the year in question, so this is a prerequisite of any leave scenario.
 */
export async function grantEntitlement(
  api: ApiClient,
  input: { employeeId: string; leaveTypeId: string; year?: number; days?: number },
): Promise<void> {
  const response = await api.post('/leave-entitlements').send({
    leaveTypeId: input.leaveTypeId,
    year: input.year ?? new Date().getFullYear(),
    items: [{ employeeId: input.employeeId, days: input.days ?? 10, hours: 0 }],
  });

  if (response.status >= 300) {
    throw new Error(
      `Failed to grant leave entitlement (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
}

export async function requestLeave(
  api: ApiClient,
  input: {
    employeeId: string;
    leaveTypeId: string;
    startDate?: string;
    endDate?: string;
    reason?: string;
  },
): Promise<LeaveRequest> {
  const payload = {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    startDate: input.startDate ?? '2026-03-02',
    endDate: input.endDate ?? '2026-03-02',
    reason: input.reason ?? 'ทดสอบระบบลา',
  };

  const response = await api.post('/leaves/request').send(payload);
  if (response.status >= 300) {
    throw new Error(
      `Failed to create leave request fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  const id = response.body?.id ?? response.body?.leave?.id;
  if (!id) {
    throw new Error(`Leave request fixture returned no id: ${JSON.stringify(response.body)}`);
  }

  return { id, ...payload };
}
