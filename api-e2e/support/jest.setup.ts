/**
 * Runs before every e2e spec file.
 *
 * Jest gives each spec file its own module registry, so each file boots its
 * own application instance. This hook makes sure that instance — and the
 * database pool behind it — is closed again, otherwise Jest hangs on open
 * handles and the run looks like a timeout instead of a finished suite.
 */
import { closeTestContext } from './test-app';

jest.setTimeout(60_000);

afterAll(async () => {
  await closeTestContext();
});
