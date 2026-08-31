# Quality Guidelines

> Code quality standards for frontend development.

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

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before handing a
frontend change to review.

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

Avoid duplicated API payload definitions, hidden overflow, inaccessible icon-only
actions, and business rules embedded only in templates.

---

## Required Patterns

<!-- Patterns that must always be used -->

Every async action exposes loading and error states. Components consume shared
contracts instead of recreating product/status strings.

---

## Testing Requirements

<!-- What level of testing is expected -->

Unit-test composables and pure view logic; use browser tests for user-visible flows
once feature pages are introduced.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
