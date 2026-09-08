# Reviewed Empty Source Row: 2026-09-08

## Decision and Boundary

The user explicitly identified ring outbound record `recvuAsBLXpK1h` as an
accidentally created empty row. This resolves the source clarification requested
in `formal-plan-blocked-2026-09-08.md`. The original row remains untouched.

The migration transformer now treats only this reviewed record as a nonblocking
`USER_CONFIRMED_EMPTY_ROW`, guarded by Base, target, table, source kind, record ID,
and the complete reviewed field hash:

`271d076e518126a26b58ac1d92971869489ed1c5115ab57e6a36cc95e1eacc5f`

The original date and source key are retained. No product, movement, balance
change, or inventory synchronization job is generated for this row. Its source
key and reviewed hash remain in the anomaly report, which is persisted when a
migration batch is prepared.

All other date-only or incomplete records still use normal validation. If this
record changes, the exception no longer applies; a subsequently completed
outbound row is processed normally rather than silently omitted.

## Implementation and Verification

Changed the migration transformer and unit/integration tests; documented the
reviewed-record rule in the backend migration spec. No API, UI, schema, or source
table changes were needed.

- Whole unit/HTTP suite: 157 tests across 35 files passed.
- Whole PostgreSQL integration suite: 57 tests across 8 files passed.
- Migration transformation suite includes 10 new regression cases.
- Integration coverage verifies anomaly persistence, no extra movements or
  inventory jobs, unchanged balances and remote writes during replay.
- All workspace type checks, root lint, database build, scoped Prettier check,
  and `git diff --check` passed.
- A test-only readonly-object type error was corrected using immutable fixture
  construction before the successful rerun.

Runtime logs use `.trellis/.runtime/reviewed-empty-*-20260908.log`.
No frontend changes were made; browser acceptance was not rerun.

## Fresh Read-Only Plan

Command:

```bash
pnpm feishu:migration -- plan --batch reviewed-empty-20260908
```

- Generated at `2026-09-08T08:51:10.131Z`.
- Fingerprint:
  `a9e4a005db4d36e3b343b22ad9c0c528feab2096407d7b7e6b38d8e832e70339`.
- Snapshot: `.trellis/.runtime/feishu-migration/reviewed-empty-20260908/snapshot-197f95ca-dfb3-4db4-b810-33ebd6afbca8.json`.
- Plan: `.trellis/.runtime/feishu-migration/reviewed-empty-20260908/plan-cc42bb1a-acb3-4bcb-b2ca-9c123fc6cd7e.json`.

| Measure | Result |
| --- | ---: |
| Source records | 798 |
| Historical movements | 756 |
| Ledger sources | 32 |
| Blank/anomaly-only rows | 10 |
| Blocking issues | 0 |
| Ring inbound / outbound / balance | 2984 / 1040 / 1944 |
| Watch inbound / outbound / balance | 328 / 61 / 267 |

The ten empty rows include nine ordinary blank-zero rows and the one reviewed
accidental row. Negative legacy balances remain reported, not corrected.

## Remaining Gate

This plan does not import data and does not prove that source writes are frozen.
The preceding freeze window was explicitly ended. Before formal import, obtain
a new current freeze confirmation and capture a new snapshot; do not reuse the
previous confirmation timestamp or this read-only plan as freeze evidence.

Post-check inspection of `warehouse_feishu_shadow` found zero migration batches,
zero inventory movements, and six `PREPARED` bindings. Formal apply, exact
readback, same-batch replay, production activation, commit, archive, and task-8
work remain unperformed.
