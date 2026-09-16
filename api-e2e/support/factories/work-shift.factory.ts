/**
 * Work-shift fixture.
 *
 * A tenant needs at least one work shift before anyone can request leave —
 * the leave engine reads the shift to work out how many days a request spans.
 * Suites that exercise leave call `ensureWorkShift` in their setup.
 */
import { ApiClient } from '../api-client';
import { uniqueName } from '../db';

/**
 * Monday–Friday working, weekend off; 08:00–17:00 with an hour for lunch.
 * Weekdays are 1–7 (Monday = 1), as the day DTO requires.
 */
const STANDARD_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorkingDay: weekday <= 5,
  workStartTime: '08:00',
  workEndTime: '17:00',
  breakStartTime: '12:00',
  breakEndTime: '13:00',
}));

export async function ensureWorkShift(api: ApiClient): Promise<{ id: string }> {
  const existing = await api.get('/work-shifts').query({ limit: 1 });
  const items = existing.body?.items ?? existing.body?.data ?? existing.body;
  if (Array.isArray(items) && items.length > 0) {
    return { id: items[0].id };
  }

  const response = await api.post('/work-shifts').send({
    code: `E2E${Date.now().toString(36).slice(-4)}`,
    name: uniqueName('กะทดสอบ'),
    shiftType: 'morning',
    attendanceCondition: 'by_shift_time',
    latePolicyType: 'grace_period',
    lateGraceMinutes: 15,
    isActive: true,
    days: STANDARD_WEEK,
  });

  if (response.status >= 300 || !response.body?.id) {
    throw new Error(
      `Failed to create work shift fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }

  return { id: response.body.id };
}
