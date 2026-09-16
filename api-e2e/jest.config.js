/**
 * Jest configuration for the API e2e suites.
 *
 * These specs live in hrplus but exercise the NestJS application in the
 * sibling `hr-api-dup` checkout: they import its `AppModule` and boot it
 * in-process, which is what lets them assert real behaviour against a real
 * database instead of poking a running server from the outside.
 *
 * hrplus deliberately has no node_modules of its own — the toolchain
 * (jest, ts-jest, @nestjs/testing, supertest, typeorm …) is resolved from the
 * API checkout, so there is exactly one copy of every dependency and no chance
 * of the two drifting apart. `npm run test:api` runs jest straight out of it.
 */
const path = require('path');

/** The sibling API checkout. Override with API_ROOT if it lives elsewhere. */
const apiRoot = process.env.API_ROOT
  ? path.resolve(process.env.API_ROOT)
  : path.resolve(__dirname, '..', '..', 'hr-api-dup');

module.exports = {
  rootDir: __dirname,
  // .ts first: the API tree carries a stale compiled update-employment.dto.js
  // that would otherwise shadow its TypeScript source.
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  testRegex: 'specs/.*\.e2e-spec\.ts$',
  transform: {
    '^.+\.(t|j)s$': [
      require.resolve('ts-jest', { paths: [apiRoot] }),
      { isolatedModules: true, tsconfig: path.join(apiRoot, 'tsconfig.json') },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/support/jest.setup.ts'],
  moduleNameMapper: {
    // `@api/...` is the API's `src/...` — see support/test-app.ts.
    '^@api/(.*)$': path.join(apiRoot, 'src', '$1'),
    '^src/(.*)$': path.join(apiRoot, 'src', '$1'),
    '^sharp$': '<rootDir>/__mocks__/sharp.js',
  },
  // Dependencies live in the API checkout, not here.
  modulePaths: [path.join(apiRoot, 'node_modules')],
  /**
   * Results print as each test finishes rather than a file at a time — see
   * live-reporter.js. `JEST_REPORTER=default` restores Jest's own output, and
   * `--json` is unaffected either way.
   */
  reporters:
    process.env.JEST_REPORTER === 'default'
      ? ['default']
      : [path.join(__dirname, 'live-reporter.js'), 'summary'],
  // The application logs a lot on boot and on every login. With results
  // streaming past, that noise is what you would have to read around, so it is
  // off unless asked for: `E2E_APP_LOGS=1` brings it back when a test needs
  // debugging.
  silent: !process.env.E2E_APP_LOGS,
  testTimeout: 60000,
  // Each worker gets its own tenant (support/env.ts), so workers cannot see each
  // other's data. 79% of a serial run was spent booting the app once per file;
  // workers boot in parallel instead of in a queue. Override with E2E_WORKERS.
  maxWorkers: Number(process.env.E2E_WORKERS ?? 4),
  verbose: true,
  forceExit: true,
};
