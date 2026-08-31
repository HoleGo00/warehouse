# GloryChips Warehouse

TypeScript monorepo for the GloryChips warehouse inventory and borrowing system.

## Prerequisites

- Node.js 24.16.0
- pnpm 11.22.0
- Docker Desktop with Docker Compose

## Local setup

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

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose config
```

This foundation does not connect to Feishu OAuth or write to any Feishu Base.
