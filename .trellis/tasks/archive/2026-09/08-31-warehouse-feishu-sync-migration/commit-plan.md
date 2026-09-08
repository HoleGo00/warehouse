# Approved Task-7 Commits

The user approved these two local work commits, task archive and session journal
on 2026-09-08. They include this task's prior implementation and the
fixes/acceptance evidence completed in this continuation. The feature commit is
`4c99e99`; this document is included in the second, documentation commit.
Push, merge, worktree removal and starting task 8 are not authorized by this gate.

## 1. feat: 实现飞书库存同步与迁移管理

- `.env.example`
- `package.json`
- `packages/config/src/index.ts`
- `packages/config/src/worker-config.test.ts`
- `packages/contracts/src/api-errors.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/feishu-migration.ts`
- `packages/contracts/src/feishu-sync.ts`
- `packages/contracts/src/feishu-sync.test.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/0005_feishu_sync_migration/`
- `packages/database/prisma/migrations/0006_movement_product_snapshot/`
- `packages/database/prisma/migrations/0007_reconciliation_unknown_quantity/`
- `packages/database/prisma/migrations/0008_sync_definitive_rejection/`
- `packages/database/src/index.ts`
- `packages/database/src/inventory/inventory-service.ts`
- `packages/database/src/inventory/inventory-transaction-executor.ts`
- `packages/database/src/inventory/movement-snapshots.ts`
- `packages/database/src/sync/`
- `packages/database/test/feishu-migration.integration.test.ts`
- `packages/database/test/feishu-sync.integration.test.ts`
- `packages/database/test/helpers/`
- `packages/database/test/fixtures/feishu-migration/`
- `apps/api/src/app.module.ts`
- `apps/api/src/auth/api-exception.filter.ts`
- `apps/api/src/sync/`
- `apps/worker/src/app.module.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/create-worker-scheduler.ts`
- `apps/worker/src/create-worker-scheduler.test.ts`
- `apps/worker/src/worker-scheduler.ts`
- `apps/worker/src/worker-scheduler.test.ts`
- `apps/worker/src/feishu/`
- `apps/web/src/AppShell.vue`
- `apps/web/src/router/index.ts`
- `apps/web/src/components/ui/dialog/`
- `apps/web/src/components/ui/tabs/`
- `apps/web/src/features/sync/`

## 2. docs: 记录飞书迁移验收与运行规范

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/feishu-sync-workflow.md`
- `.trellis/spec/backend/feishu-migration-workflow.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/design-guidelines.md`
- `.trellis/spec/frontend/sync-admin-ui.md`
- `.trellis/tasks/08-31-warehouse-feishu-sync-migration/`
- `.trellis/tasks/08-28-warehouse-inventory-borrowing-v1/task-map.md`

## Excluded and Separate Gates

- `AGENTS.md`: pre-existing single-agent policy changes, excluded unless the user
  explicitly requests inclusion. Do not revert them.
- Main worktree's two auth-live-fix dirty documents: not part of this worktree's
  commits, preserved untouched.
- `.trellis/.runtime/`, native snapshots, logs, screenshots and databases remain
  ignored/local. Do not force-add credentials or complete personal source data.
- After approved work commits: archive and journal bookkeeping are separate.
  Push and PR merge must follow their own authorization and verification gates.
