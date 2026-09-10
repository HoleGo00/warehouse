# Multer Security Repair Evidence

## Delivery State

- Date: 2026-09-10, Asia/Shanghai.
- Worktree: `D:/GloryChips/glorychips-warehouse-query-export-admin`.
- Branch: `codex/warehouse-query-export-admin`, based on `4106317`.
- Implementation and automated validation complete; user accepted the repair
  and authorized the scoped local commit on 2026-09-10.
- Local work commit: `74b2eff30a7e699244feeb890492303a63ba962e`.
- Task archived on 2026-09-10; the journal follows as a separate bookkeeping step.
- No push, PR, merge, or deployment is authorized or performed.

## Change Summary

- Added `'@nestjs/platform-express@12.0.1>multer': 2.3.0` to existing workspace
  overrides, with a short rationale.
- Regenerated the lockfile through pnpm. Its diff is one override plus the
  Multer version/integrity and resolved dependency entries; no other package
  versions or existing overrides changed.
- Added ten regression tests in `apps/api/src/multer-security.http.test.ts`.
- Added the bounded process fixture `apps/api/test-fixtures/multer-security.mjs`.
- Confirmed that no security test fixture appears in `apps/api/dist`.
- No production controllers, schemas, stock logic, or authorization rules changed.

## Security Audit

Commands before and after:

```bash
pnpm audit --prod --registry=https://registry.npmjs.org --json
pnpm -r why multer
```

Both audit commands exited 1 because findings exist. Their valid JSON payloads,
not the exit status alone, establish the result.

| Severity | Before | After |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 6 | 3 |
| Moderate | 2 | 2 |
| Low | 1 | 0 |
| Total | 9 | 5 |

All four targeted advisories disappeared, with no newly added advisory IDs:

- GHSA-wc9g-mqfw-jrwm
- GHSA-qfvm-cv95-jqjf
- GHSA-535w-7cp7-47q4
- GHSA-qvfw-j98x-7q72

`pnpm -r why multer` shows one resolved version, 2.3.0, for the API and worker
paths. The regression suite independently resolves the parser from both installed
Nest dependency chains and asserts the same parser entry.

Remaining findings are deferred, not suppressed or accepted as harmless:

| Package | Severity | Advisory |
| --- | --- | --- |
| decode-uri-component | High | GHSA-w573-4hg7-7wgq |
| decode-uri-component | Moderate | GHSA-vcc3-ghjq-m6fr |
| deepmerge-ts | High | GHSA-ggr8-5vv4-36mx |
| mysql2 | High | GHSA-3f6p-5ww8-9rcr |
| mysql2 | Moderate | GHSA-rgwj-5xj2-c3m3 |

## Regression Results

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --registry=https://registry.npmjs.org` | Passed, including Prisma generation |
| `pnpm lint` | Passed, zero lint warnings |
| `pnpm typecheck` | Passed across all packages after final test edits |
| `pnpm test` | 43 files, 191 tests passed, including 10 new tests |
| `pnpm build` | Passed; frontend chunk-size warning remains |
| Isolated PostgreSQL integration suite | 10 files, 71 tests passed, 1 capacity test skipped by existing configuration |
| Prettier check on changed dependency/test files | Passed |
| `git diff --check` | Passed |

The Nest test application verifies a valid file at the configured size boundary,
HTTP 413 for an oversized file, HTTP 400 for an unexpected file field, and
forwarding of the array-index limit. Test endpoints are not production modules.

Five additional cases run in child processes bounded to ten seconds, using the
actual adapter-resolved parser:

- Crafted field names return `INVALID_FIELD_NAME` instead of escaping handling.
- Array indices above the explicit bound return `LIMIT_FIELD_ARRAY_INDEX`.
- A delayed accepting file filter still enforces the file-size limit.
- Three mid-write aborted requests release real file streams and remove files.
- Three truncated multipart requests release real file streams and remove files.

Each child also serves a healthy request afterward. Disk cases observe native
WriteStream instances, wait for real disk writes before inducing failure, and
assert `.closed`, completion callbacks, and empty storage. Native IO is not mocked.
Parent cleanup validates the resolved test-owned temporary path before removal.

As a negative control, the five process cases were run against the pre-existing,
unreferenced local Multer 2.2.0 package copy without switching the lockfile or
installed adapter links. All five failed their assertions as expected. This
demonstrates regression sensitivity, not reproduction of every possible exploit.

## Local Database and Docker

Docker Desktop was initially stopped and its engine pipe absent. It was launched
hidden; the existing warehouse PostgreSQL container was then started and became
healthy. Other containers with restart policies also started automatically with
Docker; no separate changes were made to those containers.

A new isolated database, `warehouse_multer_security_20260910`, was created after
confirming that no database with that task prefix existed. Only this database
received the nine existing migrations, test seed, and integration-test writes.

```bash
DATABASE_URL=postgresql://warehouse:warehouse_local@localhost:54329/warehouse_multer_security_20260910?schema=public pnpm --filter @glorychips/database prisma:migrate:deploy
DATABASE_URL=postgresql://warehouse:warehouse_local@localhost:54329/warehouse_multer_security_20260910?schema=public pnpm --filter @glorychips/database prisma:seed
DATABASE_URL=postgresql://warehouse:warehouse_local@localhost:54329/warehouse_multer_security_20260910?schema=public pnpm exec vitest run --config vitest.integration.config.ts
```

The test database and healthy PostgreSQL container remain available for review.
No production or `warehouse_feishu_shadow` database, Feishu binding, live OAuth,
or production stock was accessed.

## Limitations and Review

- Nest 12.0.1 does not map `LIMIT_FIELD_ARRAY_INDEX` to HTTP 400. The test-only
  endpoint rejects the request with HTTP 500, then serves health successfully.
  A future production upload route must configure suitable parser limits and
  deliberate error translation; the observed 500 is not its recommended contract.
- Existing tracked business source was searched again, excluding tests and
  fixtures; no multipart handler or Nest upload interceptor was found. This
  remains source evidence, not an exhaustive reachability or penetration test.
- Windows native stream closure was verified. Linux descriptor enumeration,
  long-duration descriptor exhaustion, and production exploit testing were not run.
- The existing large XLSX capacity test and browser acceptance were not rerun.
  Standard report/export tests remain part of the passing regression suites.
- The build still reports a frontend bundle above its 500 kB warning threshold.
  Integration logs still report deprecated concurrent `pg` client queries.
  These are distinct from the five security findings and were not suppressed.
- Quality and reuse specs were reviewed. No new business contract or dependency
  override convention was introduced; no unrelated spec rewrite is needed.
- Initial test development exposed a premature-end timing problem in the truncated
  fixture and a lint error in cleanup. Both were corrected before the final gates;
  no failing checks were waived.

## Evidence Locations and Next Gate

Ignored local evidence: `.trellis/.runtime/multer-security/` contains
`audit-before.json`, `audit-after.json`, `baseline-regression.jsonl`,
`test-final.log`, `lint-final.log`, `typecheck-final.log`, and `integration.log`.
Full build output is retained by FastCtx job `j-ha7j0m`.

Approved work commit scope is the two dependency files, two new test files, and
this task directory. The user confirmed acceptance and local submission on
2026-09-10. Work commit `74b2eff` and task archival are recorded; the journal is
written afterward. Push, merge, and production activation remain separate gates.

Pre-commit staging exposed CRLF whitespace warnings in the generated task JSON.
Only that record's line endings were normalized, and the staged diff check passed.
