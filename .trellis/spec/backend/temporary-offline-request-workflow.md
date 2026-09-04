# Temporary and Offline Request Workflow

## 1. Scope / Trigger

Use this contract for immediate temporary issues followed by paperwork, source-aware review, three-working-day paperwork deadlines, and administrator-recorded offline issues. Normal online reservation/release behavior and physical returns remain separate workflows.

## 2. Service and HTTP Signatures

```text
TemporaryOfflineRequestService.createTemporary(command, idempotencyKey, actor)
TemporaryOfflineRequestService.completePaperwork(requestId, command, idempotencyKey, actor)
TemporaryOfflineRequestService.createOffline(command, idempotencyKey, actor)
RequestReviewService.review(requestId, command, idempotencyKey, actor)
RequestQueryService.listPaperworkQueue(query, actor)
RequestQueryService.searchClaimants(query, actor)
```

```text
POST /requests/temporary
PUT  /requests/:requestId/paperwork
GET  /admin/requests/paperwork?warehouse=<code>&state=REQUIRED|CORRECTION|OVERDUE
GET  /admin/claimants?query=<name>
POST /admin/requests/offline
POST /admin/requests/:requestId/review
```

Every write requires a stable `Idempotency-Key`.

## 3. Atomic Inventory Contract

- Temporary and offline requests represent inventory that physically left the warehouse. Create the request, snapshots, `ISSUE` movements, outbox aggregate, fulfillment, audit, and any task or return obligation in one idempotent PostgreSQL transaction.
- Call `InventoryTransactionExecutor.applyMovementBatchInTransaction` directly from the active request transaction. Do not create reservations and do not call a public service that opens a second transaction.
- Lock inventory keys in stable warehouse-plus-variant order. Any invalid item, shortage, or write failure rolls back the whole request.
- A successful retry returns the stored result. Reusing the key with a changed normalized command returns `IDEMPOTENCY_CONFLICT`.
- Paperwork submission and temporary review never create inventory reservations, movements, outbox jobs, or another fulfillment.

## 4. Temporary State Machine

```text
create + immediate issue -> PENDING_PAPERWORK
PENDING_PAPERWORK -> PENDING_APPROVAL (complete paperwork)
REJECTED -> PENDING_APPROVAL (complete correction)
PENDING_APPROVAL -> COMPLETED (approve paperwork)
PENDING_APPROVAL -> REJECTED (return for correction)
```

- Initial temporary submission stores `origin=EXPRESS`, `type=null`, locked claimant/warehouse/item snapshots, and an open paperwork task.
- Only the claimant may complete paperwork. Warehouse, claimant, variants, and quantities are immutable after the issue.
- Each express request owns exactly one paperwork task. Paperwork submission and review must reject a missing task or a task in the wrong state instead of silently creating a replacement.
- Rejection requires a comment and reopens the same paperwork task with the original deadline.
- Temporary requests do not support normal cancellation, reservation, release, or fulfillment actions.

## 5. Work Calendar and Tasks

- Calculate the deadline in `Asia/Shanghai`. The submission date is not counted; the deadline is the end of the third following working day.
- `WorkCalendarDay` overrides the default Monday-to-Friday calendar for holidays and adjusted workdays.
- Load configured calendar days in an expanding query window until the calculated deadline is inside the loaded range. A fixed look-ahead horizon is forbidden because a long configured holiday sequence can move the deadline beyond it.
- Persist the resolved deadline on the single paperwork `AdminTask`. Upgrade that row from `PAPERWORK_REQUIRED` to `PAPERWORK_OVERDUE` idempotently after the deadline.
- Overdue status is informational and does not block the claimant from other requests.

Paperwork issue, submission, approval, rejection, and overdue audit records retain the claimant ID and the persisted original paperwork deadline. Do not recalculate or replace the deadline when a correction is reopened.

## 6. Offline Registration

- Only a system administrator or an administrator authorized for the actual warehouse may create an offline request.
- The claimant must be an active local user with a persisted `CLAIMANT` role. Free-text claimant names are forbidden.
- Offline registration requires all business fields and item lines in the initial command.
- Store `origin=OFFLINE`, `status=COMPLETED`, the selected claimant, and the administrator as fulfillment executor. Do not create approval or reservation rows.

## 7. Projection and Authorization

- `RequestQueryService` projects all origins through the shared request response schema.
- `type`, `purposeObject`, and `finalDestination` may be null only while express paperwork is incomplete.
- Project `paperworkDueAt`, `paperworkOverdue`, and actor-relative `allowedActions` on every response.
- Reauthorize every read and mutation against the request's persisted warehouse. Never trust a queue filter or request payload as proof of access.

## 8. Stable Errors

| Condition                                                      | Error                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| Invalid body, UUID, date, quantity, or missing idempotency key | `VALIDATION_ERROR`                          |
| Request missing or not visible                                 | `REQUEST_NOT_FOUND`                         |
| Claimant or warehouse access denied                            | `REQUEST_FORBIDDEN` / `FORBIDDEN_WAREHOUSE` |
| Selected local claimant missing or inactive                    | `CLAIMANT_NOT_FOUND`                        |
| Invalid source or state transition                             | `REQUEST_STATE_CONFLICT`                    |
| Inactive, missing, or duplicate item                           | `REQUEST_ITEM_UNAVAILABLE`                  |
| Insufficient available inventory                               | `INVENTORY_INSUFFICIENT`                    |
| Same key used with a different command                         | `IDEMPOTENCY_CONFLICT`                      |

## 9. Required Tests

- Pure tests cover Shanghai date boundaries, weekends, holidays, adjusted workdays, and cross-month deadlines.
- PostgreSQL tests cover immediate all-or-nothing issue, shortage rollback, retries/conflicts, paperwork immutability, zero inventory side effects during paperwork/review, task reuse, overdue upgrade, dual actor identity, and cross-warehouse denial.
- HTTP tests cover authentication, static route ordering, validation, claimant ownership, warehouse authorization, and stable error mapping.
- The full gate includes Prisma generate/validate, lint, typecheck, unit/HTTP tests, build, PostgreSQL integration tests, and `git diff --check`.
