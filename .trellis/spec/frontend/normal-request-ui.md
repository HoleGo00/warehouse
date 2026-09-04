# Normal Request UI

## 1. Scope / Trigger

Use this contract for claimant submission, personal request history/detail, resubmission/cancellation, and administrator review/fulfillment pages. The UI is an authenticated operational tool and must preserve locked warehouse context, server-projected actions, retry safety, and stable layouts.

## 2. Signatures

Routes:

```text
/w/:warehouseCode/apply/normal
/requests/me
/requests/:requestId
/admin/requests
```

Frontend ownership:

```text
NormalRequestForm          -> form markup and emits
useNormalRequestForm       -> mutable draft and normalization
request-view-model.ts      -> labels, validation, projections
request-api.ts             -> authenticated wire adapter and idempotency keys
NormalRequestApplyView     -> locked-warehouse submission orchestration
RequestDetailView          -> claimant detail, resubmit, cancel
AdminRequestsView          -> warehouse queues, review, cancel, fulfill
```

## 3. Contracts

- Never offer a warehouse selector inside a claimant form; send the validated route warehouse unchanged in the create command.
- Build selectable rows by intersecting `/catalog/selectable` with the current warehouse inventory response. The API remains authoritative and revalidates every item.
- Type changes normalize fixed return policies immediately. Date inputs use the current Shanghai date as their minimum; the shared schema performs final calendar-date validation.
- Render server `allowedActions`; do not reconstruct mutation permissions from role labels.
- Each route/filter/detail load has a generation token. Clear obsolete detail/action data when the route or selection changes and ignore late responses from older generations.
- After administrator mutations, reload the queue and selected detail from the server.
- An ambiguous failed mutation retains the same idempotency key while the normalized command is unchanged. Changing any command field rotates the key.
- Every async action exposes disabled/loading state and visible success/error feedback. Long names wrap, controls keep stable dimensions, and the document must not overflow horizontally at 390px.

## 4. Validation & Error Matrix

| Condition | UI behavior |
| --- | --- |
| Invalid warehouse route | Render explicit invalid-entry state; send no mutation |
| Catalog or inventory load fails | Clear stale choices, show retryable page error |
| Request detail load fails | Clear the previous request and action area |
| Queue/detail selection changes rapidly | Only the newest generation may update state |
| Shared request schema rejects draft | Show field/form feedback and send no request |
| Mutation fails ambiguously | Preserve the command-key pair for retry |
| Server returns a state/permission conflict | Show the stable error and refresh authoritative state |

## 5. Good / Base / Bad Cases

- Good: a user changes warehouse routes while the first inventory request is slow; the first response is ignored and cannot populate the new warehouse form.
- Base: a failed submit is retried without changing fields and reuses the same idempotency key.
- Bad: an administrator cancel button is shown because `fulfill` is allowed even though `adminCancel` is false.
- Bad: a detail request fails but the previous request remains visible and its action buttons can still be clicked.

## 6. Tests Required

- Unit-test return-policy normalization, calendar dates, draft validation, quantity totals, selectable catalog/inventory joins, allowed-action rendering, and command-aware idempotency-key reuse.
- API adapter tests assert URL, credentials, `Idempotency-Key`, payload parsing, and stable error parsing.
- Async view tests assert stale response suppression and clearing of obsolete detail/queue state.
- Browser acceptance at 1440x900 and 390x844 covers submit, claimant cancel, reject, approve, administrator cancel, fulfill, resubmit, keyboard labels, long content, empty/error states, and zero document overflow.
- Browser acceptance records console errors, page errors, and failed resources; all must be zero for the controlled test flow.

## 7. Wrong vs Correct

### Wrong

```typescript
detail.value = await api.getDetail(route.params.requestId as string);
```

A late response can overwrite a newer route and a failed request can leave stale actions visible.

### Correct

```typescript
const generation = ++loadGeneration;
detail.value = null;
const response = await api.getDetail(requestId);
if (generation === loadGeneration) detail.value = response;
```

Use the same generation check in success, error, and finalization paths so obsolete requests cannot change current state.
