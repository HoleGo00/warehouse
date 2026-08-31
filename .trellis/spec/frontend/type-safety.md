# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

TypeScript strict mode is enabled across the workspace. Shared domain values and
wire schemas are owned by `packages/contracts`.

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

Put cross-layer types in `packages/contracts`; keep component-only view models next
to the component or feature that owns them.

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

Use Zod schemas at API/environment boundaries and infer TypeScript types from those
schemas. Avoid unchecked casts; decode unknown JSON once at the boundary.

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

Prefer discriminated unions and readonly input arrays for commands. Normalize dates
at boundaries and use explicit ISO strings in browser-facing responses.

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

Do not add `any`, non-null assertions, or broad `as` casts to bypass a contract
failure. Fix the source type or add a decoder.
