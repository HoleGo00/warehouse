# Formal Shadow Preflight: 2026-09-08

## Outcome

Formal import was not started. The fresh plan has one blocking source record.
Task 7 remains in progress; no commit, archive, production activation, or task-8
implementation was performed in this continuation.

The user confirmed all six legacy tables were write-frozen. The confirmation
was recorded at `2026-09-08T16:17:29+08:00`. The assistant ended this freeze window
after discovering the blocker, because no formal import had started. Obtain a
new freeze confirmation and a new snapshot before any future formal import.

## Environment

- Started Docker Desktop and the existing `glorychips-warehouse-postgres-1`
  container without recreating its data.
- The pinned CLI remains version `1.0.91`.
- The first plan attempt failed with `CLI_IDENTITY_UNAVAILABLE`: `whoami`
  reported `needs_refresh`. A read-only table-list call refreshed the existing
  identity successfully; no login, profile replacement, or permission change
  was required. The subsequent plan completed.

## Fresh Source Evidence

- Batch directory: `.trellis/.runtime/feishu-migration/formal-shadow-20260908`.
- Snapshot: `snapshot-a729785d-0c5e-4b83-b46d-fd63ec194f67.json`.
- Plan: `plan-dc28d211-47f4-4c81-bb0c-e8ecaa6cd946.json`.
- Captured at: `2026-09-08T08:19:21.166Z`.
- Source fingerprint:
  `a9e4a005db4d36e3b343b22ad9c0c528feab2096407d7b7e6b38d8e832e70339`.

| Source | Records | Revision |
| --- | ---: | ---: |
| Ring inbound | 97 | 554 |
| Ring outbound | 630 | 3153 |
| Ring ledger | 30 | 194 |
| Watch inbound | 10 | 65 |
| Watch outbound | 21 | 142 |
| Watch ledger | 10 | 19 |

The plan reports 798 source records, 756 projected movements, 32 ledger rows,
nine blank-zero anomalies, and one blocking issue. Provisional valid-row totals
are ring `2984 - 1040 = 1944` and watch `328 - 61 = 267`. These are not accepted
migration totals while the source blocker remains unresolved.

## Blocking Record

- Table: ring outbound, `tblpctHbFSnU7Dvp`.
- Record: `recvuAsBLXpK1h`.
- Error: `MISSING_REQUIRED_VALUE`.
- Business fields: source product name, size, quantity, claimant, business type,
  and destination are absent. The date is `2026-09-08`.
- The source date field has a `record_created_time` default. Formula outputs
  include month `9` and product key `-`; these do not supply a product or quantity.

The current transformer accepts fully blank zero rows as anomalies, but this
row contains a date and therefore fails the required product/quantity checks.
The evidence does not establish whether this is an accidentally created empty
row or an incomplete real outbound record. Do not delete, fill, or silently skip
it, and do not broaden the transformation rule without the user's decision.

## Non-Mutation Evidence and Next Gate

Only `plan` and read-only inspection were run against Feishu in this continuation.
The plan reuses all six existing V1 tables. Local PostgreSQL inspection of
`warehouse_feishu_shadow` found zero migration batches, zero inventory movements,
and six bindings still `PREPARED`. Formal import, replay, and final reconciliation
have not run.

Ask the user whether the identified row is an accidental empty row or a real
outbound record awaiting completion. Resolve the source fact or explicitly
approve a narrowly scoped anomaly policy before starting another frozen plan.
Keep all old data intact and keep V1 bindings `PREPARED`.
