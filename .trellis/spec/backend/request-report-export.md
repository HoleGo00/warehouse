# Request Reports and Private XLSX Exports

## Scope

Applies to `contracts/request-report.ts`, `contracts/request-export.ts`,
`database/src/reports`, the API report controllers, and the independent exporter.
These modules do not change inventory balances, request transitions, Feishu mappings,
or production activation.

## Query Contract

- Report and export endpoints require a system administrator or a warehouse administrator.
  Derive the finite warehouse set on the server; reject an explicitly unauthorized warehouse.
- Combine category, product and size on the same request item. Use the same predicate in
  request `EXISTS`, selected items, export counts and detail rows. Never export the other
  items of a mixed request merely because its parent matched.
- Default to `COALESCE(submitted_at, created_at)`. `FULFILLED` uses the completed
  `Fulfillment.fulfilledAt`; completion, paperwork and synchronization timestamps are not substitutes.
- Parse calendar days at Shanghai midnight and use an exclusive next-day upper bound.
- Request pagination orders `(date, id)` descending; bind cursors to normalized filters
  and the current warehouse set. Parameterize all SQL, including free-text destinations.
- Match historic inactive products and claimants. Staff management is distinct:
  `/access/users` requires a system administrator and returns only users with `lastLoginAt`.
- Detail movements reuse whole-request visibility and return a bounded, whitelisted projection.
  Never expose remote payloads, attachment tokens or credential fields.
- SQL migration 0009 owns the expression indexes on submission time (all warehouses
  and warehouse-prefixed), fulfillment time, and product/size. Do not remove the
  all-warehouse sort index merely because a warehouse-prefixed index exists.

## Persistent Jobs

- `POST /admin/exports` requires JSON and an idempotency key. Reject foreign Origin
  and cross-site browser writes. The existing access PUT uses the same write guard.
- The existing idempotency executor serializes duplicate commands; a per-user advisory
  lock enforces at most two unfinished jobs. A different command with the same key conflicts.
- Only the owner sees a job or downloads it. List newest first using `(createdAt, id)`
  pagination, not random UUID order.
- Claim with `FOR UPDATE SKIP LOCKED`, a 60-second lease and a unique attempt token.
  Renew every 10 seconds independently of report reads. Recover expired leases with
  at most three attempts; stale tokens cannot complete a newer attempt.
- Re-read active user roles and warehouse scopes before generation, publication and
  download. A completed file never grants permanent access.
- Success expires 24 hours after completion. Download rejects expiry immediately;
  cleanup runs at startup and every five minutes, retaining audit and removing expired
  filter text. Failed jobs retain stable error codes. Storage errors are not retried blindly.

## Generation and Storage

- `pnpm dev:export` is a separate process, independent of the Feishu/outbox worker.
  It loads the repository `.env` and uses its own two-connection database pool.
  Both exporter package entry scripts cap the Node old-space heap at 256 MiB;
  the capacity test uses that same process setting. RSS also includes native buffers,
  so the heap cap does not replace measured whole-process memory.
- API and exporter must share a private directory. Relative `EXPORT_STORAGE_DIR`
  paths resolve from the repository root, regardless of package working directory.
- One repeatable-read, read-only transaction supplies both sheets. Count matched
  lines first; write summary and details sequentially in 500-row batches.
- Exactly two worksheets: `领用单汇总` and `商品明细`. Each begins with snapshot/filter
  metadata and headers. Summary quantities must equal exported matching details.
- Commit rows as they are written. Use literal strings, never formula/hyperlink objects.
  Reject invalid control characters and text beyond Excel's cell length instead of truncating.
- Enforce 100,000 matching lines, 64 MiB and 300 seconds; all failures remove the
  current attempt's partial output. Never publish a truncated workbook.
  Capture the primary failure before destroying streams; cleanup can emit
  `ERR_STREAM_DESTROYED` and must not overwrite `EXPORT_TOO_LARGE` or `EXPORT_TIMEOUT`.
- Filenames are server-generated UUID/attempt-token pairs; reject arbitrary paths,
  symlink roots/files and non-regular files. Publish by same-directory rename.
  Cleanup only owned files, never recursively remove the configured root.
- Download through a file stream with attachment MIME, `private, no-store` and
  `nosniff`; do not read the whole file into API memory.
- Record success duration, sampled peak RSS, counts and size without report contents.

## Dependency and Quality Checks

- ExcelJS is pinned at 4.4.0. Scoped pnpm overrides keep its archiver at 5.3.2,
  fast-csv at 4.3.6 and uuid at 11.1.1; `tar-stream@2>bl` is 4.1.0.
- A previous ZIP dependency combination produced empty workbook metadata while
  reporting successful generation. Any dependency change must pass real XLSX readback,
  not just ZIP existence or byte-count checks.
- Run unit/HTTP and isolated PostgreSQL tests for same-item predicates, Shanghai
  boundaries, concurrent snapshot changes, idempotency, lease recovery, ownership,
  revocation, limits, expiry and file cleanup.
- After building, run the opt-in `RUN_EXPORT_CAPACITY=true` workbook integration test.
  It starts real independent API/exporter processes, uses 100,000 synthetic ring lines,
  measures 20-concurrent-query baseline/load p95, downloads through HTTP and reads back
  both row counts and numeric totals. Thresholds: 300 seconds, 64 MiB, 512 MiB RSS and
  query p95 below one second. Do not lower the scale to obtain a passing result.
- Production OAuth, shared-volume permissions and real Feishu activation remain separate gates.
