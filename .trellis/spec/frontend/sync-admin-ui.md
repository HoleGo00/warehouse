# Synchronization Administration UI

## 1. Scope and Trigger

Applies to `/admin/sync`, its auth return path, source-owned Tabs/Dialog primitives,
and `apps/web/src/features/sync`. The screen is an operational tool, not a migration
or production activation console.

## 2. Signatures

- `createSyncApi({ baseUrl?, fetchFunction? })`: authenticated reads, shared response
  parsing, encoded identifiers, cancellation signals and keyed mutations.
- `useSyncAdmin(allowed, api?)`: list/detail lifecycle, target and status filters,
  busy state, manual retry and reconciliation actions.
- `SyncAdminView` composes three focused tables and `SyncJobDialog`. Table rows
  emit a job ID; the dialog emits a typed retry command, not remote coordinates.

## 3. Contracts

- Only system administrators see navigation or data; warehouse administrators and
  claimants receive the functional permission state.
- `jobs/reconciliations/bindings` are explicit tabs. `ALL` is a UI-only sentinel
  and is omitted from API requests.
- Every list and detail load aborts its predecessor and ignores stale responses.
  Closing details or disposing scope invalidates the outstanding detail request.
- Permission loss synchronously clears sensitive state, invalidates reads and
  mutations, and prevents a late response from reopening a dialog.
- Suppress duplicate submissions. Reuse the same idempotency key for an identical
  command after an uncertain failure. Rotate it only for a new command or after
  confirmed completion.
- Display allowlisted business error labels, never raw exception messages.
- Missing, duplicate or invalid remote records display their state, not a fabricated
  zero. A nullable difference displays an absent value.
- While retry is submitting, prevent closing the dialog by overlay or Escape and
  disable form controls. Standard shadcn keyboard and focus semantics must remain.
- Preserve the existing Vue/shadcn-vue/Lucide foundation, restrained radius and
  floating-layer-only shadows. No explanatory page paragraphs or nested cards.

## 4. Validation and Error Matrix

| Condition | UI behavior |
| --- | --- |
| Permission denied | Clear data and actions; show permission state |
| Filter/tab changes during a request | Abort and ignore previous response |
| Network failure after mutation | Keep key for identical retry |
| Unknown provider error | Generic functional error; no raw message |
| Partial target completion | Partial-sync label, not whole-job success |
| Uncertain or manual target | Show safe code, attempts and original-job retry |
| Empty list | Short empty state with existing refresh command |

## 5. Good, Base and Bad Cases

- Good: desktop and mobile place tabs, filters and bounded scrolling tables in
  separate rows; modal text remains inside its viewport.
- Base: one retry click produces one keyed request and refreshed state.
- Bad: trusting TypeScript alone to validate generated primitive styles. Registry
  aliases such as `data-horizontal` and `data-active` are not configured here.

## 6. Required Tests

- `sync-api.test.ts`: all endpoints, credentials, query encoding, mutation headers,
  malformed responses and sanitized labels.
- `useSyncAdmin.test.ts`: permission checks/revocation, cancellation, stale responses,
  duplicate submission, uncertain retry keys, target isolation and disposal.
- Visual checks at `1440x900` and `390x844`: list, detail, tabs, retry, reconciliation,
  empty and permission states; document overflow and console/page errors must be zero.
- Record whether API data was simulated. A mocked visual session is not real
  Feishu write acceptance or a production OAuth test.

## 7. Wrong vs Correct

Wrong: `class="flex data-horizontal:flex-col data-active:bg-background"` without
definitions for those custom variants.

Correct: use `data-[orientation=horizontal]:flex-col` and
`data-[state=active]:bg-background`, including explicit group variants. Inspect the
rendered layout; typecheck cannot detect a silently absent CSS rule.
