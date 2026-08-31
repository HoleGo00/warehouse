# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

All packages must pass the root `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm build` gates. TypeScript is strict and explicit `any` is forbidden.

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

Do not use direct balance setters, unparameterized SQL, swallowed errors, or imports
that duplicate contracts already defined in `packages/contracts`.

---

## Required Patterns

<!-- Patterns that must always be used -->

Validate external input at the boundary with Zod. Sort multi-line inventory keys
before locking, validate every line before mutation, and make all mutating commands
idempotent. Write audit and outbox records inside the same transaction as business
state.

---

## Testing Requirements

<!-- What level of testing is expected -->

Pure domain calculations and contract parsers require unit tests. Inventory behavior
requires PostgreSQL integration tests for lock ordering, all-or-nothing batches,
idempotent retries, and transfer conservation.

---

## Code Review Checklist

<!-- What reviewers should check -->

Reviewers check transaction boundaries, unique constraints, error classification,
shared contract reuse, and that tests cover both success and rollback paths.
