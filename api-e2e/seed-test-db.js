/**
 * Seeds the API e2e test database with the master data the application
 * expects to find (countries, nationalities, banks, roles, employee statuses,
 * document categories, the default tenant and its demo records).
 *
 *   npm run test:api:seed
 *
 * Reads hrplus/.env.test and runs the API checkout's own seeders against it,
 * so the test database is populated exactly the way a real one would be.
 *
 * Destructive by design: the seeders DELETE every row of the tables they own
 * (including `tenants`) before writing their own. That is safe here — the guard
 * below refuses to run against anything but a test database — but it does mean
 * seeding throws away whatever the e2e suites left behind. The suites re-create
 * their own tenant in `beforeAll`, so the order you run them in does not matter.
 */
const path = require('path');
const { execFileSync } = require('child_process');

/** The sibling API checkout. Override with API_ROOT if it lives elsewhere. */
const apiRoot = process.env.API_ROOT
  ? path.resolve(process.env.API_ROOT)
  : path.resolve(__dirname, '..', '..', 'hr-api-dup');

// hrplus has no node_modules of its own; borrow the API checkout's.
const apiRequire = require('module').createRequire(path.join(apiRoot, 'package.json'));
apiRequire('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });

const database = process.env.DB_DATABASE;

if (!/(^|[_-])test($|[_-])/i.test(database ?? '')) {
  console.error(
    `DB_DATABASE in .env.test is "${database}". Seeding refuses to run against a database that is not a test database.`,
  );
  process.exit(1);
}

console.log(`Seeding ${database} …`);

// Run in the API checkout: that is where the seeders and their entities live.
// The env loaded above is inherited, so they target the test database.
//
// TS_NODE_TRANSPILE_ONLY: without it, ts-node type-checks the whole ~150-entity
// graph before a single row is written and the seed appears to hang for many
// minutes. The seeders are already type-checked by `npm run build`; re-checking
// them here buys nothing.
execFileSync('npm', ['run', 'db:seed'], {
  stdio: 'inherit',
  shell: true,
  cwd: apiRoot,
  env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
});

console.log(`✔ seeded ${database}`);
