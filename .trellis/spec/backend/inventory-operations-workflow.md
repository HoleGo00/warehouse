# Inventory Operations, Returns, Tasks, and Calendar

## 1. Scope / Trigger

Use this contract for administrator inbound, warehouse transfer, stocktake, physical
returns, return reminders, administrator task queries, and work-calendar overrides.
Feishu Base consumption and historical migration remain separate workflows; this layer
creates local movements and outbox facts only.

## 2. Ownership and Signatures

Shared Zod contracts live in `packages/contracts/src/inventory-operations.ts`. Database
transactions and business rules live under `packages/database/src/inventory`; Nest
controllers are transport adapters and the worker only schedules repeatable scans.

```text
InventoryOperationsService.createInbound(command, idempotencyKey, actor)
InventoryOperationsService.createTransfer(command, idempotencyKey, actor)
InventoryOperationsService.createStocktake(command, idempotencyKey, actor)
ReturnService.list(query, actor, now?)
ReturnService.confirm(command, idempotencyKey, actor)
ReturnReminderService.scanDueReturns(now?)
ReturnReminderService.triggerDeparture(command, idempotencyKey, actor)
AdminTaskService.list(query, actor)
WorkCalendarAdminService.list(query)
WorkCalendarAdminService.upsert(date, command, idempotencyKey, actor)
WorkCalendarAdminService.remove(date, idempotencyKey, actor)
```

Every HTTP write requires `Idempotency-Key`. Reusing the key with the same normalized
command returns the stored result; changing the command returns `IDEMPOTENCY_CONFLICT`.

## 3. Inventory Transaction Contract

- Inventory movement sources are independent from request origins. Administrator facts
  use `ADMIN_INBOUND`, `ADMIN_RETURN`, `ADMIN_TRANSFER`, or `ADMIN_STOCKTAKE`.
- A non-zero balance change must append movement rows, update pending local quantity,
  create one outbox aggregate, and write audit records in the same PostgreSQL transaction.
- Validate all lines and authorization before mutation. Lock warehouse-plus-variant keys
  in stable order and roll back the entire multi-line command on any failure.
- Controllers, scanners, calendar services, and task services must never update inventory
  balances directly.
- Inbound and transfer quantities are positive safe integers. Stocktake accepts a
  non-negative counted quantity and compares it with effective on-hand quantity, not
  available quantity.
- A stocktake loss must not reduce effective on-hand below active reservations. Zero
  differences retain operation lines and audit but create no zero movement or outbox.

Inbound permits only active products and active variants. Transfer permits historical or
inactive variants with existing inventory, requires different warehouses, and requires
authorization for both source and destination. Each transfer line creates paired
`TRANSFER_OUT` and `TRANSFER_IN` rows associated with the same operation; their delta sum
must be zero.

## 4. Physical Return Contract

- Return confirmation can only consume existing open `ReturnObligation` rows. Free-form
  inbound cannot represent a return.
- Lock submitted obligations by sorted ID, require them to belong to one request, and
  reject closed or over-returned lines before applying inventory changes.
- The receiving warehouse may differ from the request warehouse, but the actor must be
  authorized for both the original source warehouse and the receiving warehouse. A
  cross-warehouse receipt is therefore performed only by a dual-scope or system
  administrator; list visibility alone never grants receipt authority.
- One request owns at most one obligation per variant through
  `@@unique([requestId, variantId])`. This invariant allows movement rows to map back to
  obligations by variant when creating one `ReturnRecord` per submitted line.
- Partial receipts set the obligation to `PARTIAL`; exact completion sets it to
  `COMPLETED`. Open return tasks complete only when no open obligation remains for the
  request.
- Each successful receipt batch owns a unique business batch number, even when multiple
  batches belong to the same request and idempotent retries return the original batch.
- Due dates and departure events never create movement rows, return records, or balance
  changes. Inventory increases only after confirmed physical receipt.

## 5. Return Tasks and Worker

The date scanner uses the Shanghai calendar date. It creates one task per request with
`return:<requestId>`, then upgrades the same open row from `RETURN_DUE/WARNING` to
`RETURN_OVERDUE/CRITICAL` after the due date. Advisory locking plus the unique
deduplication key makes concurrent or repeated scans harmless.

Before creating or upgrading a task, scanners and departure triggers must lock the
candidate return obligations in the same transaction and re-read their open state after
the lock is acquired. This prevents a final physical receipt from completing an
obligation between an initial query and the task write, which would leave a stale open
task after the return transaction completes.

Manual departure triggering is restricted to system administrators, requires a reason,
uses an HTTP idempotency key, and creates one critical task per matching request with
`departure:<claimantId>:<requestId>`.

The worker performs one scan at startup. `WORKER_RUN_ONCE=true` closes the Nest context
after that scan. Long-running mode schedules the next `setTimeout` only after the prior
promise settles, logs failures structurally, and avoids overlapping scans.
An initial or later scan failure must still schedule the next long-running iteration.
Database connections close both with the Nest application lifecycle and explicit process
shutdown hooks.

## 6. Task Visibility and Calendar

- Warehouse administrators see only tasks whose persisted warehouse is in their exact
  scope. Global tasks are visible only to system administrators.
- Task filters never grant access; service queries reconstruct the permitted warehouse
  predicate from the session principal.
- There is no generic task-completion endpoint. Domain actions own task lifecycle.
- Work-calendar reads return explicit overrides in a requested `YYYY-MM-DD` range. Only
  system administrators may upsert or delete an override.
- Calendar writes are audited. Existing persisted request/task deadlines are immutable;
  changed overrides affect only future calculations.
- Calendar reads are not audited; routine page loads must not create audit-log noise.

## 7. Stable API Errors

Boundary validation, missing idempotency keys, missing obligations, invalid states,
warehouse or role denial, excess return quantity, insufficient inventory, reservation
conflicts, and idempotency conflicts must map to stable shared API codes. Prisma error
messages and internal SQL details must not reach clients.

## 8. Required Tests and Review

- Contract tests cover command normalization, unique lines, dates, filters, and return
  projections.
- PostgreSQL integration tests cover atomic inbound, transfer conservation and dual
  authorization, stocktake gain/loss/zero behavior, reservation protection, partial and
  excess returns, task deduplication, departure triggering, and calendar audit.
- Nest tests cover sessions, idempotency headers, stable status mapping, actual-warehouse
  authorization, and system-administrator guards.
- Worker tests cover one-shot execution, serial polling, stop behavior, and retry after a
  failed scan.
- Review must verify that the obligation-per-variant unique constraint still matches the
  return movement-to-record mapping before changing either schema or service behavior.
