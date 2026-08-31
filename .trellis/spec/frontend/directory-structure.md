# Directory Structure

> How frontend code is organized in this project.

---

## Overview

<!--
Document your project's frontend directory structure here.

Questions to answer:
- Where do components live?
- How are features/modules organized?
- Where are shared utilities?
- How are assets organized?
-->

The Vue app lives in `apps/web/src`. Shared domain enums and response schemas are
imported from `packages/contracts`; the web app must not import Prisma or database
types.

---

## Directory Layout

```
src/
├── main.ts
├── App.vue
├── styles.css
└── features/
```

---

## Module Organization

<!-- How should new features be organized? -->

Keep transport/state logic in feature composables or stores and keep components
focused on rendering and user interaction. Route-level features own their API
adapters; shared schemas stay in `packages/contracts`.

---

## Naming Conventions

<!-- File and folder naming rules -->

Use PascalCase for Vue components, camelCase for composables and kebab-case for
feature folders. Use `<script setup lang="ts">` and explicit prop/event types.

---

## Examples

<!-- Link to well-organized modules as examples -->

`apps/web/src/App.vue` is the current minimal shell and health-check example.
