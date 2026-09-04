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
actions, business rules embedded only in templates, visible descriptive or
promotional copy, blue-purple dark themes, cream/orange retro-serif styling,
large-radius cards, nested cards, unexplained border layers, and decorative shadows.

---

## Required Patterns

<!-- Patterns that must always be used -->

Every async action exposes loading and error states. Components consume shared
contracts instead of recreating product/status strings. Standard controls use
shadcn-vue after its documented incremental setup, and all visual work follows
`design-guidelines.md`. Existing screens are not rewritten solely for library
adoption.

---

## Testing Requirements

<!-- What level of testing is expected -->

Unit-test composables and pure view logic; use browser tests for user-visible flows
once feature pages are introduced.

---

## Code Review Checklist

<!-- What reviewers should check -->

- Confirm standard controls come from shadcn-vue and domain-specific components do
  not duplicate a shared primitive.
- Confirm the first shadcn-vue adoption includes the documented Tailwind, alias,
  `components.json`, token, and utility setup without adding a second component suite.
- Confirm visible copy is functional; keep labels, errors, statuses, confirmations,
  empty states, and accessibility text.
- Confirm cards use at most 8px radius, cards are not nested, borders have a purpose,
  and shadows are restrained.
- Confirm color and typography avoid both blue-purple dark mode and Claude-like
  cream/orange/retro-serif styling.
- Verify desktop/mobile screenshots, keyboard focus, contrast, long text, loading,
  error, empty, and overflow states.
