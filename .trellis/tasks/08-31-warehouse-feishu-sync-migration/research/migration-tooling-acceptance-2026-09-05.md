# Migration Tooling and Native Acceptance: 2026-09-05

## Current Boundary

- Worktree: `D:/GloryChips/glorychips-warehouse-feishu-sync-migration`.
- Branch: `codex/warehouse-feishu-sync-migration`.
- Task 7 remains `in_progress`. No commit, push, PR, merge, archive, or task-8
  implementation has occurred in this continuation.
- All work, reviews and tests were performed by the primary agent. No sub-agent
  or separate Codex task was created or invoked.
- Formal V1 tables now exist, but they are empty. All six formal bindings are
  `PREPARED`; no historical records have been imported into the formal V1 tables.
- The next gate requires the user's **current** confirmation that the six old
  stock tables have stopped accepting additions, edits and deletions. Previous
  approval of a short freeze is not that current confirmation.

## Implementation

- Added typed migration snapshot/apply contracts and a controlled command entry:
  `pnpm feishu:migration -- COMMAND --batch BATCH`.
- Implemented full six-table pagination, revision and record-count fences,
  schema/content/record-ID hashes, saved-artifact integrity checks and runtime-only
  raw snapshot storage.
- Implemented alias/size/history transformation, per-variant ledger validation,
  null date/type preservation, historical-watch separation and anomaly reports.
- Added atomic local migration preparation, stable source deduplication,
  bounded outbox batches, resume, exact movement readback, reconciliation,
  explicit zero balances, and a non-activating cutover check.
- Imported movements cannot be silently edited or removed by a later snapshot.
  Ledger revisions require matching new source movements and retain prior hash
  evidence in audit. `SOURCE_LEDGER` mappings reference the old records without
  writing to those old tables.
- Zero-balance initialization also runs in bounded groups of at most 20, avoiding
  a single long transaction for all 168 catalog balances.
- Migration jobs persist an explicit `migrationOrder`, so equal transaction
  timestamps and random job UUIDs cannot reorder a variant's chunks. A forced
  reverse-timestamp, three-chunk regression completes in one resume pass.
- `0008_sync_definitive_rejection` preserves rejected intent IDs, attempt counts
  and failure evidence. Only a known non-applied outcome permits a new attempt;
  unknown results remain fenced.

## Fresh Formal Source

Read-only plans were regenerated on September 5, 2026, including after native
test acceptance. The source fingerprint was:

`7de163f9e64f3d4426c3346df586b970c0e35f502f0de2fa8122c447e57c7b0a`

| Source | Records | Revision |
| --- | ---: | ---: |
| Ring inbound | 97 | 554 |
| Ring outbound | 547 | 2903 |
| Ring ledger | 30 | 194 |
| Watch inbound | 10 | 60 |
| Watch outbound | 21 | 142 |
| Watch ledger | 10 | 19 |

The 715 records produce 673 nonzero historical movements, 32 ledger sources and
10 blank-zero anomalies. Quantity summaries remain ring `2984 - 866 = 2118`,
watch `326 - 61 = 265`. All quantities were recalculated, not used as constants.

Two negative source facts are retained and reported: diamond ring size 11 is
`-4`; sapphire ring size 7 is `-1`. No artificial opening or stock adjustment
was created. Historical watches remain separate at 27, 42 and 68.

## Native Test Acceptance

Created structure-only test copies, retaining both:

- `Warehouse_V1_Test_0_20260905`
- `Warehouse_V1_Test_1_20260905`

The test state lives in the separate local PostgreSQL database
`warehouse_feishu_acceptance_20260905`, on port 54329. It is intentionally
retained with synthetic data and audit evidence, not reused for formal import.

Native acceptance established:

- Six real V1 tables with field-ID/fingerprint verification.
- Real product/movement/balance writes to both isolated targets.
- A deliberate interruption after a real remote write, plus native query
  visibility delays encountered during the run.
- Recovery using the original retained job and write intents, without resetting
  the fixture, rebuilding copies or creating duplicate movements.
- Mixed request transitions `PENDING -> SYNCED` and, in a separate permanent
  failure/manual-retry case, `FAILED -> SYNCED`.
- Idempotent manual retry and completion of the original unique exception task.
- Identical job replay with zero new records, zero remote content changes and
  zero local balance changes.
- Four matched synthetic warehouse balances; two final movement records per
  target after the additional manual-retry case.

Runtime evidence:

- `isolated-acceptance-20260905.log`: initial retained failure.
- `isolated-recovery-20260905.log`: successful original-job recovery.
- `isolated-manual-retry-20260905.log`: successful manual recovery.
- `feishu-migration/isolated-acceptance-20260905/acceptance-manual.json`.
- Final acceptance evidence hash:
  `844b2b96dacca39d2fd4d73c4cbff2ecce063e0ff916881198a2a6d7b139107c`.

## Native Readback Finding

The real Base path did not consistently satisfy the test harness's assumption
that one immediate query, or one recovery pass, would expose every written row.
The original rows were subsequently visible and recovered by stable key.

Root cause category: cross-layer contract assumption and test coverage gap.
The domain writer now makes at most four read-only readback attempts, with
500 ms spacing and ownership checks. The adapter no longer makes a separate
immediate-read requirement after update acknowledgement. It never repeats the
mutation in this visibility window. A delayed-visibility integration regression
passes, and the failed native fixture was recovered without clearing evidence.

## Formal Empty Tables

Formal bindings are persisted in a new, dedicated local database:
`warehouse_feishu_shadow`, on port 54329. It contains the standard 14 products,
84 variants and 168 zero balances, with no ordinary test products or movements.
Preserve this database and its entity IDs through shadow migration and task-9
deployment/cutover; do not replace it with the ordinary test database or a fresh
catalog whose UUIDs differ.

| Target | Kind | Table ID |
| --- | --- | --- |
| Ring | Product | `tbltOnbojQI0uI81` |
| Ring | Balance | `tblmPsKYg3rv0YaY` |
| Ring | Movement | `tblOspMOhLPaGDha` |
| Watch | Product | `tblSKgps9qfj7yMi` |
| Watch | Balance | `tblKnff87KVb3b3B` |
| Watch | Movement | `tbl2vxMVLpSLJOus` |

Provisioning and its same-input rerun succeeded. Readback showed all six V1
tables at zero records/revision zero and all bindings `PREPARED`. The six old
table counts/revisions remained unchanged; schema fences also passed. No old
record, field, name, or permission was changed by this task.

Runtime reports:

- `formal-plan-20260905.log`
- `formal-provision-20260905.log`
- `formal-provision-rerun-20260905.log`
- `formal-ring-tables-20260905.json`, `formal-watch-tables-20260905.json`

The approved-source artifact is under
`feishu-migration/formal-plan-20260905/snapshot-f6447a4c-3a12-414a-a4b5-9dc80795b6d5.json`.
After freeze confirmation, capture a **new** snapshot; do not reuse its timestamp
as evidence that the old tables are frozen now.

## Validation

- Unit/HTTP: 147 tests, 35 files.
- PostgreSQL: 56 tests, 8 files, including full 84-variant/168-balance replay and
  explicit multi-chunk ordering.
- Type checks across all packages, lint, Prisma validation, build, format check
  and whitespace checks passed in this continuation; final gate logs use the
  `.trellis/.runtime/final-migration-*` prefix.
- Existing Vite chunk-size and pg concurrency deprecation notices remain
  warnings. They did not fail the gates.
- No frontend implementation changed in this continuation. The earlier
  desktop/mobile mock-API UI evidence remains in the preceding checkpoint.

## Next Execution

1. Obtain current source-write-freeze confirmation and capture its actual time.
   The current per-record CLI approach needs a meaningful maintenance window;
   approximately one hour is an operational estimate, not a completion guarantee.
2. Recapture all six old tables and regenerate the plan. If the source fingerprint
   changed, use a new batch/fingerprint and explain the new summary.
3. Use `warehouse_feishu_shadow`, `FORMAL_SHADOW`, the new snapshot/fingerprint
   and the current freeze confirmation. Run apply/resume until all original
   jobs settle, then exact reconciliation and identical-batch replay.
4. Keep bindings `PREPARED`; only after a verified report tell the user the old
   write entry can resume. Task 9 still owns final delta/activation.
5. Finish whole-task verification, task records, commit, archive/journal, push and
   PR merge only after formal historical migration acceptance. Do not advance to
   task 8 before that completion.
