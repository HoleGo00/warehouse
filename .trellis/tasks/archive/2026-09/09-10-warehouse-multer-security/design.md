# Multer Security Repair Design

## Boundary and Current Ownership

The behavior gap is a vulnerable multipart parser in the installed dependency
graph. Its owner is the Nest Express adapter's dependency resolution, not the
warehouse controllers. Existing parent-scoped overrides live in
`pnpm-workspace.yaml:4`; follow that convention.

Planned product-adjacent changes:

- `pnpm-workspace.yaml`: add the exact, parent-scoped override
  `'@nestjs/platform-express@12.0.1>multer': 2.3.0` and a short security rationale.
- `pnpm-lock.yaml`: regenerate through pnpm; review all changes and reject
  unrelated upgrades.
- `apps/api/src/multer-security.http.test.ts`: test-only Nest integration and
  dependency-resolution coverage. Use existing Vitest, Nest testing, and
  Supertest packages, without adding Multer as a direct application dependency.
- A narrowly scoped test fixture may be added if process isolation is required
  for crash or hang detection. It must not enter the production module graph.
- This task directory: requirements, plan, and reproducible evidence.

No production controller, authentication guard, database contract, or deployment
configuration needs modification. Continue in the current worktree; do not modify
the main checkout or rewrite the three task-8 delivery commits.

## Compatibility Strategy

Keep Nest 12.0.1, Node and pnpm versions, and all existing overrides unchanged.
Resolve Multer through the installed adapter when inspecting the dependency or
running a direct parser-specific check. A root import could test a different
package instance and is insufficient.

Use a test-only controller with Nest's real interceptor to check normal multipart
requests and error translation. Explicitly bound accepted array indices in this
fixture. Production has no upload configuration to harden today; if one is added,
it must choose an application-appropriate `fieldArrayIndexLimit`.

Verified compatibility boundary: Nest 12.0.1 does not translate the new
`LIMIT_FIELD_ARRAY_INDEX` error into HTTP 400. The test-only bounded-field route
rejects excessive indices with HTTP 500 and remains healthy afterward. Keep this
observation explicit; it is not a recommended contract for a future upload API.
No current production upload route exists, and introducing a production error
mapper is outside this dependency-only repair.

Run potentially crashing or CPU-blocking malformed-input checks in a bounded
child process when needed. An HTTP timeout in the same blocked event loop is not
adequate isolation. Use temporary test-owned storage for disk cleanup checks and
confirm resolved paths before removal. No real service receives malformed data.

## Evidence and Provenance

Read-only checks performed on 2026-09-10:

- `pnpm audit --prod --registry=https://registry.npmjs.org --json`: nine findings;
  Multer 2.2.0 appears through both API and worker dependency paths.
- `pnpm view multer@2.3.0 version engines dependencies --json
  --registry=https://registry.npmjs.org`: version exists; Node minimum is 10.16.0.
- GitHub advisory API responses below all identify first patched version 2.3.0:

| Advisory | Severity | Affected behavior |
| --- | --- | --- |
| GHSA-wc9g-mqfw-jrwm | High | Malformed multipart field names can terminate the process |
| GHSA-qfvm-cv95-jqjf | High | Aborted disk uploads retain open resources |
| GHSA-535w-7cp7-47q4 | High | Excessive array indices can block request processing |
| GHSA-qvfw-j98x-7q72 | Low | Async file filters can bypass file-size enforcement |

Sources:

- https://github.com/advisories/GHSA-wc9g-mqfw-jrwm
- https://github.com/advisories/GHSA-qfvm-cv95-jqjf
- https://github.com/advisories/GHSA-535w-7cp7-47q4
- https://github.com/advisories/GHSA-qvfw-j98x-7q72

The array-index advisory also recommends an application-specific minimum
`limits.fieldArrayIndexLimit`. The audit response omits a patched-version field
for the descriptor-leak advisory; the official advisory explicitly supplies it.

## Risks and Rollback

The override replaces an exact upstream dependency pin, so same-major version
compatibility must be demonstrated rather than assumed. If focused regression
fails, investigate within this task; do not silently upgrade Nest or patch
unrelated packages. Escalate a materially broader repair for a revised plan.

Rollback, if required, restores only this task's override and corresponding
lockfile changes, then reinstalls the prior locked graph. This restores the
known vulnerabilities and is not an acceptable final security resolution.

Once upstream adopts an adequate fixed Multer version, reassess removal of the
temporary override under regression tests. Audit removal does not prove absence
of every exploit, production packaging safety, or production readiness.

## Implemented Test Layout

The focused suite contains ten tests. Normal HTTP behavior and configured field
bounds use a real Nest test application. Five parser-specific cases run through
`apps/api/test-fixtures/multer-security.mjs` in bounded child processes, with the
parser entry resolved from the installed adapter. The fixture is outside `src`
and is absent from the API build output. Temporary directories are created by
the parent test, path-checked, and removed in its test-finished cleanup hook.
