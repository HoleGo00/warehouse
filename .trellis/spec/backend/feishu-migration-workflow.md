# Historical Feishu Migration

## Scope

Applies to the migration contracts, `packages/database/src/sync/migration-*`,
and the controlled commands in `apps/worker/src/feishu`. These tools do not
activate production bindings. Task 7 leaves all formal bindings `PREPARED`.

## Data Boundary

- `captureMigrationSnapshot` reads all six configured old tables and all record
  pages. It records revisions, schema/content/record-ID hashes, record counts and
  page counts, then checks all six revisions again.
- Repeated page tokens, repeated record IDs, absent revisions, changed schemas,
  changed names and provider record-count disagreement invalidate the snapshot.
- `validateSnapshot` recomputes hashes when reading a saved artifact. A saved
  plan is not evidence that the source is still unchanged.
- Complete source snapshots stay under `.trellis/.runtime/feishu-migration`,
  which is ignored by Git. Commands restrict artifact reads/writes to this tree,
  resolve symlinks and use exclusive file creation. Reports expose counts,
  schema operations, anomaly codes and fingerprints, not employee data.
- Source metadata, including missing legacy business type/date values, remains
  explicit. `migrationOccurredAt` is the historical occurrence timestamp;
  `occurredAt` is only the technical import timestamp for migrated rows with no
  historical date. History projections must use the former for migration sources.

## Transformation

- Reuse `productCatalog` and `catalogRingSizes`. Ring aliases must map uniquely.
  Historical Rose, Starry Sky and Black Gold watches stay separate and disabled.
- Import all history into Yuhang. Every catalog variant receives an explicit
  zero Xihu balance; missing remote records are not equivalent to zero.
- Validate each variant's inbound/outbound history against the ledger's inbound,
  outbound and final quantity. A correct category total cannot hide a per-size
  mismatch. Unknown products, ambiguous selections and malformed quantities block
  the plan.
- Blank zero rows appear only in anomaly reports. Nonblank zero movements retain
  source provenance but cannot create a zero-delta inventory movement.
- A date-only row is not automatically blank. On 2026-09-08 the user confirmed
  ring outbound `recvuAsBLXpK1h` was accidentally created. Its exception is pinned
  to the Base, target, table, source kind, record ID and complete reviewed field
  hash in `migration-plan.ts`. Report `USER_CONFIRMED_EMPTY_ROW` with the source
  key and reviewed hash, retain its original date, and create no movement.
  Different records or changed contents use normal validation; a subsequently
  completed record must not remain exempt. Never clear or delete the source row.
- Keep negative historical quantities as source facts and report them. Never
  clamp them to zero or generate artificial opening/closing stock to hide them.
  The current complete history requires no `MIGRATION_OPENING`; incomplete
  history must stop for an explicitly reviewed opening plan.
- Use timestamp, inbound-before-outbound tie breaking, then stable source key to
  reconstruct order. Mark all imported movements `historyOrderRebuilt=true`.
  The original timestamp is retained; reconstructed order is not claimed to be
  the historical transaction order.

## Import and Recovery

- `prepare` locks the migration operation and all local balances. Before and
  after locking, it rejects non-migration business movements and active
  reservations. Formal mode requires the complete approved catalog.
- Insert append-only migration movements, pending deltas, source deduplication
  records, outbox jobs and audit in one transaction. Source identity is
  `target + sourceTableId + sourceRecordId + semanticKind`.
- Reuse identical imported source records. Changed or removed imported
  movements block a later batch. A later ledger revision can change only
  alongside a plan whose new movements explain the new quantities; retain the
  prior ledger hash in audit.
- `SOURCE_LEDGER` mappings point to the old ledger coordinate and local Yuhang
  balance. They do not issue writes to old tables.
- Batches contain at most 20 movements for one variant. Reuse the normal ordered
  outbox writer and settlement transaction; do not implement another remote
  balance setter.
- Persist `migrationOrder` in each migration outbox payload and sort by it when
  resuming. PostgreSQL `now()` defaults can give every row in one transaction the
  same creation timestamp; random UUID order is not migration execution order.
- `resume` verifies the source fence before each job. It never clears a remote
  write intent or creates replacement business movements. Pending retries
  remain `RUNNING`; a failed run retains its batch, jobs and error evidence.
- After synchronization, materialize missing initial zero balances only when
  both local quantity and movement sequence are zero. Products and zero rows
  use the same persisted remote-intent mechanism.

## Acceptance and Cutover Gates

- `reconcile` verifies local expected balances, all remote balance pages,
  all remote movement pages, source mappings, confirmed write intents and exact
  movement hashes. Extra/missing/duplicate records fail acceptance.
- An identical batch replay must create zero movements/jobs/remote rows and make
  zero balance changes. Reconciliation/audit evidence may be appended.
- Formal apply/reconcile requires the exact approved snapshot fingerprint and
  an operator's current freeze timestamp, no older than two hours and preceding
  snapshot capture. Obtain this confirmation from the user before supplying it.
- `snapshot` and `plan` do not connect to PostgreSQL or write to Feishu.
  `provision` requires an approved fingerprint; formal provisioning also requires
  an isolated-acceptance report whose evidence hash matches its contents.
- `cutover-check` additionally requires no unfinished outbox jobs or unresolved
  writes. It produces evidence only; it never activates or rolls back bindings.
- Rollback and final production activation remain a separate task-9 operator
  workflow. Do not delete V1 data, change old-table permissions, or copy V1
  business changes back into old history.

## Commands

From the repository root:

```bash
pnpm feishu:migration -- plan --batch readonly-YYYYMMDD
pnpm feishu:migration -- resume --batch BATCH --snapshot PATH --fingerprint HASH \
  --mode FORMAL_SHADOW --operator OPERATOR --freeze-confirmed-at ISO_TIMESTAMP
```

`snapshot`, `plan`, `provision`, `apply`, `resume`, `reconcile`, and `cutover-check`
share this command entry point. `TEST` requires two distinct non-formal Base
coordinates. Mutation commands require an explicitly configured `DATABASE_URL`;
never silently use the ordinary test database as a formal migration destination.

## Tests

- `migration-plan.test.ts`: all 715 projected source records, ten blank rows,
  24 new outbound records, disabled historical watches, negative balances,
  malformed input and snapshot tampering. Its business-only fixtures live in
  `packages/database/test/fixtures/feishu-migration`, not the active task directory;
  archiving a task must not remove a test dependency.
- `feishu-migration.integration.test.ts`: paging/revision fences, atomic import,
  explicit zero balances, same-batch replay, later delta batches, source changes
  and freeze rejection.
- `live-acceptance.ts`: one-shot synthetic fixture in separately named local
  PostgreSQL and remote test Bases. Copy intents are retained before external
  calls, and ambiguous copies are never automatically repeated. This controlled
  harness does not delete or reset partially completed test fixtures.
