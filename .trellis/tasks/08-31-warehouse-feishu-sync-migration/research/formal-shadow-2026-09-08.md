# Formal Shadow Migration: 2026-09-08

## Operator Gate

The user explicitly confirmed the six legacy source tables are write-frozen.
Confirmation time: `2026-09-08T17:14:28+08:00` (`2026-09-08T09:14:28.000Z`).
This is a new window; it does not reuse the earlier released confirmation.
The assistant explicitly ended this window at `2026-09-08T18:23:44+08:00`
after successful import, reconciliation, replay and final source-fence checks.
Old tables may resume normal use. Any future cutover needs a new freeze/snapshot.

## Approved Plan

- Batch: `formal-shadow-20260908-final`.
- Mode: `FORMAL_SHADOW`; operator: `holego`.
- Database: existing `warehouse_feishu_shadow`, port 54329.
- Snapshot: `.trellis/.runtime/feishu-migration/formal-shadow-20260908-final/snapshot-c3ac835e-1e25-4e62-902f-9a556245bf65.json`.
- Plan: `.trellis/.runtime/feishu-migration/formal-shadow-20260908-final/plan-94fef675-8c7d-4cea-abc6-5b1cc3f95ca7.json`.
- Plan generated at `2026-09-08T09:15:06.121Z`.
- Fingerprint:
  `a9e4a005db4d36e3b343b22ad9c0c528feab2096407d7b7e6b38d8e832e70339`.
- 798 sources: 756 movements, 32 ledger sources, ten anomaly-only blank rows.
- Zero blocking issues; ring `2984 - 1040 = 1944`, watch `328 - 61 = 267`.
- The explicitly reviewed accidental empty row remains in the anomaly report.

Preflight database inspection found zero migration batches/movements, six
`PREPARED` bindings, and migrations `0001` through `0008` applied. Existing
catalog IDs and table bindings are preserved.

## Execution Status

Import, exact reconciliation, identical-batch replay and final source-fence
verification succeeded. The freeze window has been released.
All formal bindings must remain `PREPARED`; this is not production activation.
Do not mark the task complete or advance to task 8 before acceptance and delivery.

## Interrupted-Process Recovery

FastCtx stopped during progress polling and reported initial job `j-y7w865` as
interrupted. Read-only process inspection found no remaining migration/CLI
process. PostgreSQL showed 29 successful jobs, 24 pending jobs, 443 synchronized
movements, 313 pending movements and 479 confirmed remote write intents, with
no processing job or unresolved write intent.

Started `resume` as job `j-660ylc` using the original batch, snapshot,
fingerprint and current freeze confirmation. No jobs, movements, bindings,
or failure evidence were deleted or replaced. Recovery and subsequent acceptance
completed as recorded below.

## Initial Acceptance

Recovery job `j-660ylc` exited zero and returned:

- Batch ID: `52661535-fb84-4a11-b9e4-7d022b53541e`.
- Status `SUCCEEDED`, zero mismatches, zero pending jobs, 756 remote movements.
- Recovery created zero additional movements/jobs and reused 756 sources.
- All 53 movement jobs succeeded. All 168 balance reconciliations matched.
- Reconciliation job: `4c9a290d-c9c8-48da-95c7-9a524268a975`.
- Report: `.trellis/.runtime/feishu-migration/formal-shadow-20260908-final/resume-30e37803-851f-40fe-a19d-3cf41bf0c90b.json`.

| Target | Products | Warehouse balances | Movements |
| --- | ---: | ---: | ---: |
| Ring | 10 | 160 | 726 |
| Watch | 4 | 8 | 30 |

Local confirmed quantities are Yuhang ring 1944, Yuhang watch 267, and both
Xihu categories zero. All pending deltas are zero. Historical watches remain
separate at 27, 42 and 68. Current negative source balances are diamond size 11
`-5` and sapphire size 7 `-1`; these differ from the older diamond `-4` snapshot
and were preserved as current source facts.

Before-replay audit saved exact remote record IDs/content/schema hashes and
revisions plus local business-state hashes. It found 756 movements, 788 source
mappings, 970 remote mappings, 14 products, 168 balances and six PREPARED bindings.
Replay ran as job `j-labkpr` against the same batch/snapshot. No record
deletion, reset, batch replacement or binding activation has occurred.

## Replay and Final Fence

- Replay exited zero: created movements `0`, created inventory jobs `0`,
  reused sources `756`, remote movements `756`, mismatches `0`, pending jobs `0`.
- Replay report:
  `.trellis/.runtime/feishu-migration/formal-shadow-20260908-final/resume-344a4660-3739-4828-8d18-c7a1e8f09730.json`.
- `before-replay.json` and `after-replay.json` contain identical remote table
  record counts, revisions, record-ID/content/schema hashes and local business
  hashes. The comparison excludes only write-acknowledgement `updatedAt` timestamps
  and additional audit/reconciliation evidence, not record identity or outcomes.
- `replay-equality.json`: `passed: true`; both hashes equal
  `a0dc115d4e9d8103163c577d8206720ecd8b802083c18e80add9ed827e815782`.
- Non-activating `cutover-check` passed, with zero unfinished jobs and zero
  unresolved writes. It revalidated the frozen source revisions and schemas.
- Check report:
  `.trellis/.runtime/feishu-migration/formal-shadow-20260908-final/cutover-check-1c85f704-36b6-4efc-9e1d-eec6216ebff2.json`.
- Three complete reconciliation passes produced 504 `MATCHED` rows, covering
  168 balances each. All 756 movements are `SYNCED`; all six bindings remain
  `PREPARED`. The source tables remain the production entry.

## Final Quality and Delivery Boundary

- Unit/HTTP: 161 tests in 35 files passed.
- PostgreSQL: 57 tests in eight files passed using isolated test databases,
  not the formal shadow database.
- Workspace type checks, root lint/build/format, Prisma validate and
  `git diff --check` passed.
- Refreshed mock-API browser acceptance at 1440x900 and 390x844 passed; eight
  screenshots were visually inspected. No document overflow, console/page errors
  or failed requests. Evidence: `.trellis/.runtime/sync-ui-qa-final-20260908`.
- Moved test fixture reads to a package-owned copy so task archival cannot break
  tests. NDJSON remains byte-identical and formatted manifests are JSON-equal.
- Fixed the observed `needs_refresh` startup failure: read-only table access may
  refresh the existing identity, followed by a mandatory same-profile/identity
  readiness check. Denied access or unsuccessful refresh still rejects startup.
  No login, credential export or permission change was added.

Code/document commits still require the user's one-shot commit-plan approval.
No commit, archive, journal commit, push, PR merge or task-8 implementation has
been performed. Production OAuth, real product-image acceptance, final
incremental cutover and rollback rehearsal remain task-9 boundaries.
