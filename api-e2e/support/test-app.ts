/**
 * Boots the real `AppModule` once per Jest worker and hands the suites an
 * initialised Nest application plus its DataSource.
 *
 * The application is configured exactly like `src/main.ts` (global prefix,
 * ValidationPipe, exception filter) so that a request in a test travels the
 * same pipeline as a request in production. The only things replaced are the
 * external systems a test machine has no business needing:
 *
 *   - the ZK time-attendance MSSQL connection (a separate appliance database)
 *   - the Central API client (a separate service that owns tenant lifecycle)
 *
 * Everything else — the HR database, guards, interceptors — is the real thing.
 *
 * `@api/...` resolves to the sibling hr-api-dup checkout's `src/...`; the
 * mapping lives in jest.config.js so the path to that checkout is configured
 * in exactly one place.
 */
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { loadTestEnv } from './env';

loadTestEnv();

import { AppModule } from '@api/app.module';
import { HttpExceptionFilter } from '@api/common/filters/http-exception.filter';
import { IclockTransaction } from '@api/modules/zk-sync/entities/iclock-transaction.entity';
import { CentralApiService } from '@api/common/services/central-api.service';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

let context: TestContext | undefined;
let booting: Promise<TestContext> | undefined;

/** Boots (or returns the already-booted) application for this Jest worker. */
export async function getTestContext(): Promise<TestContext> {
  if (context) return context;
  booting ??= boot();
  context = await booting;
  return context;
}

/** Tears the application down. Called from the global Jest teardown hook. */
export async function closeTestContext(): Promise<void> {
  if (!context) return;
  await context.app.close();
  context = undefined;
  booting = undefined;
}

async function boot(): Promise<TestContext> {
  const env = loadTestEnv();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // The ZK appliance lives on a separate MSSQL box; stub the connection so
    // booting the app does not depend on it.
    .overrideProvider(getDataSourceToken('zk'))
    .useValue(stubDataSource())
    .overrideProvider(getRepositoryToken(IclockTransaction, 'zk'))
    .useValue(stubRepository())
    // Tenant lifecycle is owned by Central; in tests every tenant is active.
    .overrideProvider(CentralApiService)
    .useValue(stubCentralApi())
    .compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix(env.apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          errors: errors.map((error) =>
            error.constraints
              ? `${error.property}: ${Object.values(error.constraints).join(', ')}`
              : `${error.property} has invalid value`,
          ),
        }),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();

  return { app, dataSource: app.get(DataSource) };
}

function stubDataSource() {
  return {
    isInitialized: true,
    getRepository: () => stubRepository(),
    query: async () => [],
    destroy: async () => undefined,
  };
}

function stubRepository() {
  return {
    find: async () => [],
    findOne: async () => null,
    save: async (entity: unknown) => entity,
    count: async () => 0,
    createQueryBuilder: () => {
      throw new Error('The ZK connection is stubbed in tests — mock the service instead.');
    },
  };
}

function stubCentralApi() {
  return {
    getTenantStatus: async (tenantId: string) => ({ id: tenantId, status: 'active' }),
    ensureTenantActive: async () => undefined,
    validateSystemToken: async () => ({ valid: true }),
    getTenantData: async () => null,
    getTenantDataWithToken: async () => null,
    getModuleRoles: async () => [],
  };
}
