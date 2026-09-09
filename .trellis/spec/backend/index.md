# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide                                                                             | Description                                                                      | Status  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| [Directory Structure](./directory-structure.md)                                   | Module organization and file layout                                              | To fill |
| [Database Guidelines](./database-guidelines.md)                                   | ORM patterns, queries, migrations                                                | To fill |
| [Error Handling](./error-handling.md)                                             | Error types, handling strategies                                                 | To fill |
| [Quality Guidelines](./quality-guidelines.md)                                     | Code standards, forbidden patterns                                               | To fill |
| [Logging Guidelines](./logging-guidelines.md)                                     | Structured logging, log levels                                                   | To fill |
| [Authentication and Authorization](./authentication-guidelines.md)                | Feishu login, sessions, bootstrap and warehouse RBAC                             | Active  |
| [Catalog and Inventory Query](./catalog-inventory-query.md)                       | Catalog management, image proxy, inventory projection and warehouse QR contracts | Active  |
| [Normal Request Workflow](./normal-request-workflow.md)                           | Online normal borrowing state machine, atomic inventory actions and idempotency  | Active  |
| [Temporary and Offline Request Workflow](./temporary-offline-request-workflow.md) | Immediate issue, paperwork, work-calendar deadlines and offline registration     | Active  |
| [Inventory Operations Workflow](./inventory-operations-workflow.md)               | Inbound, transfer, stocktake, returns, tasks, worker and calendar contracts       | Active  |
| [Feishu Synchronization](./feishu-sync-workflow.md) | CLI intents, ordered settlement, reconciliation, administrator APIs and runtime tests | Active |
| [Historical Feishu Migration](./feishu-migration-workflow.md) | Frozen snapshots, historical transformation, source deduplication and controlled commands | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
