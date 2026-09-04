# Normal Request Workflow

## 1. Scope / Trigger

Use this contract for online normal borrowing requests, one-step review, inventory reservation, claimant or administrator cancellation, and fulfillment. Temporary/offline requests, physical returns, and real Feishu outbox consumption are separate workflows.

## 2. Signatures

Database service:

```text
NormalRequestService.createAndSubmit(actor, command, idempotencyKey)
NormalRequestService.resubmit(actor, requestId, command, idempotencyKey)
NormalRequestService.listMine(actor)
NormalRequestService.getDetail(actor, requestId)
NormalRequestService.listAdminQueue(actor, filter)
NormalRequestService.review(actor, requestId, command, idempotencyKey)
NormalRequestService.cancel(actor, requestId, command, idempotencyKey)
NormalRequestService.fulfill(actor, requestId, idempotencyKey)
```

HTTP endpoints:

```text
POST /requests/normal
PUT  /requests/:requestId/resubmit
GET  /requests/me
GET  /requests/:requestId
POST /requests/:requestId/cancel
GET  /admin/requests?warehouse=<code>&status=<status>
POST /admin/requests/:requestId/review
POST /admin/requests/:requestId/cancel
POST /admin/requests/:requestId/fulfill
```

All write endpoints require a non-empty `Idempotency-Key` header.

## 3. Contracts

- `NormalRequestService` owns the business transaction. Request state, approval or fulfillment records, inventory reservations or movements, audit logs, return obligations, and outbox jobs commit or roll back together.
- Reuse `InventoryTransactionExecutor` inside the request transaction. Never call the public `InventoryService` from an active request transaction because it would create a separate transaction.
- The shared idempotency executor uses a stable operation name and normalized command hash. The same key and command returns the stored response; a different command with the same key returns `IDEMPOTENCY_CONFLICT`.
- Lock the request row before evaluating a transition, then lock inventory keys in stable `warehouse_id + variant_id` order.
- State transitions are limited to:

```text
submit -> PENDING_APPROVAL
PENDING_APPROVAL -> PENDING_RELEASE (approve and reserve all lines)
PENDING_APPROVAL -> REJECTED (reject the whole request)
REJECTED -> PENDING_APPROVAL (claimant resubmits the same request)
PENDING_APPROVAL -> CANCELLED (claimant only)
PENDING_RELEASE -> CANCELLED (claimant or authorized administrator, release all lines)
PENDING_RELEASE -> COMPLETED (authorized administrator, consume all lines)
```

- Submission checks availability but creates no reservation or movement. Approval repeats active-product and availability checks while holding inventory locks.
- Fulfillment consumes the single active reservation batch whose variants and quantities exactly match the request items. It creates one `ISSUE` movement per item, one outbox aggregate, one fulfillment record, and return obligations only when required.
- Claimants read only their own requests. Administrators read and mutate only requests whose actual warehouse is within their current server-side scope.

## 4. Validation & Error Matrix

| Condition | Stable error |
| --- | --- |
| Missing or malformed payload, header, UUID, quantity, or date | `VALIDATION_ERROR` |
| Date matches `YYYY-MM-DD` but is not a real calendar date | `VALIDATION_ERROR` |
| Request does not exist or is not visible to the caller | `REQUEST_NOT_FOUND` |
| Caller lacks claimant ownership or actual warehouse scope | `REQUEST_FORBIDDEN` / `FORBIDDEN_WAREHOUSE` |
| Transition is not in the state machine | `REQUEST_STATE_CONFLICT` |
| Product or variant is inactive, unknown, or duplicated | `REQUEST_ITEM_UNAVAILABLE` |
| Submission or approval availability is insufficient | `INVENTORY_INSUFFICIENT` |
| Same idempotency key is reused with a different normalized command | `IDEMPOTENCY_CONFLICT` |

`GIFT` and `SALE` use `NOT_REQUIRED`; `EXHIBIT` requires `BY_DATE`; `INTERNAL` supports no return, date return, or departure return. Rejection comments and all cancellation reasons must be non-empty.

## 5. Good / Base / Bad Cases

- Good: an authorized administrator approves a mixed ring/watch request, one transaction creates all reservations, and fulfillment later consumes the exact batch into movements and outbox steps.
- Base: a claimant cancels a pending-release request; every reservation is released, no movement or return obligation is created, and the reason is audited.
- Bad: a controller updates the request to `PENDING_RELEASE` and then calls `InventoryService.reserveBatch`; a crash between calls leaves an approved request without inventory reservation.
- Bad: a retry uses a new idempotency key after an ambiguous network failure and creates a second request or fulfillment.

## 6. Tests Required

- Contract tests assert return-policy combinations, real calendar dates, positive quantities, response projections, and error codes.
- PostgreSQL integration tests assert submission without mutation, all-or-nothing approval, concurrent approval without overselling, rejection/resubmission history, cancellation release, exact reservation consumption, mixed-target outbox, return obligations, authorization, idempotent retries, and changed-payload conflicts.
- Nest HTTP tests assert session enforcement, idempotency headers, claimant ownership, actual warehouse authorization, state conflicts, and stable error mapping.
- The full gate includes Prisma generate/validate, lint, typecheck, unit/HTTP tests, build, integration tests, and `git diff --check`.

## 7. Wrong vs Correct

### Wrong

```typescript
await database.request.update({ where: { id }, data: { status: 'PENDING_RELEASE' } });
await inventoryService.reserveBatch(command, idempotencyKey);
```

This splits request state and inventory reservation into separate transactions.

### Correct

```typescript
await executeIdempotently(database, key, operation, command, async (transaction) => {
  await lockRequest(transaction, requestId);
  const reservation = await inventoryExecutor.reserveBatchInTransaction(transaction, lines);
  await transaction.request.update({ where: { id: requestId }, data: { status: 'PENDING_RELEASE' } });
  return reservation;
});
```

The state transition, reservation, audit, and saved idempotent response share one transaction.
