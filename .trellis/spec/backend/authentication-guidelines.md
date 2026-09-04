# Authentication and Warehouse Authorization

## Scenario: Feishu-only authentication and local RBAC

### 1. Scope / Trigger

Use this contract whenever code changes Feishu login, server sessions, role assignment,
warehouse authorization, authentication cookies, or the first-system-administrator flow.
Feishu proves identity; PostgreSQL remains the source of truth for sessions, roles,
warehouse scopes, bootstrap history, and audit history. Never use `lark-cli` for login.

### 2. Signatures

HTTP endpoints:

```text
GET  /auth/feishu/oauth/start?returnTo=<internal-path>
GET  /auth/feishu/oauth/callback?code=<code>&state=<state>
POST /auth/feishu/client/challenge { returnTo? }
POST /auth/feishu/client/login     { code, challenge }
GET  /auth/me
POST /auth/logout
PUT  /access/users/:userId         { roles, warehouses }
GET  /access/warehouses/:warehouseCode/probe
POST /access/warehouse-probe       { warehouse }
```

Persistence contracts:

```text
auth_login_states(token_digest unique, kind, return_to, expires_at, consumed_at)
auth_sessions(token_digest unique, user_id, expires_at, revoked_at, last_seen_at)
system_bootstrap_events(key unique, user_id, tenant_key, config_version_digest)
```

The fixed bootstrap key is `INITIAL_SYSTEM_ADMIN`. Pure PostgreSQL advisory-lock calls
must use `$executeRaw`; `$queryRaw` is reserved for rows that Prisma can deserialize.

### 3. Contracts

Required API environment keys:

```text
DATABASE_URL
WEB_PUBLIC_URL
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_ALLOWED_TENANT_KEY
FEISHU_REDIRECT_URI
INITIAL_ADMIN_FEISHU_USER_ID
```

`FEISHU_APP_ID` must match the real Open Platform `cli_...` identifier shape;
placeholder values must fail during environment parsing. Local development loads the
repository-root `.env` for the API and Vite app, while already-set process variables
retain precedence. `INITIAL_ADMIN_FEISHU_USER_ID` is the stable `user_id` returned by
the contact API, not the OAuth `open_id`.

Optional keys and defaults:

```text
SESSION_COOKIE_NAME=glorychips_session
OAUTH_BINDING_COOKIE_NAME=glorychips_oauth_binding
SESSION_TTL_SECONDS=28800
AUTH_STATE_TTL_SECONDS=600
```

Session and OAuth binding cookie names must differ. Session cookies use `Path=/`;
OAuth binding cookies use `Path=/auth/feishu/oauth/callback`. Both are `HttpOnly` and
`SameSite=Lax`; production adds `Secure`. The database stores SHA-256 token digests,
not bearer tokens.

OAuth `state` is both one-time in PostgreSQL and bound to the initiating browser by the
short-lived OAuth cookie. The callback clears that cookie on success and failure, then
uses constant-time comparison before consuming state or calling Feishu.

Browser OAuth exchanges codes through `authen/v2/oauth/token`. Feishu-client
`requestAccess` codes use `auth/v3/app_access_token/internal`, then
`authen/v1/access_token`. Both flows converge on `authen/v1/user_info`, the contact
status lookup, local identity binding, bootstrap, and session creation.

`authen/v1/user_info` is the source for `tenant_key`, `open_id`, `union_id`, name, and
avatar, but it must not be expected to return `user_id`. Use its `open_id` to call
`contact/v3/users/{open_id}?user_id_type=open_id`; the contact response owns the stable
`user_id`, `department_ids`, and employment `status`. Missing contact fields indicate
an app permission or upstream schema problem and must fail closed before local identity
binding. The Open Platform app must be published with permissions that expose those
fields and an availability scope containing the employee.

The web app loads H5 JS SDK `1.5.26` only for a Feishu/Lark client user agent. Ordinary
browsers must not insert the SDK script or emit bridge errors; they use OAuth.

Access invariants:

- Every user retains `CLAIMANT`.
- `WAREHOUSE_ADMIN` exists if and only if at least one warehouse scope exists.
- `SYSTEM_ADMIN` has all warehouses without persisted scope rows.
- Removing a system administrator is serialized, and the final active system
  administrator cannot be removed.
- Every warehouse operation rechecks the actual URL/body/entity warehouse on the server.

### 4. Validation & Error Matrix

| Condition | Stable error |
| --- | --- |
| Missing, expired, revoked session or inactive local user | `AUTH_REQUIRED` |
| Missing/malformed/mismatched/replayed state or challenge | `AUTH_STATE_INVALID` |
| Feishu identity conflicts with an existing binding | `AUTH_IDENTITY_CONFLICT` |
| Feishu network/schema/contact failure | `AUTH_UPSTREAM_UNAVAILABLE` |
| Contact response omits `user_id` or employment `status` | `AUTH_UPSTREAM_UNAVAILABLE` |
| Tenant mismatch | `FEISHU_TENANT_FORBIDDEN` |
| Feishu code `20010` / user outside app scope | `FEISHU_APP_SCOPE_FORBIDDEN` |
| Feishu or local employee inactive | `USER_INACTIVE` |
| Missing required system role | `FORBIDDEN_ROLE` |
| Missing exact warehouse scope | `FORBIDDEN_WAREHOUSE` |
| Invalid role/scope combination | `INVALID_ACCESS_PROFILE` |
| Removing the last active system administrator | `LAST_SYSTEM_ADMIN` |

Upstream payloads, access tokens, authorization codes, app secrets, and complete personal
snapshots must never appear in API errors or logs.

### 5. Good / Base / Bad Cases

- Good: OAuth state and binding cookie match, the allowed active employee is upserted,
  the state is consumed once, and a digest-backed session cookie is issued.
- Base: an ordinary employee receives only `CLAIMANT`; a single-warehouse administrator
  can use only the matching warehouse endpoint; a system administrator sees both.
- Bad: callback without its binding cookie, replayed callback, external `returnTo`, outer
  tenant, inactive employee, or forged warehouse input fails closed without a session.

### 6. Tests Required

- Unit: shared Zod contracts, internal return-path normalization, cookie attributes,
  constant-time state binding, OAuth/client token routing, Feishu error mapping, and SDK
  loading only in client user agents. Provider fixtures must model `user_info` without
  `user_id`, assert an `open_id` contact lookup, and cover missing protected contact
  fields.
- Nest HTTP: redirects, binding/session cookie headers, malformed/mismatched/replayed
  callback, client flow independence, global error filter, `401`, `403`, and URL/body
  warehouse guards.
- PostgreSQL integration: one-time state, digest-only session storage, OAuth/client user
  convergence, concurrent first-admin bootstrap, complete role matrix, atomic audit,
  last-admin protection, and concurrent administrator demotion.
- Browser QA: desktop and mobile signed-out state, no horizontal overflow, no page errors,
  no H5 SDK in ordinary browsers, and a visible OAuth fallback.

### 7. Wrong vs Correct

#### Wrong

```typescript
await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
const state = await auth.consumeLoginState('OAUTH_STATE', query.state);
```

This asks Prisma to deserialize PostgreSQL `void` and consumes a transferable state that
is not bound to the browser that initiated login.

#### Correct

```typescript
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
if (!constantTimeSecretEqual(query.state, bindingCookie)) {
  throw new AuthDomainError('AUTH_STATE_INVALID', 'The login state is invalid.');
}
const state = await auth.consumeLoginState('OAUTH_STATE', query.state);
```

The callback validates the browser binding before any one-time state consumption or
upstream identity exchange.

#### Wrong

```typescript
const userInfo = userInfoSchema.parse(payload).data;
return { userId: userInfo.user_id };
```

This relies on a field that the real OAuth user-info response does not provide.

#### Correct

```typescript
const userInfo = userInfoSchema.parse(payload).data;
const contact = await getContactUser(userInfo.open_id, 'open_id');
return { userId: contact.user_id, openId: userInfo.open_id };
```

OAuth supplies the application-scoped lookup key; the permission-protected contact
response supplies the stable employee ID and status.
