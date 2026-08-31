# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

PostgreSQL is accessed through Prisma 7 and the generated ESM client. The Prisma
schema is the model source of truth; migrations are immutable SQL history under
`packages/database/prisma/migrations`.

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

Use Prisma's typed query API for ordinary reads and writes. Use parameterized
`$queryRaw` only for PostgreSQL features that Prisma does not model, such as
`FOR UPDATE` row locks and transaction advisory locks. Inventory commands must go
through `InventoryService`.

---

## Migrations

<!-- How to create and run migrations -->

Run `pnpm db:migrate` for deploy-time migrations, `pnpm db:migrate:dev` when creating
a migration against a development database, and `pnpm db:seed` for the idempotent
catalog/warehouse baseline. Never edit an already-applied migration in a deployed
environment.

---

## Naming Conventions

<!-- Table names, column names, index names -->

Prisma models use singular PascalCase names and map to snake_case plural PostgreSQL
tables. Model fields use camelCase with explicit `@map` for persisted snake_case
columns. Stable business keys and idempotency keys have database unique constraints.

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

Do not update `inventory_balances` from controllers or ad-hoc scripts. A balance
change must be paired with an append-only `inventory_movements` row and, when
external synchronization is needed, an `outbox_jobs` row in the same transaction.
