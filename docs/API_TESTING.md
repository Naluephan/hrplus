# API Testing — hrplus

The NestJS API's end-to-end suites live here, alongside the Robot Framework UI
suites, so that every automated test for HR Plus is in one project.

They are **not** black-box HTTP tests. Each spec boots the real `AppModule`
from the sibling `hr-api-dup` checkout in-process and drives it over HTTP with
supertest, against a real MySQL database. That is what lets them assert real
behaviour — and see a server-side stack trace when something breaks.

## Where each tier lives

| Tier | Location | Command | Touches the DB? |
| --- | --- | --- | --- |
| Unit (`src/**/*.spec.ts`) | `../hr-api-dup` | `npm test` *(in that repo)* | no |
| Controller (mocked services) | `../hr-api-dup/test/controller/` | `npm run test:controller` *(in that repo)* | no |
| **API E2E** | **`api-e2e/specs/`** | `npm run test:api` | **yes** |
| UI E2E (Robot Framework) | `tests/` | see [TESTING.md](TESTING.md) | via the app |

Every tier can be driven from here, whichever repo the files live in:

```powershell
npm run test:api:all        # unit + controller + e2e, in that order
npm run test:api            # e2e only
npm run test:api:unit       # delegates to hr-api-dup
npm run test:api:controller # delegates to hr-api-dup
```

Unit specs stay beside the code they test, and the controller specs stay with
them: a unit test that moves away from its module stops being seen by whoever
edits that module, and is the first thing to rot. The scripts above bridge the
two checkouts so you still get one command and one result. `hr-api-dup`'s
`npm run test:e2e` delegates the other way, so either entry point works.

## Layout

```
api-e2e/
  jest.config.js      # points at the sibling API checkout
  setup-test-db.js    # creates the test database and migrates it
  specs/              # the suites
  support/            # harness: app boot, api client, auth, db, factories
.env.test             # test-only environment (git-ignored)
```

## Prerequisites

- the `hr-api-dup` checkout beside this one, with `npm install` already run —
  hrplus keeps **no node_modules of its own**, the toolchain is resolved from
  there so the two cannot drift apart. Set `API_ROOT` if it lives elsewhere.
- a reachable MySQL server.

## Running

**One-time setup**

```powershell
Copy-Item .env.test.example .env.test   # then fill in DB_PASSWORD and JWT_SECRET
npm run test:api:setup                  # creates hr_system_test and runs the migrations
npm run test:api:seed                   # optional — master data and demo tenants
```

**Every run**

```powershell
npm run test:api
npm run test:api -- api-e2e/specs/leaves   # one suite
npm run test:api -- -t "approves"          # one test
```

### Watching a run

Results stream as each test finishes, rather than a file at a time:

```
✓ roles         GET /roles › returns the role catalogue 174ms
✓ organization  departments › creates a department and returns it by id 330ms
   1/2 ไฟล์ · ผ่าน 9 · ล้ม 0 · 90s
```

A failure prints its assertion line under it immediately, and every failure is
reprinted together at the end — on a two-minute run the first one has long
scrolled away. Timings over 800 ms are highlighted (`E2E_SLOW_MS` to change the
threshold).

The reporter is `api-e2e/live-reporter.js`, wired in `jest.config.js`. Two
escape hatches: `JEST_REPORTER=default` restores Jest's own output, and
`E2E_APP_LOGS=1` unmutes the application's own console noise, which is off by
default so the result lines stay readable. `--json` output is unaffected by
either.

### Parallel runs

Suites run on 4 workers by default (`E2E_WORKERS=1` for a serial run). Each
worker owns a tenant of its own — `<TEST_TENANT_ID>0<N>`, e.g. `900001` — so one
worker's purge can never touch another worker's rows.

`TEST_TENANT_ID` must be digits. Eight tables store `tenant_id` as an integer
(see *Data isolation* below); a UUID written there silently becomes `0`, which
would put every worker back into one shared tenant.

| Run | Wall time |
| --- | --- |
| serial (1 worker) | ~80 s |
| parallel (4 workers) | ~48 s |

Four fifths of a serial run was spent booting the application once per spec
file, not querying the database — which is why a faster database would not
have moved this number.

## Seeding

```powershell
npm run test:api:seed
```

Runs the API's own seeders against the test database. What you get:

| | rows |
| --- | --- |
| countries / nationalities | 249 / 272 |
| banks | 16 |
| leave types | 24 |
| roles, employee statuses, document categories | 3 / 5 / 5 |
| demo tenants (`1`, `3`, `4`, `6`) | 4 |
| employees across those tenants | 41 |
| departments / positions | 96 / 884 |
| work shift, attendance and overtime records | seeded per employee |

**Most suites do not need this.** They build every record they assert on
through the API, which keeps them independent of whatever is in the database.

**Two suites do need it.** `payroll.e2e-spec.ts` and `master-data.e2e-spec.ts`
read seeded tenant `3` and the master catalogues, because aggregates and
read-only catalogues have nothing to assert on an empty database. On an
unseeded database the payroll dashboard answers `404` (no such tenant) and the
country and bank lists come back empty — twelve failures that look like broken
code but are missing data. Run the seed, then rerun.

Seed also when you want realistic data to click through in the UI, to run the
Robot suites against, or to explore the API by hand.

**It is destructive.** The seeders `DELETE` every row of the tables they own —
including `tenants` — before writing their own. The same test-database guard as
above applies, so it cannot touch your development data, but it does discard
whatever a previous test run left behind. The suites re-create their own tenant
in `beforeAll`, so running seed and tests in either order is fine.

> Tenant ids in the seed data are short strings (`'1'`, `'3'`, …), not UUIDs.
> The e2e suites use their own UUID tenant (`TEST_TENANT_ID`) and never touch
> the seeded ones.

### Safety

`api-e2e/support/env.ts` refuses to start unless `DB_DATABASE` looks like a test
database (its name contains `test`). The suites delete rows; that guard is the
only thing standing between a mistyped env file and your development data.
`ALLOW_UNSAFE_TEST_DB=1` overrides it — don't.

---

## How an e2e suite is built

```ts
describe('Employees (e2e)', () => {
  let api: ApiClient;

  beforeAll(async () => {
    await ensureTestTenant();
    await purgeTestTenantData();   // a crashed previous run cannot poison this one
    api = await hrApi();           // a real HR admin, logged in via POST /auth/login
  });

  afterAll(purgeTestTenantData);

  it('creates an employee and echoes back the submitted identity', async () => {
    const response = await api.post('/employees').send({ ... }).expect(201);
    expect(response.body).toMatchObject({ firstName, lastName });
  });
});
```

### The support layer (`api-e2e/support/`)

| File | Responsibility |
| --- | --- |
| `env.ts` | Loads `.env.test`; refuses an unsafe database. |
| `test-app.ts` | Boots the API's real `AppModule` (imported as `@api/app.module`) with `main.ts`'s pipeline. Stubs only the ZK MSSQL appliance and the Central API. |
| `api-client.ts` | `api.get('/employees')` — owns the route prefix, bearer token and tenant header. `.as(actor)` / `.anonymous()` switch credentials. |
| `auth.ts` | Seeds one HR admin account and logs it in through the real `/auth/login`. |
| `db.ts` | `ensureTestTenant`, `purgeTestTenantData`, `uniqueCode`, `uniqueName`. |
| `factories/` | Fixtures created **through the API**, never by inserting rows. A fixture the API would not have produced is a fixture that tests nothing. |

### Conventions

- **One behaviour per test**, named as a sentence about the system:
  `'rejects a request whose employee id is not a UUID'`, not `'test validation'`.
- **Assert the observable outcome**, not the implementation. Create through the
  API, read back through the API.
- **No `Sleep`, no arbitrary waits.** Every assertion follows a completed request.
- **Fixtures fail loudly.** A factory that cannot create its record throws with
  the server's own error body, so one real failure does not become ten confusing ones.
- **Unique names.** `uniqueName('ฝ่ายบุคคล')` so a search assertion can target
  exactly one record regardless of what else is in the tenant.

---

## Known defects the suites document

These are recorded as `test.failing(...)`. Jest reports a `test.failing` test as
**passing while it still fails** and as **failing once it starts to pass** — so
when someone fixes the underlying bug, the suite tells them to delete the marker.

### Security — endpoints with no guard

`specs/authorization.e2e-spec.ts` holds the full list in one place, checked
against a running server rather than inferred from the source. Eighteen read
endpoints answer an anonymous caller who supplies nothing but a tenant id:

| Area | What a stranger can read |
| --- | --- |
| `/payroll/dashboard/*`, `/payroll-worktime` | Salary totals, headcount, per-department expenses, deductions |
| `/roles`, `/roles/permissions` | The role catalogue and any tenant's permission map |
| `/issue-reports`, `/issue-report-categories` | Staff complaints, including ones filed anonymously |
| `/probation/employees` | Who is on probation |
| `/announcements` | Internal announcements |
| `/hr-stock`, `/hr-stock/movements` | Stock levels and every movement |
| `/birthday-gifts`, `/birthday-gift-categories`, `/birthday-gift-selections` | Gift programme data |
| `/equipment-requisitions`, `/equipment-category-config` | Equipment requests |
| `/e-training`, `/company-documents` | Training and company documents |

Writes are exposed too: `POST /employees` creates employee records with no
authentication, while every other verb on that resource is guarded.
**Fixed 2026-09-15:** `/salary-access/*` and `/organization-settings` now use
`HrJwtAuthGuard`. Before that a stranger could remove every salary approver,
switch off the salary page idle timeout, or rewrite the company OT policy. The
suite now expects 401 for those reads and writes. `PATCH /organization-settings`
still types its body as a TypeScript `type`, so the payload is not validated.

`/employees` (read), `/notifications/my` and the `/tenants/*` administration
routes do require credentials — they are the control group in that suite.

### Data isolation — integer tenant_id columns

`specs/tenant-isolation.e2e-spec.ts`. `tenants.id` is `char(36)` and the product
addresses tenants by UUID (`Tenant.id` is declared `type: 'uuid'`; `LoginDto` and
`RegisterTenantDto` validate `tenantId` with `@IsUUID()`). Eight tenant-scoped
tables nonetheless declare `tenant_id` as an integer:

`work_shifts`, `work_shift_days`, `holiday_years`, `holiday_year_days`,
`notifications`, `notification_recipients`, `role_permissions`, `position_role`

MySQL is not in strict mode, so a UUID written to those columns is stored as `0`
without an error, and in a `WHERE` clause every UUID compares equal to `0`. Every
UUID tenant therefore shares one set of work shifts, holidays, notifications and
**role permissions** — one company's permission change applies to all of them,
and deleting one company's work shift deletes everyone's.

It is latent today only because the existing tenants happen to have numeric ids
(`1`, `3`, `4`, `6`). The first two tenants registered through the API with UUIDs
will collide. `role_permissions` and `position_role` also default `tenant_id` to
the hard-coded `3`.

The suite found it the hard way: with parallel workers on UUID tenants, one
worker's cleanup deleted the work shift another worker's leave test depended on.

### Approval paths with no state machine (found 2026-09-16)

`overtime.e2e-spec.ts` proves the overtime approval endpoints assign a status
without ever reading the current one (`approveByManager`, `acknowledgeByHR`,
`finalApprove`, `reject` in `overtime.service.ts`). A **rejected** request can
be approved; a **cancelled** request can be acknowledged back to `approved`,
and the monthly statistics then count hours HR struck off; HR can acknowledge a
still-`pending` request, skipping the manager. The module knows `cancelled` is
terminal — `adjustPayableHours` and `cancelOvertimeRecord` both guard on it —
the approval endpoints simply do not.

`salary-records.e2e-spec.ts` proves two more:

- a **locked** salary period still accepts new salary records: `create()` never
  loads the period or reads `isLocked`, though period edits do check it;
- a **paid** salary record can be recalculated: `calculate()` performs no status
  check and ends by setting the status back to `calculated`, so recalculating a
  paid record erases the payment state while leaving `paidAt` set.

### More unguarded endpoints (found 2026-09-16)

`SalaryRecordsController`, `SalaryPeriodsController`, `SalaryComponentsController`
and `SalaryDeductionsController` declare no guard: anyone who guesses a tenant id
can read and write that company's payroll. `SalaryPeriodsController` even imports
`HrJwtAuthGuard` and never applies it.

### Bodies typed as interfaces, so nothing is validated (found 2026-09-16)

Every `*Dto` in `overtime.service.ts` is a TypeScript `interface`, so the global
`ValidationPipe` has no class to validate against. `POST /overtime/rates` without
`dayType` reaches `dto.dayType.trim()` and answers **500** instead of 400. Same
family as the announcements and rejection-reasons defects above, and as
`PUT /recruitment/applications/:id/status`, which takes `@Body('status') status:
string` and persists any string as a lifecycle state.

### Recruitment (found 2026-09-16)

- `POST /jobs/:id/mr/duplicate` answers **500** for any MR that has a document
  number: `duplicateMr` copies `mrNote` and never re-generates it, against a
  `UNIQUE (tenant_id, mr_note)` index.
- `POST /applications/:id/confirm-start` answers **500** on a human-written offer
  note: `confirmStartDate` runs `JSON.parse(app.offerNote)` unguarded while the
  DTO accepts free text — and the application has already been saved as
  `accepted` before the throw, so the failed call still moves the record.
- Finishing an overtime session twice answers **404**, indistinguishable from a
  wrong id (`finishActiveSession` queries only `status: 'in_progress'`).

### Round two: the rest of the surface (2026-09-16)

Five more suites cover settings catalogues, KPI and 360, attendance and devices,
employee services and the employee profile. What they found, worst first:

**Anyone holding a link can grade anyone.** KPI evaluation links authenticate
nobody: `findAccessibleEvaluationAssignment` runs its evaluator check only for
callers who volunteer a token, and returns the assignment otherwise. A link
minted by `POST /kpi/evaluation-links` carries no `setup_id`, so the scope check
(`if (link.setupId && ...)`) is skipped and the token reaches every KPI
assignment in the tenant. Together: unauthenticated, tenant-wide read and write
of performance scores. The 360 links check their batch scope on the read and on
none of the writes (`managerConfirmReview`, `managerReturnForRevision`,
`submitEvaluatorAnswers`).

**Whole modules with no guard.** `DevicesController` imports `HrJwtAuthGuard` and
never applies it, so an anonymous caller can register a scanner and punch people
in and out. `GET /employee-daily-summaries/trigger` has no guard either and will
recompute every tenant's summaries. `GET /employees/dashboard` takes its tenants
from a query parameter and ignores the token. `EmployeeVehiclesController` has
its guard commented out.

**Tenants that are not separated.** `EmployeeStatusesService` accepts a
`tenantId` on every method and uses it nowhere, so one employee-status catalogue
is shared by every company. `getEmploymentInfoByEmployeeId` queries by employee
id alone. The holiday-year controllers take the tenant from the request body and
never compare it with the caller's, and `HolidayYearsService.remove` finds the
row by primary key alone — a neighbouring tenant can delete this tenant's
holiday calendar. The daily-summary list routes accept `filters.tenantId` from
the body.

**Data that quietly goes wrong.**

- `PATCH /organics-points/employees/:employeeId/points` resolves the row from
  `dto.balanceId` and ignores the path parameter, so a mismatched pair moves a
  different employee's points and reports success.
- Confirming receipt of equipment never deducts standalone stock
  (`receivedByEmployee` always calls the ERP transfer), so the goods are handed
  over while `hr_stocks` keeps them both on hand and reserved.
- `confirmPermanent` changes the employment type and leaves the probation
  sessions in place, so confirmed employees stay on HR's probation board.
- `POST /devices/sync` stamps `lastSyncAt`, logs the count and discards the
  punches (`// TODO: Process attendance logs from device`).
- The employee-code generator appends the running number twice on a tenant with
  no format configured (`EMP<year>0000100001`).
- `POST /employees/isCheckingUsername` compares against `employee_code`, not
  `employee_logins.username`, so a taken username is reported free.
- Provident funds: `updateFundPlan` compares `decimal` columns that MySQL returns
  as strings, so `"3.00" > "15.00"` and editing an ordinary plan answers 400;
  `formatRecordResponse` drops the stored amount of any percentage-based record.
- `equipment-category-config` deletes the row and answers 200 for any section
  outside `{uniform, it}` — a typo makes the item vanish from both screens.
- `GET /employees/userInformation/:id` returns the bcrypt password hash and the
  PIN hash.
- `SettingsBenefitsController` silently creates a tenant row for any unknown
  `tenantId`, and reactivates a suspended one.

Sixty-seven `test.failing` tests across the suite hold these to the behaviour
they should have: each one turns into a loud "unexpectedly passed" the day it is
fixed, naming what to delete.

### Correctness

| Where | Defect |
| --- | --- |
| `specs/employees.e2e-spec.ts` | Every query filter on `GET /employees` is silently ignored. The global `ValidationPipe` runs with `whitelist: true`, which strips the private `@Expose`-backed fields `ListEmployeesDto` uses to accept camelCase and snake_case; the getters then read `undefined`. An invalid `departmentId` is accepted too, instead of returning 400. |
| `specs/organization.e2e-spec.ts` | `departments.code` and `positions.code` are `varchar(2)` while the DTOs accept `Length(1, 3)`. A three-character code passes validation and is silently truncated on write. |
| `specs/master-data.e2e-spec.ts` | `POST /rejection-reasons` accepts an empty body with 201. `RejectionReasonsController` types its body as a plain TypeScript `type` rather than a decorated class, so the ValidationPipe has nothing to check and a reason with no text is created. |
| `specs/tenants.e2e-spec.ts` | `TenantsController` declares `@Controller('api/v1/tenants')` while the app already sets `api/v1` as its global prefix, so registration and payroll-sync routes are served at `/api/v1/api/v1/tenants/...`. |
| `specs/announcements.e2e-spec.ts` | `AnnouncementsController` types its body as `CreateAnnouncementDto \| undefined`. TypeScript emits `Object` for a union type, so the global `ValidationPipe` treats it as a native type and skips validation entirely — an announcement with no content, or an out-of-range status, is accepted with 201. |

### Behaviours worth knowing (not asserted as defects)

- `TenantScopeMiddleware` pins any request bearing the `JWT_SECRET` system token to the
  hard-coded tenant `'3'`, ignoring `x-tenant-id`. That is why the suites authenticate
  as a real logged-in HR user, and why reads of another tenant's seeded data use the
  system token deliberately.
- An HR token's own tenant wins over a mismatched `x-tenant-id` header. That is correct,
  and `specs/employees.e2e-spec.ts` asserts it.
- Creating employees concurrently collides on the generated account-access username
  (`IDX_employee_account_accesses_tenant_username_unique`). The suites create them one
  at a time.
- `GET /payroll/dashboard/summary` answers 404 for a tenant that has no salary period,
  so a brand-new tenant's payroll dashboard 404s rather than showing an empty state.
