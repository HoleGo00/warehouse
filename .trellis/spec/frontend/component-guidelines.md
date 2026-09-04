# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

Components use Vue 3 `<script setup lang="ts">` and keep side effects in named
functions or composables rather than inline template expressions.

---

## Component Structure

<!-- Standard structure of a component file -->

Prefer semantic HTML, one primary action per region, visible focus states, and
responsive constraints that keep text inside its container.

---

## Props Conventions

<!-- How props should be defined and typed -->

Props and emits are typed with `defineProps`/`defineEmits`; do not use `any` or
untyped event payloads.

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

Use shadcn-vue as the shared primitive foundation and follow
`design-guidelines.md` for its incremental Tailwind setup, source-owned components,
copy, theme, radius, border, card, shadow, density, and visual-review rules. Existing
scoped feature styles remain valid during migration and for domain-specific layouts
that shadcn does not provide.

---

## Accessibility

<!-- A11y requirements and patterns -->

Interactive controls need labels, keyboard access, disabled/loading states, and
status feedback via semantic roles where appropriate.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Hand-building a common button, select, dialog, or tooltip instead of extending
  the shared shadcn-vue primitive.
- Removing accessible or error text while trying to comply with the ban on visible
  descriptive copy. Functional and assistive text remains required.
- Adding a border or card wrapper at every component boundary instead of only at a
  real visual or interaction boundary.
- Adding a second full component suite because a single shadcn-vue primitive needs a
  local variant.
