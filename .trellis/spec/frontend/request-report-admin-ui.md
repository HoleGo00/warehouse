# Report, Export and Access Administration

## Routes and Controls

- `/admin/reports` has query and owned-export tabs. `/admin/access` is system-admin only.
  Hide administrative navigation from claimants; the server remains the authority.
- Use Vue script setup with typed contracts and existing shadcn-vue/Lucide primitives.
  Forms, tables and page sections are unframed operational layouts, not marketing cards.
- A segmented date control defaults to submission and can select actual fulfillment.
  Export uses the applied filters across all pages, not the current page or unsent form edits.
- Show matching item quantity, whole-request status and both dates. Open the existing
  full request detail and its separately paginated inventory movements.
- Historic claimant lookup is scoped by warehouse and supports search/more results.
  Staff management includes only logged-in employees and cannot create accounts or change
  employment status. Permission edits reuse `AuthService.updateAccess`.
- Role editing always keeps CLAIMANT. Warehouse admins need a scope; system admins
  do not persist scope rows. Preserve the last-system-admin rejection and audit.

## Async State and Security

- Retain applied report filters and pagination in session-keyed in-memory navigation
  state when returning from detail. Do not put free-text filters into shareable URLs
  or persistent browser storage.
- Abort obsolete reads and ignore late responses after account/access changes or
  disposal. Clear report/staff data when the API reports authorization loss.
- Clear old result rows and pagination while a new query is loading or has failed.
- Poll export status every five seconds; refresh the loaded prefix without dropping
  appended pages. Prevent overlapping polls and deduplicate job IDs.
- An uncertain create response reuses its idempotency key. A changed filter or confirmed
  creation starts a distinct operation. Only the owner's successful, unexpired job is downloadable.
- A download failure is visible; the server rechecks current ownership, roles and
  expiry even if an old button is still enabled.

## Quality Check

- Verify mixed-request quantities, date switching, pagination/detail return, real XLSX
  browser download, repeated download, role edits, last-admin rejection and live revocation.
- Test 1440x900 and 390x844. Tables may scroll inside their own container; the page must
  not overflow horizontally. Check long names and permission dialogs.
- Wait for dialog animation completion before taking evidence screenshots; an early
  opacity frame does not prove a persistent rendering defect.
- Label synthetic error/expiry response tests separately from real API/database evidence.
- Test-session cookies and fixture credentials belong only in ignored local QA artifacts.
  A simulated local login never proves real Feishu OAuth acceptance.
