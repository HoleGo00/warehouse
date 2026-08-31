# Directory Structure

> How backend code is organized in this project.

---

## Overview

<!--
Document your project's backend directory structure here.

Questions to answer:
- How are modules/packages organized?
- Where does business logic live?
- Where are API endpoints defined?
- How are utilities and helpers organized?
-->

Backend runtime code lives in `apps/api` and `apps/worker`; shared persistence and
domain services live in `packages/database`. Shared request/response contracts and
enums live in `packages/contracts`, while environment parsing lives in
`packages/config`.

---

## Directory Layout

```
src/
├── main.ts
├── app.module.ts
└── <feature>/
    ├── <feature>.controller.ts
    └── <feature>.service.ts
```

---

## Module Organization

<!-- How should new features/modules be organized? -->

Nest controllers are thin transport adapters. Business rules belong in services or
domain packages, never in controllers. Prisma schema, migrations and seed code stay
under `packages/database/prisma`; database-backed domain services stay under
`packages/database/src`.

---

## Naming Conventions

<!-- File and folder naming rules -->

Use kebab-case folders and `<feature>.<role>.ts` files. Types are explicit and
imports use ESM `.js` suffixes because the workspace compiles with NodeNext.

---

## Examples

<!-- Link to well-organized modules as examples -->

See `apps/api/src/health/health.controller.ts` for the minimal controller boundary
and `packages/database/src/inventory/inventory-service.ts` for transaction-owned
domain logic.
