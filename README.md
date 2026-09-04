# GloryChips Warehouse

TypeScript monorepo for the GloryChips warehouse inventory and borrowing system.

## Prerequisites

- Node.js 24.16.0
- pnpm 11.22.0
- Docker Desktop with Docker Compose

## Local setup

Create the ignored local environment file before starting the services:

```powershell
Copy-Item .env.example .env
```

Fill every `replace_with_*` value in `.env`. `FEISHU_APP_ID` and
`VITE_FEISHU_APP_ID` must contain the same real `cli_...` App ID. Keep
`FEISHU_APP_SECRET` only in `.env` or the deployment environment; never commit it.

The Feishu Open Platform app also requires these manual settings:

- Add the exact redirect URL from `FEISHU_REDIRECT_URI` to the web application's
  redirect URL allowlist. Local development uses
  `http://localhost:3000/auth/feishu/oauth/callback`.
- Grant the contact permissions needed for `contact/v3/users/:id` to return the
  employee `user_id`, `department_ids`, and employment `status` fields.
- Include the intended employees in the app availability scope and publish a new
  app version after changing permissions or availability.
- Set `FEISHU_ALLOWED_TENANT_KEY` to the company tenant and
  `INITIAL_ADMIN_FEISHU_USER_ID` to the contact API's stable `user_id`, not the
  OAuth `open_id`.

Then install dependencies and start the local services:

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:web
```

The web app runs at `http://localhost:5173`, and the API health endpoint is
`http://localhost:3000/health`.

The worker is a standalone NestJS process. Use `pnpm dev:worker`; set
`WORKER_RUN_ONCE=true` for a single database probe instead of the polling loop.

The API and Vite web app both load the repository-root `.env` during local
development. Existing process environment variables keep precedence, so production
deployments can inject secrets without a file.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose config
```

The authentication service connects to Feishu OAuth and the contact API. It does not
use `lark-cli` at runtime and does not write to any Feishu Base.
