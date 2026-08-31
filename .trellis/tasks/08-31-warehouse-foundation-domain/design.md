# 工程与核心库存领域基线设计

## Architecture

```text
apps/web       Vue/Vite 可启动外壳与健康页
apps/api       NestJS HTTP 健康检查与后续模块宿主
apps/worker    NestJS standalone worker 健康检查与任务宿主
packages/contracts  Zod schema、领域枚举、共享类型
packages/config     环境变量解析与校验
packages/database   Prisma schema、迁移、seed、事务客户端
```

根目录提供 pnpm workspace、共享 TypeScript/ESLint/Prettier/Vitest 配置和 Docker Compose。包之间只通过 workspace 依赖引用，不使用跨目录相对路径穿透。

## Database Scope

本任务建立下列表及必要枚举、唯一约束和索引：

- 身份权限：`users`、`roles`、`user_roles`、`warehouses`、`warehouse_admin_scopes`。
- 商品：`product_categories`、`products`、`product_aliases`、`product_variants`、`product_image_refs`。
- 库存：`inventory_balances`、`inventory_reservations`、`inventory_movements`、`inventory_reconciliations`。
- 单据骨架：`requests`、`request_items`、`approval_records`、`fulfillments`、`return_obligations`、`returns`。
- 运维：`work_calendar_days`、`admin_tasks`、`audit_logs`、`idempotency_keys`、`outbox_jobs`、`outbox_job_steps`、`feishu_mappings`。

单据表在本任务只建立跨任务稳定字段和关联，不实现完整流程命令；后续任务通过新增迁移扩展，不重写本任务已发布历史。

## Inventory Contract

```text
effectiveOnHand = confirmedFeishuQuantity + pendingMovementDelta
available = effectiveOnHand - reservedQuantity
```

核心服务暴露：

- `getAvailability(warehouseId, variantIds)`
- `reserveBatch(command, idempotencyKey)`
- `releaseReservation(command, idempotencyKey)`
- `applyMovementBatch(command, idempotencyKey)`
- `transferBatch(command, idempotencyKey)`

所有批量命令先排序库存键，在单个数据库事务中取得行锁，校验全部明细后才写入。流水为追加式；余额表只保存派生运行态，不允许控制器或其他模块直接更新。

## Seed Contract

- 仓库：`XIHU`、`YUHANG`。
- 角色：`CLAIMANT`、`WAREHOUSE_ADMIN`、`SYSTEM_ADMIN`。
- 产品：10 个 ACTIVE 指环、1 个 ACTIVE 健康腕表、3 个 `INACTIVE_HISTORICAL` 腕表。
- variant：每个指环 8 个尺码，共 80 个；每个腕表一个无尺码 variant，共 4 个，总计 84 个。
- 本任务只初始化零库存结构；真实余杭历史余额由第 7 个迁移任务写入。

## Testing

- 纯函数单测：库存计算、规格校验、幂等结果、枚举 schema。
- PostgreSQL 集成测试：行锁并发、整单回滚、预占、流水、调拨守恒、outbox 原子性、seed 可重复。
- 应用烟测：web 构建、API `/health`、worker 启动与数据库探针。

## Safety Boundary

- `.trellis/.runtime/feishu-snapshot`、环境变量、CLI 配置和任何临时导出必须被 Git 忽略。
- 本任务不读取或写入真实 Base；测试不得依赖用户授权会话。
