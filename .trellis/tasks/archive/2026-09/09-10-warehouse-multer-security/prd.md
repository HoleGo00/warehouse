# Multer Priority Security Remediation

## Goal

Remove the four known Multer advisories from the warehouse dependency graph
without changing application behavior or expanding production access.

## Confirmed Background

- On 2026-09-10, the user approved creating a separate Trellis repair task after
  selecting Multer as the first remediation priority. The user subsequently
  approved the final plan with "confirmed" on the same date.
- The worktree is `D:/GloryChips/glorychips-warehouse-query-export-admin`, on
  `codex/warehouse-query-export-admin`, based on local delivery commit `4106317`.
  It was clean before this task was created.
- `apps/api/package.json:18` selects `@nestjs/platform-express` 12.0.1.
  `pnpm-lock.yaml:4527` resolves its Multer dependency to 2.2.0, also reachable
  from the worker's Nest dependency chain.
- A fresh production-dependency audit reports nine advisories: six high, two
  moderate, and one low. Four belong to Multer: three high and one low.
- Source inspection under `apps` and `packages` found no business multipart
  handler or Nest upload interceptor. This is not penetration-test evidence.
- Official advisory and registry checks identify published Multer 2.3.0 as the
  repair candidate. Provenance is recorded in `design.md`.

## Requirements

- R1: Resolve all four targeted Multer advisories without suppressing audit
  findings or upgrading unrelated frameworks.
- R2: Preserve current HTTP behavior, authorization, reports, exports, and
  worker compatibility. Do not expose a new production upload route.
- R3: Verify the installed dependency graph and real Nest upload integration
  in test-only fixtures, not merely a version string in a manifest.
- R4: Record audit changes, regression results, residual risks, and untested
  boundaries honestly. Remaining non-Multer advisories are deferred, not waived.

## Acceptance Criteria

- [x] AC1 / R1: The lockfile and installed Nest adapter resolve Multer 2.3.0;
  no Multer 2.2.0 remains in the relevant resolved graph.
- [x] AC2 / R1, R4: A fresh audit contains none of the four targeted GHSA IDs.
  Against the current baseline, five unrelated advisories should remain
  (three high, two moderate); newly published findings must be reported separately.
- [x] AC3 / R2, R3: Test-only Nest multipart coverage accepts valid uploads and
  rejects oversized files and invalid or excessive field indices without making
  a subsequent healthy request fail.
- [x] AC4 / R3, R4: Async-filter size enforcement and aborted disk-upload cleanup
  receive bounded regression checks; any platform-specific coverage gap is
  explicitly reported before acceptance.
- [x] AC5 / R2: Frozen-lockfile installation, lint, typecheck, unit/HTTP tests,
  and build pass. Relevant local integration tests pass without using production
  or Feishu shadow data.
- [x] AC6 / R4: The final diff contains only targeted dependency changes,
  regression coverage, and task/evidence documents.

## Out of Scope

- Remediation of mysql2, deepmerge-ts, or decode-uri-component.
- NestJS or Prisma framework upgrades and broad dependency refreshes.
- New product uploads, frontend changes, inventory mutations, database schema
  changes, live Feishu access, production OAuth activation, or cutover.
- Push, PR creation, merge, deployment, or treating audit success as a full
  production-security assessment.

## Planning Status

No unresolved product decisions. PRD convergence review is complete.
Implementation approved on 2026-09-10; automated criteria above have passed.
User accepted the repair and authorized the scoped local commit on 2026-09-10.
Local work commit `74b2eff` is recorded; the task was archived on 2026-09-10.
See `implementation-evidence-2026-09-10.md` for verification and residual risks.
