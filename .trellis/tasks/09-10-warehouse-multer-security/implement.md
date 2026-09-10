# Multer Security Repair Execution Plan

## Approval Gate

- [x] User authorized creation of an independent Trellis task.
- [x] Inspect current dependencies, conventions, and fresh advisory metadata.
- [x] Persist converged PRD, design, and execution plan.
- [x] Obtain explicit approval of the final planning summary on 2026-09-10.
- [x] Run `task.py start` after approval, with `--allow-empty-context` for the
  approved single-agent inline flow. Status is `in_progress`; no session identity
  was available, so the active-task pointer was not persisted (degraded mode).

## Implementation

- [x] Recheck worktree status and preserve all pre-existing edits and services.
- [x] Capture a fresh audit baseline in ignored task-specific runtime storage;
   retain the structured advisory IDs, counts, and versions in delivery evidence.
- [x] Add the parent-scoped Multer override and regenerate the lockfile with pnpm.
   Inspect the lockfile diff before accepting it.
- [x] Install with the frozen lockfile and verify the actual adapter-resolved version
   using Node resolution. Inspect both API and worker paths.
- [x] Add bounded test-only regression coverage following `auth.http.test.ts`.
   Cover valid multipart, size rejection, malformed field handling, excessive
   indices, async filter limits, and aborted disk-storage cleanup.
- [x] Confirm that fixtures do not register routes in production or access business
   data. Use child-process isolation for tests capable of blocking the event loop.

## Validation

- `pnpm install --frozen-lockfile`
- `pnpm -r why multer`
- `pnpm exec vitest run --config vitest.config.ts apps/api/src/multer-security.http.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:integration`, only after confirming the hard-coded local target
  `localhost:54329/warehouse` is the disposable development database and no other
  active work depends on its fixtures; otherwise use a verified isolated database
  with equivalent migration, seed, and integration commands.
- Prettier checks limited to changed files; report any unrelated baseline failures.
- `pnpm audit --prod --registry=https://registry.npmjs.org --json`
- `git diff --check` and final changed-path review.

Do not run generate-heavy commands concurrently with each other. Audit exit code
1 is expected while deferred findings remain; compare GHSA sets rather than
treating a nonzero exit as either a tool failure or a successful security gate.
Expect removal of four targeted IDs, not a zero-advisory repository.

## Delivery Gate

- [x] Record exact commands, results, dependency versions, and residual advisories.
- [x] Document resource-leak coverage: real WriteStream closure and empty storage
  were checked on Windows; Linux `/proc/self/fd` enumeration was not performed.
- [x] Review applicable specs; no business contract or existing override convention
  changed. Keep the dependency-specific compatibility finding in this task.
- [x] Obtain user acceptance and approval of the scoped local commit on 2026-09-10.
- [ ] Keep task unarchived until acceptance and work commit requirements are met.
- [ ] Push, merge, and production actions remain separately unauthorized.

All automated gates passed. See `implementation-evidence-2026-09-10.md`.
Human acceptance is recorded. Work commit, archive, and journal are next.
