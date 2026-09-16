/**
 * Creates the API e2e test database (if missing) and brings its schema up to date.
 *
 *   npm run test:api:setup
 *
 * Reads hrplus/.env.test, so it can never touch the development database by
 * accident, and runs the migrations from the sibling hr-api-dup checkout,
 * which is where they live.
 */
const path = require('path');
const { execFileSync } = require('child_process');

/** The sibling API checkout. Override with API_ROOT if it lives elsewhere. */
const apiRoot = process.env.API_ROOT
  ? path.resolve(process.env.API_ROOT)
  : path.resolve(__dirname, '..', '..', 'hr-api-dup');

// hrplus has no node_modules of its own; borrow the API checkout's.
const apiRequire = require('module').createRequire(path.join(apiRoot, 'package.json'));
const mysql = apiRequire('mysql2/promise');

apiRequire('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });

const database = process.env.DB_DATABASE;

async function main() {
  if (!/(^|[_-])test($|[_-])/i.test(database ?? '')) {
    throw new Error(
      `DB_DATABASE in .env.test is "${database}". Point it at a dedicated test database.`,
    );
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.end();
  console.log(`✔ database ${database} ready`);

  // Run in the API checkout: that is where typeorm.config.ts and the
  // migrations are. The env above is inherited, so it targets the test database.
  execFileSync('npm', ['run', 'migration:run'], {
    stdio: 'inherit',
    shell: true,
    cwd: apiRoot,
    env: { ...process.env },
  });
  console.log(`✔ migrations applied to ${database}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
