# 归还、调拨、盘点与提醒实施计划

## Phase 0: Start Gate

- [x] 确认第 5 个子任务已经合并，`origin/main` 基线为 `e2fa62f`。
- [x] 创建并绑定 `codex/warehouse-inventory-operations` 独立 worktree。
- [x] 确认盘点文字差异原因必填，V1 不要求图片附件或通用上传链路。
- [x] 完成 PRD convergence pass 和技术设计。
- [x] 配置并校验 `implement.jsonl` 与 `check.jsonl`。
- [x] 用户审核最终规划摘要并明确批准后运行 `task.py start`。

## Phase 1: Contracts and Schema Migration

- [x] 新增库存业务单据、入库类型、movement source、归还、管理员任务和工作日历契约及测试。
- [x] 新增 `0004_inventory_operations`，创建 operation/header/line，关联 movement，并为管理员任务增加稳定去重键。
- [x] 将既有 movement source 从请求来源无损迁移到独立枚举，保持前三种请求流水语义兼容。
- [x] 扩展请求归还投影，包含应归还、已归还、剩余数量和归还记录。
- [x] 串行生成 Prisma Client、validate，并运行既有数据库类型和单元测试。

Validation:

```bash
pnpm --filter @glorychips/contracts test
pnpm --filter @glorychips/database prisma:generate
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test
```

Rollback point: movement source 转换必须覆盖全部既有值且正常、临时、线下请求回归全绿；发现无法无损转换时停止后续实现。

## Phase 2: Inventory Operation Domain

- [x] 抽取事务内 transfer 入口并保持现有 `InventoryService.transferBatch` 兼容。
- [x] 实现多明细采购/其他入库，限制活动商品并创建 operation、movement、outbox 和审计。
- [x] 实现两仓原子调拨、双仓授权、来源库存校验和逐 variant 守恒断言。
- [x] 实现盘点业务单据，以有效在库量计算差异，处理盘盈、盘亏、零差异和预占约束。
- [x] 覆盖整单回滚、并发、重复明细、安全整数、幂等重试/冲突和停用商品边界。

Validation:

```bash
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test
pnpm --filter @glorychips/database test:integration
```

Rollback point: 任何 operation、movement、余额、outbox 或审计不能处于部分成功状态；禁止用控制器补偿事务。

## Phase 3: Return, Calendar and Task Domain

- [x] 实现归还义务查询、分批实物回库、超量阻断和任务自动完成。
- [x] 实现指定日期到期/逾期扫描，并使用唯一任务键保证并发和重复扫描幂等。
- [x] 实现离职本地触发服务及系统管理员手动兜底，确保只建任务不回库。
- [x] 扩展工作日历查询、upsert、delete 和审计；保持已保存期限不变。
- [x] 实现统一管理员任务查询和仓库授权过滤，不提供通用完成按钮。
- [x] 覆盖部分归还、跨仓回库、并发归还、日期边界、跨长假、跨年和任务可见性。

Validation:

```bash
pnpm --filter @glorychips/database test
pnpm --filter @glorychips/database test:integration
```

Rollback point: 日期或离职触发路径的数据库写集合只能包含任务和审计，不得出现 inventory movement、return record 或余额变化。

## Phase 4: Worker and API

- [x] 将 ReturnReminderService 注册到 Worker，启动即扫描，常驻模式串行轮询，run-once 正常退出。
- [x] 新增入库、调拨、盘点控制器和 provider token。
- [x] 新增归还列表/确认、管理员任务中心和离职手动触发 API。
- [x] 新增工作日历读取与系统管理员写 API。
- [x] 扩展稳定错误映射，确保所有端点解析共享 Zod 契约并重新校验实际仓库。
- [x] 添加 Nest HTTP 与 Worker 测试，覆盖 `401/403/404/409`、幂等头、双仓越权和任务过滤。

Validation:

```bash
pnpm --filter @glorychips/api typecheck
pnpm --filter @glorychips/api test
pnpm --filter @glorychips/worker typecheck
pnpm --filter @glorychips/worker test
```

## Phase 5: Frontend Operations

- [x] 扩展管理导航，使用 lucide 图标增加库存操作、归还、任务和系统管理员日历入口。
- [x] 实现入库表单，支持单仓多明细、入库类型、发生时间和来源说明。
- [x] 实现双仓调拨表单，展示来源可用量与目标有效在库量。
- [x] 实现盘点表单，输入实际数量并实时显示账面数和差异，文字原因必填。
- [x] 实现分批归还页面和请求详情归还投影。
- [x] 实现统一管理员任务中心及工作日历后台。
- [x] 所有新页面使用 shadcn-vue 组件和项目 token，补齐加载、错误、空状态和防重复提交。

Validation:

```bash
pnpm --filter @glorychips/web test
pnpm --filter @glorychips/web typecheck
pnpm --filter @glorychips/web build
```

## Phase 6: Full Gate and Visual QA

- [x] 串行运行 Prisma generate/validate，避免生成目录竞争。
- [x] 运行根级 lint、typecheck、test、integration、build、format check 和 `git diff --check`。
- [x] 使用 PostgreSQL 覆盖入库、分批归还、调拨守恒、盘点和提醒扫描真实事务。
- [x] 启动可控 API/Web/Worker，使用 Playwright 在 `1440x900` 与 `390x844` 验收六个管理页面。
- [x] 检查无蓝紫夜间模式、米白暖橙复古 serif、大圆角卡片、嵌套卡片、无目的边框或阴影。
- [x] 检查无描述性宣传文案、文本遮挡、文档级横向溢出、控制台错误、页面错误或失败资源。
- [x] 运行独立 Trellis check，修复发现后重跑受影响门槛。

Full validation:

```bash
pnpm db:generate
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm format:check
git diff --check
```

## Phase 7: Delivery

- [x] 更新 backend/frontend Trellis spec，固化库存业务、归还、任务扫描、日历和 UI 契约。
- [x] 检查工作树，只提交本任务文件，不纳入主工作树中的飞书真实登录延期改动。
- [ ] 提交功能实现与规格更新，运行 Trellis archive 和 record-session。
- [ ] 推送 `codex/warehouse-inventory-operations`，创建并合并 PR。
- [x] 更新 Epic `task-map.md`：前六项完成，下一项为 `08-31-warehouse-feishu-sync-migration`。
- [ ] 合并后验证 PR 为 `MERGED`、`origin/main` 包含全部提交、所有本地分支 `ahead=0`，再移除临时 worktree。
