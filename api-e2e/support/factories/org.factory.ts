/**
 * Organisation-structure fixtures (department, position).
 *
 * Every factory goes through the public API, so a fixture is by definition a
 * record the application itself would have produced.
 */
import { ApiClient } from '../api-client';
import { uniqueCode, uniqueName } from '../db';

export interface Department {
  id: string;
  code: string;
  nameTh: string;
}

export interface Position {
  id: string;
  code: string;
  nameTh: string;
  departmentId: string;
}

export async function createDepartment(
  api: ApiClient,
  overrides: Partial<Department> = {},
): Promise<Department> {
  const payload = {
    code: overrides.code ?? uniqueCode(),
    nameTh: overrides.nameTh ?? uniqueName('แผนกทดสอบ'),
    nameEn: uniqueName('Test Department'),
  };

  const response = await api.post('/departments').send(payload);
  expectCreated(response, 'department');

  return { ...payload, id: response.body.id };
}

export async function createPosition(
  api: ApiClient,
  departmentId: string,
  overrides: Partial<Position> = {},
): Promise<Position> {
  const payload = {
    code: overrides.code ?? uniqueCode(),
    nameTh: overrides.nameTh ?? uniqueName('ตำแหน่งทดสอบ'),
    nameEn: uniqueName('Test Position'),
    departmentId,
  };

  const response = await api.post('/positions').send(payload);
  expectCreated(response, 'position');

  return { ...payload, id: response.body.id, departmentId };
}

/**
 * Fails loudly with the server's own error body. A factory that silently
 * returns an undefined id turns one real failure into a dozen confusing ones.
 */
function expectCreated(response: { status: number; body: any }, what: string): void {
  if (response.status >= 300 || !response.body?.id) {
    throw new Error(
      `Failed to create ${what} fixture (HTTP ${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
}
