/**
 * Roles and role permissions.
 *
 * This module decides what every user in the product is allowed to see, so
 * the questions worth asking are less about CRUD and more about exposure:
 * who can read the role catalogue, and whose permissions come back.
 */
import { ApiClient, apiClient } from '../support/api-client';
import { hrApi, hrUser } from '../support/auth';
import { ensureTestTenant, purgeTestTenantData } from '../support/db';

interface Role {
  id: string;
  name: string;
}

interface RolePermission {
  roleId: string;
  roleName: string;
  menuKey: string;
  permissionType: string;
  tenantId: number | string;
}

describe('Roles (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();
    api = await hrApi();
  });

  afterAll(purgeTestTenantData);

  describe('GET /roles', () => {
    it('returns the role catalogue', async () => {
      const response = await api.get('/roles').expect(200);

      expect(Array.isArray(response.body.roles)).toBe(true);
      for (const role of response.body.roles as Role[]) {
        expect(role.id).toEqual(expect.any(String));
        expect(role.name).toEqual(expect.any(String));
      }
    });

    it('includes the HR_ADMIN role the suites authenticate with', async () => {
      const response = await api.get('/roles').expect(200);

      const names = (response.body.roles as Role[]).map((role) => role.name);
      expect(names).toContain('HR_ADMIN');
    });

    // KNOWN DEFECT (security) — RolesController carries no guard at all, so the
    // role catalogue is readable by anyone who can reach the API. Expected to
    // fail until a guard is added.
    test.failing('refuses to list roles for an anonymous caller', async () => {
      await api.anonymous().get('/roles').expect(401);
    });
  });

  describe('GET /roles/permissions', () => {
    it('returns the permission map for the caller tenant', async () => {
      const response = await api.get('/roles/permissions').expect(200);

      expect(Array.isArray(response.body.rolePermissions)).toBe(true);
      for (const permission of response.body.rolePermissions as RolePermission[]) {
        expect(permission.roleId).toEqual(expect.any(String));
        expect(permission.menuKey).toEqual(expect.any(String));
        expect(permission.permissionType).toEqual(expect.any(String));
      }
    });

    it('scopes every returned permission to the tenant that was asked for', async () => {
      const actor = await hrUser();
      const response = await api.get('/roles/permissions').expect(200);

      const tenants = new Set(
        (response.body.rolePermissions as RolePermission[]).map((permission) =>
          String(permission.tenantId),
        ),
      );

      // The suite tenant is new and has no permissions of its own, so the only
      // acceptable answer is an empty set — never another tenant's rows.
      for (const tenantId of tenants) {
        expect(tenantId).toBe(String(actor.tenantId));
      }
    });

    // KNOWN DEFECT (security) — the endpoint takes the tenant from a header or
    // query parameter and applies no guard, so an unauthenticated caller can
    // read any tenant's permission map by guessing its id.
    test.failing('refuses to serve another tenant permissions to an anonymous caller', async () => {
      const response = await api
        .anonymous()
        .get('/roles/permissions')
        .query({ tenantId: '3' });

      expect(response.status).toBe(401);
    });
  });
});
