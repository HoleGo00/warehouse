# Task-8 Planning Evidence

## Scope and Status

Read-only source inspection and planning on 2026-09-09, baseline `53a27c4`.
No implementation, new dependency declaration, dependency-lock change, migration,
remote Base write or task activation has occurred. Work is single-agent.
The final `pnpm exec prettier --check` automatically synchronized the main
worktree's existing locked dependencies and ran its Prisma-generate postinstall.
This refreshed ignored local dependency/client artifacts only; it did not install
the proposed Excel dependency or apply database migrations.

## Repository Findings

| Source | Evidence | Design consequence |
| --- | --- | --- |
| `packages/database/src/requests/request-query-service.ts` | Mine/detail/admin queue/paperwork/active claimant candidates only | Add a separate report query; do not change operational queue semantics |
| `packages/database/src/requests/request-shared.ts` | Detail includes approvals, fulfillment and return obligations; submittedAt falls back to createdAt | Reuse business projections; add bounded movement access |
| `packages/database/prisma/schema.prisma` | Request has submittedAt; Fulfillment has unique requestId and fulfilledAt; movements retain occurredAt | Report fulfilledAt, not completedAt; no historical date backfill |
| `packages/database/src/requests/normal-request-service.ts` | Fulfillment and ISSUE creation share a business transaction; resubmit refreshes submittedAt | Preserve current submission semantics |
| `packages/database/src/requests/temporary-offline-request-service.ts` | Temporary and offline issuance create both ISSUE and fulfillment | Paperwork completion must not move the issuance reporting date |
| `packages/database/src/auth/auth-service.ts` | loadSession reloads current access; updateAccess checks actor and serializes last-admin removal | Reuse authorization and audit, add a staff list/UI |
| `apps/api/src/access/access.controller.ts` | Existing protected PUT user access endpoint | Add read projection without a second role mutation implementation |
| `apps/api/src/sync/admin-sync.controller.ts` | System-admin-only retry/reconciliation/binding reads | Keep scope and mapping read-only; no production activation |
| `apps/worker/src/create-worker-scheduler.ts` | Serial synchronization and reminder tasks | Run exports in a separate process to avoid delaying inventory jobs |
| `apps/web/src/router/index.ts` and `AppShell.vue` | Existing catalog/calendar/tasks/sync/requests routes | Add reports/access routes and preserve working navigation |
| `.trellis/spec/frontend/design-guidelines.md` | shadcn-vue and Lucide are current rules | Do not follow obsolete Epic Element Plus text |
| `.gitignore` | `.trellis/.runtime/` ignored | Development export files belong in a private runtime child directory |

## External Library Check

Primary publisher metadata was inspected using:

```bash
pnpm view exceljs version license engines --json
gh api repos/exceljs/exceljs/contents/README.md --jq .content | base64 --decode
```

Registry result: version `4.4.0`, license `MIT`, declared Node engine `>=8.3.0`.
This does not prove compatibility with this repository's Node 24/TypeScript 6;
installation, audit and a real write/read smoke test are required during execution.

Publisher README reference:

```text
https://github.com/exceljs/exceljs
```

The Streaming XLSX Writer section documents a filename or writable-stream output,
row commit for releasing row objects, worksheet completion and workbook completion.
If neither a file nor stream is supplied, the library uses an in-memory buffer.
Therefore the proposed implementation supplies a private file stream and commits
rows explicitly. Two large sheets will be written sequentially to avoid depending
on unspecified interleaved ZIP buffering behavior.

Web search/open returned no usable source body in this session; GitHub's API
provided the publisher README instead. The proposed dependency was not installed.

## Decisions and Risks

- The user confirmed matched-item-only output, submission/fulfillment date modes,
  24-hour file lifetime and read-only Feishu mapping during planning.
- A PostgreSQL job table follows the project's no-Redis decision; exports do not
  reuse inventory outbox semantics or remote-write intents.
- A shared private directory avoids adding an external storage provider. This
  introduces an explicit API/exporter shared-volume deployment prerequisite.
- Large-file snapshot duration, Node memory, XLSX text behavior, connection
  capacity and ordinary-API latency need measured tests, not claims based on
  library metadata.
- Proposed protective limits are 100,000 matched lines, 64 MiB, 300 seconds and
  two unfinished jobs per user. They are subject to the final plan approval.
- Legacy imported movements without Request linkage are not fabricated into the
  two request-oriented report sheets; original inventory/migration evidence stays
  available separately.
- Production OAuth, target switching, actual Base writes and true production
  deployment remain outside this task.
