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

Use scoped component styles or feature stylesheet modules. Keep the palette and
spacing tokens local until the design system task introduces shared tokens.

---

## Accessibility

<!-- A11y requirements and patterns -->

Interactive controls need labels, keyboard access, disabled/loading states, and
status feedback via semantic roles where appropriate.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
