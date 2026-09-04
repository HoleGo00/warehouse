# Temporary and Offline Request UI

## 1. Scope / Trigger

Use this contract for locked-warehouse temporary issue, claimant paperwork/correction, administrator paperwork queues, source-aware review, and administrator-recorded offline issue.

## 2. Routes and Ownership

```text
/w/:warehouseCode/apply/temporary -> TemporaryRequestApplyView
/requests/:requestId              -> RequestDetailView + PaperworkRequestForm
/admin/requests                   -> AdminRequestsView
/admin/requests/offline           -> OfflineRequestView
```

```text
RequestBusinessFields -> shared business-field controls and return-policy inputs
RequestItemEditor     -> shared selectable item lines and quantities
NormalRequestForm     -> business fields plus mutable item editor
PaperworkRequestForm  -> business fields plus immutable issued item table
request-api.ts        -> authenticated transport and command-aware idempotency keys
request-view-model.ts -> source/status/type labels, item validation, catalog/inventory join
```

## 3. Temporary Issue

- Lock warehouse from the validated QR route and claimant from the authenticated session. Do not render selectors for either value.
- The first command contains only warehouse and item lines. Do not request type, purpose, destination, notes, or return rules.
- Build options by intersecting selectable catalog variants with the locked warehouse inventory projection. The server remains authoritative.
- Preserve the idempotency key when an unchanged command is retried after an ambiguous failure. Rotate it when any item or quantity changes.
- On success, navigate to the returned request detail. Do not offer normal cancel or release actions.

## 4. Paperwork and Correction

- Render the paperwork form only when server-projected `allowedActions.completePaperwork` is true.
- Initialize nullable business fields with editable empty values, but keep warehouse, claimant, variants, and quantities read-only.
- Apply the same type/return-mode normalization and date validation used by normal requests.
- Display the persisted deadline and semantic overdue state. A rejected express request is labeled `待补正`, not the normal-request label `已退回`.
- Submission updates only business fields and uses `PUT /requests/:requestId/paperwork` with a command-aware key.

## 5. Administrator Queues and Review

- The administrator page has distinct normal and paperwork queue modes. Paperwork states are `REQUIRED`, `CORRECTION`, and `OVERDUE`.
- Reload and clear selected detail whenever warehouse, mode, or state changes. Ignore late responses using generation counters.
- Show source, nullable-field placeholders, deadline, and overdue state from the server projection.
- Render review only from `allowedActions.review`. Express approval is labeled as paperwork approval and must not imply inventory reservation.
- After a mutation, reload the authoritative queue and clear obsolete selected details.

## 6. Offline Registration

- Warehouse choices are limited to the current administrator's managed warehouses.
- The actual claimant must come from `/admin/claimants`; free-text claimant submission is forbidden.
- Search has loading, error, and empty states and clears a selected claimant that is not present in the latest result.
- Reuse the complete business-field rules and `RequestItemEditor`. The create command includes warehouse, stable claimant ID, complete business fields, and item lines.
- On success, navigate to the returned completed request, which displays claimant and fulfillment executor separately.

## 7. Shared Projection and Design

- Personal list/detail display `ONLINE`, `EXPRESS`, and `OFFLINE` with explicit source labels.
- Use server `allowedActions`; never infer permissions from role names or status alone.
- Use shadcn-vue primitives for standard controls and keep domain-specific layout components focused.
- Follow `design-guidelines.md`: functional copy only, neutral/cool palette, no blue-purple dark theme, no cream/orange retro-serif styling, radius at most 8px, no nested cards, purposeful borders, and restrained shadows.
- Maintain stable control dimensions and bounded internal overflow. The document must not horizontally overflow at 390px.

## 8. Required Tests

- Adapter tests cover all new URLs, credentials, response decoding, and `Idempotency-Key` headers.
- Pure/composable tests cover nullable labels, express correction labels, item validation, return-policy normalization, and command-key reuse.
- Browser acceptance at 1440x900 and 390x844 covers temporary issue, paperwork, express review, overdue queue, claimant selection, and offline issue.
- Browser acceptance records document overflow, console errors, page errors, and failed responses; all must be zero for the controlled flow.
