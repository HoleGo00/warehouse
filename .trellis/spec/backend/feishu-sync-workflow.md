# Feishu Synchronization Workflow

## 1. Scope and Trigger

Applies to `packages/database/src/sync`, the worker CLI adapter and scheduler, and
the system-administrator synchronization endpoints. These are the local runtime
contracts; they do not constitute acceptance of historical migration or production
cutover. Formal shadow migration requires a fresh freeze confirmation and must
leave all formal bindings `PREPARED`.

## 2. Signatures

- `FeishuSyncService.runOnce(jobId?)`: claim one due job, process independent target
  steps, then aggregate job and request states.
- `FeishuSyncAdminService.retry(id, command, key, actor)`: reactivate original failed
  steps only, through `executeIdempotently`.
- `enqueueReconciliation(tx, key, target?)`: enqueue a target-scoped or two-target
  reconciliation without performing remote writes.
- `createWorkerScheduler(database, reminders, environment)`: validate the configured
  CLI and bindings before enabling outbox and periodic reconciliation runners.
- `GET /admin/sync/{jobs,reconciliations,bindings}`, `GET /admin/sync/jobs/:id`,
  `POST /admin/sync/jobs/:id/retry`, `POST /admin/sync/reconciliations/run`,
  `GET /admin/migrations`.

## 3. Contracts

- Mutations require `Idempotency-Key`; retry requires a trimmed 1-500 character
  reason and optional `RING_BASE` or `WATCH_BASE` target. Lists default to 50 records,
  bounded at 200. IDs are UUIDs, not raw SQL or remote record identifiers.
- Controllers and domain services independently require `SYSTEM_ADMIN`.
- Business movement creation captures `actorNameSnapshot`, `actorFeishuUserId`
  and `productNameSnapshot` in the inventory transaction. Later profile or catalog
  edits must not rewrite an immutable movement's payload.
- Synchronization order is `balanceSequence`, allocated while holding the local
  balance lock. Never sort live stock writes by user-supplied occurrence time.
- A transaction holds the job row, Base advisory lock, and ordered balance locks
  through remote writes, readback, and local settlement. A lease token fences stale
  owners. Remote write intents commit on a separate connection before remote I/O.
- An unresolved intent for the same remote stable key blocks later product
  revisions too. Changing a payload hash or intent key does not authorize a new
  write while the old request might still complete.
- Only an explicitly known non-applied Gateway outcome may mark an intent
  `REJECTED`. Retry reuses that intent, increments its attempt count and retains
  error/audit evidence. Unknown provider codes, timeouts, 5xx and errors after
  acknowledgement remain `UNCERTAIN`. Never infer non-application from a raw
  provider message or from an error during readback.
- Each target settles atomically: mark movements `SYNCED`, increment confirmed
  quantity, decrement pending delta. Effective inventory is conserved.
- Native Base queries can temporarily omit an acknowledged write. The writer
  makes at most four stable-key readbacks, separated by 500 ms, while checking
  ownership. It never repeats the mutation during this visibility window.
  Both create and update acknowledgements use this same domain-owned readback;
  the CLI adapter must not add a separate immediate-read requirement.
- A job remains `RETRY` while at least one target is automatically retryable, even
  if the other target requires manual review. Only when all necessary targets
  succeed is the job `SUCCEEDED`.
- Manual retry retains lifetime attempts, error evidence, remote intents, movement
  IDs and deduplication keys. A successful retry completes the existing exception
  task; a retry after the lifetime attempt ceiling gets one execution, not a reset
  automatic retry budget.
- Reconciliation compares remote quantity against local **confirmed**, not
  effective quantity. Pending movements are reported separately.
- Reconciliation enumerates every remote page. Missing, duplicate, invalid,
  identity-mismatched, and sequence-mismatched balances are `MISMATCH`, even when
  the numeric difference is zero. Unmapped remote rows create a deduplicated
  administrator exception and an `extraRecords` count in step evidence.
- Unknown or ambiguous remote quantities and their differences are nullable.
  The API exposes `remoteRecordState` as `PRESENT/MISSING/DUPLICATE/INVALID`.
  Never use zero to represent a missing record.
- API projections use allowlisted error codes and never return raw provider errors,
  Base tokens, CLI profile details, intent payloads or employee snapshots.
- Synchronization defaults off. CLI version and profile remain pinned to
  `1.0.91` and `glorychips-warehouse`. `FORMAL` runtime mode requires active
  bindings; explicit shadow mode is scoped to its migration batch.
- A pinned CLI identity reporting `needs_refresh` is not ready for writes, but
  may refresh through read-only target-table access. Validate profile, identity
  and availability before that read, then require a second `whoami` result with
  the same identity and `ready`. Denied access, failed refresh and changed
  identity still fail closed; never log credentials or initiate a new login.

## 4. Validation and Error Matrix

| Condition | Code / HTTP / Result |
| --- | --- |
| No session | `AUTH_REQUIRED` / 401 |
| Non-system administrator | `FORBIDDEN_ROLE` / 403 |
| Invalid UUID, limit, target, reason or missing key | `VALIDATION_ERROR` / 400 |
| Missing job | `SYNC_JOB_NOT_FOUND` / 404 |
| Retry of processing or successful job | `SYNC_STATE_CONFLICT` / 409 |
| Reused key with changed command or actor | `IDEMPOTENCY_CONFLICT` / 409 |
| Earlier unsynchronized balance sequence | `SYNC_ORDER_BLOCKED`, delayed without counting an attempt |
| Unknown remote write outcome | `SYNC_REMOTE_UNCERTAIN` / 503; read evidence before any further write |
| Schema drift or missing binding | `SYNC_BINDING_INVALID`, manual review |
| Conflicting remote content | `SYNC_REMOTE_CONFLICT`, manual review |
| Lost lease | `SYNC_LEASE_LOST`; stale owner cannot settle |

## 5. Good, Base and Bad Cases

- Good: remote success followed by local rollback resumes from matching remote
  evidence and creates no additional row or balance change.
- Base: a ring/watch job can settle one target, then retry the other.
- Bad: replacing an uncertain product write with a new hash, treating absent
  balances as zero, or marking a mixed job successful after only one target.

## 6. Required Tests

- `packages/database/test/feishu-sync.integration.test.ts`: exact-once settlement,
  net-zero pending, backdated events, lease recovery, immutable snapshots, changed
  product blocking, independent targets, admin retry/audit idempotency and
  reconciliation missing/duplicate/extra/sequence cases.
- The synchronization suite creates and migrates a dedicated local PostgreSQL
  database per run and removes only that run's database. Do not overwrite persistent
  test bindings to accommodate changed schemas.
- `apps/api/src/sync/admin-sync.http.test.ts`: all endpoints through actual Nest
  guards and exception filtering, including both lower-privilege roles.
- Worker startup tests verify disabled mode performs no CLI calls, enabled runners
  are serial, and identity/binding failures reject startup.
- Ordinary tests use fake gateways only. Real Base acceptance is a separate gate.

## 7. Wrong vs Correct

Wrong: on timeout, call create again with a fresh UUID; compare remote balance to
`confirmed + pending`; recreate jobs during manual retry.

Correct: keep the original stable key and persisted intent, read matching remote
evidence, compare against `confirmed`, then atomically settle the original step.
