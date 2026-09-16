/**
 * A thin, readable wrapper over supertest.
 *
 * Suites should express intent — "as HR admin, list the employees" — not URL
 * assembly and header bookkeeping. The client owns the global route prefix,
 * the bearer token and the tenant header so specs stay about behaviour.
 *
 *   const api = await apiClient();
 *   const res = await api.get('/employees').query({ page: 1 });
 */
import { INestApplication } from '@nestjs/common';
import request, { Test as SuperTest } from 'supertest';

import { loadTestEnv } from './env';
import { getTestContext } from './test-app';

export interface Actor {
  /** Bearer token sent on every request. Omit for an anonymous caller. */
  token?: string;
  /** Tenant the requests are scoped to. Omit to send no tenant context. */
  tenantId?: string;
}

export interface ApiClient {
  get(path: string): SuperTest;
  post(path: string): SuperTest;
  put(path: string): SuperTest;
  patch(path: string): SuperTest;
  delete(path: string): SuperTest;
  /** Same endpoints, different credentials. */
  as(actor: Actor): ApiClient;
  /** Strips all credentials — for testing that a route is actually guarded. */
  anonymous(): ApiClient;
}

/** The default actor: the system token, scoped to the suite's test tenant. */
export function systemActor(): Actor {
  const env = loadTestEnv();
  return { token: env.jwtSecret, tenantId: env.tenantId };
}

export async function apiClient(actor: Actor = systemActor()): Promise<ApiClient> {
  const { app } = await getTestContext();
  return buildClient(app, actor);
}

function buildClient(app: INestApplication, actor: Actor): ApiClient {
  const prefix = loadTestEnv().apiPrefix;
  const server = app.getHttpServer();

  const url = (path: string) => `/${prefix}/${path.replace(/^\/+/, '')}`;

  const send = (method: 'get' | 'post' | 'put' | 'patch' | 'delete') => (path: string) => {
    let req = request(server)[method](url(path));
    if (actor.token) req = req.set('Authorization', `Bearer ${actor.token}`);
    if (actor.tenantId) req = req.set('x-tenant-id', actor.tenantId);
    return req;
  };

  return {
    get: send('get'),
    post: send('post'),
    put: send('put'),
    patch: send('patch'),
    delete: send('delete'),
    as: (next: Actor) => buildClient(app, next),
    anonymous: () => buildClient(app, {}),
  };
}
