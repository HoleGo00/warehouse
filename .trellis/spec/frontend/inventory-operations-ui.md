# Inventory Operations, Returns, Tasks, and Calendar UI

## 1. Scope / Trigger

Use this contract for the administrator routes that record inbound, transfer, stocktake,
physical returns, administrator tasks, and work-calendar overrides.

```text
/admin/inventory/inbound
/admin/inventory/transfer
/admin/inventory/stocktake
/admin/returns
/admin/tasks
/admin/work-calendar
```

All six paths must also remain accepted authentication return paths so direct navigation
survives Feishu login.

## 2. Shared Structure

- Route views remain thin wrappers. `InventoryOperationForm` owns the shared inbound,
  transfer, and stocktake form behavior; `inventory-operations-api.ts` owns transport and
  shared response decoding.
- Use the authenticated session projection to derive managed warehouses. System
  administrators receive both warehouses; warehouse administrators use the exact scopes
  returned by the server.
- Standard controls come from the repository-owned shadcn-vue primitives. Use Lucide
  icons, shared design tokens, functional copy, labels, loading/error/success states, and
  disabled submission feedback.
- API adapters decode shared Zod contracts and attach `Idempotency-Key` to every mutation.
  Preserve the key for an unchanged command and rotate it when the normalized command
  changes.

## 3. Inventory Operation Forms

- Inbound selects one authorized warehouse, purchase/other type, occurrence time, a
  required source/reason, optional notes, and one or more unique active variants.
- Transfer selects different source and destination warehouses from the actor's scopes.
  Variant labels display source available quantity and destination effective on-hand
  quantity, but the server remains authoritative.
- Stocktake asks for counted quantity, never a signed delta. Show the current effective
  on-hand quantity and a derived difference; require a text difference reason even when
  the difference is zero.
- All three modes reject blank variants, duplicate variants, unsafe quantities, empty
  reasons, and repeated submission while a request is active.
- Editable line arrays and quantity maps use deep Vue reactivity (`ref` or an equivalent
  reactive owner). Reserve `shallowRef` for immutable snapshots that are replaced as a
  whole; nested user edits must update validation and submission state immediately.

## 4. Physical Return Flow

- The queue is filtered by original request warehouse and due/return state. Selecting an
  item loads its authoritative request detail before any receipt can be submitted.
- Display required, returned, and remaining quantity for every open obligation. The user
  enters only the positive quantity received in this batch and cannot exceed the projected
  remaining quantity.
- The receiving warehouse selector is limited to `allowedWarehouses` returned by the
  server and may differ from the original request warehouse.
- Validate every non-zero draft quantity before submission. The presence of one valid
  line must not allow another unsafe, negative, fractional, or over-remaining line to be
  silently omitted from the command.
- Selecting a queue item exposes a detail-loading state, clears stale detail data, and
  blocks duplicate selection or submission until the matching authoritative detail has
  loaded.
- After a successful receipt, clear draft quantities and reload the queue. Request detail
  views must retain per-batch return records with warehouse, processor, quantity, and time.

## 5. Task Center and Work Calendar

- The task center uses a compact list with warehouse, type, status, and severity filters.
  Render `CRITICAL` as destructive; do not use red for ordinary open work.
- Warehouse filter options come only from the authenticated administrator's current
  server-projected scopes. System administrators may receive all warehouses; other roles
  must not be offered an unauthorized filter value.
- Task actions navigate to the owning workflow. There is no generic complete or dismiss
  action that bypasses business invariants.
- The work-calendar page separates range queries from override editing. Date, work/rest
  type, and optional description are functional fields; deleting an override restores the
  default week calendar.
- Default calendar ranges use the current `Asia/Shanghai` month instead of a hard-coded
  date, and an omitted description on update is normalized so an existing description can
  be intentionally cleared.

## 6. Responsive and Visual Contract

- Follow `design-guidelines.md`: neutral/cool surfaces, restrained green operational
  accents, no blue-purple dark theme, no cream/orange retro-serif styling, no descriptive
  marketing copy, radius at most 8px, no nested cards, purposeful borders, and restrained
  shadows.
- At `1440x900`, keep the sidebar fixed-width and the work region fluid. At `390x844`, the
  primary navigation may scroll horizontally inside its own bounded row, but the document
  must not overflow.
- Forms and task rows collapse to a single column on mobile. Labels, long product names,
  dates, quantities, status badges, and action buttons must remain readable without
  overlap or clipping.

## 7. Required Tests and Browser Acceptance

- Adapter tests cover all new URLs, response decoders, credentials, query filters, and
  idempotency headers.
- Unit tests cover form payload mapping and shared request-detail return projections.
- Browser acceptance renders all six pages at `1440x900` and `390x844`, opens a return
  detail, and records document overflow, console errors, page errors, failed requests, and
  HTTP error responses. All error counts and document-overflow checks must be zero.
