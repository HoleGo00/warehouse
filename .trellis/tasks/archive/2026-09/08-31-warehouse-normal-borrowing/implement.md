# 正常领用审核与发放实施计划

## Phase 0: Start Gate

- [x] 确认申请人可在发放前自行取消，授权管理员可取消待发放单，所有取消必须填写原因；完成 PRD convergence pass。
- [x] 配置并校验 `implement.jsonl` 与 `check.jsonl`。
- [x] 从当前已完成商品/库存任务的 HEAD 创建并绑定 `codex/warehouse-normal-borrowing`。
- [x] 用户审核最终规划摘要并明确批准后运行 `task.py start`。

## Phase 1: Contracts and Transaction Foundation

- [x] 新增正常领用共享枚举、命令、列表/详情、动作结果与错误码契约及测试。
- [x] 提取通用数据库幂等执行器，保持现有库存服务返回和重试行为兼容。
- [x] 提取可复用的事务内库存预占、释放和流水执行器；原库存服务测试必须继续通过。
- [x] 复用现有 Prisma 模型，无需新增迁移；schema/seed 验证通过。

Validation:

```bash
pnpm --filter @glorychips/contracts test
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
```

Rollback point: 保留原 `InventoryService` 公共 API；若提取导致既有集成行为漂移，先恢复内部封装再继续请求工作流。

## Phase 2: Normal Request Domain

- [x] 实现创建提交、本人列表/详情、退回修改重提及服务器申请号。
- [x] 实现整单审核：请求行锁、商品复核、固定顺序库存锁、批准预占、拒绝记录和原子审计。
- [x] 按最终策略实现取消，确保活动预占整批释放。
- [x] 实现确认发放：完整消费预占、`ISSUE` 流水、outbox、发放记录、归还义务、同步状态和审计。
- [x] 覆盖状态机非法迁移、幂等键参数冲突、并发批准/取消/发放竞争和跨仓越权。

Validation:

```bash
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test:integration
```

Rollback point: 任何非原子行为均阻断后续 API；不得以补偿式控制器调用替代同一事务。

## Phase 3: API

- [x] 注册请求领域服务、控制器和依赖 token。
- [x] 实现员工提交/重提/列表/详情/取消接口。
- [x] 实现管理员队列/审核/取消/发放接口，按申请实际仓库重新授权。
- [x] 扩展全局异常过滤器并保持稳定 API 错误格式。
- [x] 增加 Nest HTTP 测试，覆盖 `401`、`403`、`404`、`409`、幂等头和成功路径。

Validation:

```bash
pnpm --filter @glorychips/api typecheck
pnpm --filter @glorychips/api test
```

## Phase 4: Web

- [x] 新增 requests API adapter、表单 view-model/composable 和对应单元测试。
- [x] 启用仓库入口页正常领用链接并实现锁仓申请表单。
- [x] 实现本人申请列表、详情、退回修改重提和取消动作。
- [x] 实现管理员待审核/待发放队列、整单详情、批准、退回、取消与发放。
- [x] 更新导航与路由；按会话角色/仓库范围显示入口，API 保持最终授权。
- [x] 实现可访问标签、长文本换行、加载/错误/空状态和响应式约束；视觉验收留在 Phase 5。

Validation:

```bash
pnpm --filter @glorychips/web test
pnpm --filter @glorychips/web typecheck
pnpm --filter @glorychips/web build
```

## Phase 5: Full Gate and Visual QA

- [x] 串行运行 Prisma generate/validate，避免并发生成目录冲突。
- [x] 运行 root lint、typecheck、test、build 和 `git diff --check`。
- [x] 启动 PostgreSQL 并执行正常领用 PostgreSQL 集成测试。
- [x] 使用可控 API 响应启动 Web，完成浏览器主流程与视觉验收；真实飞书登录/API 联调保留为生产环境边界。
- [x] 使用 Playwright 在 1440x900 和 390x844 验收提交、退回重提、批准预占、取消释放、发放、越权和错误状态。
- [x] 核对页面无横向溢出、控制台错误、失败资源和文本遮挡。
- [x] 更新相关 backend/frontend Trellis spec，记录新工作流契约和回归保护。

Full validation:

```bash
pnpm db:generate
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## Phase 6: Delivery

- [x] 检查工作树，只提交本任务文件，不纳入 `08-31-warehouse-feishu-auth-live-fix` 的现有未提交改动。
- [ ] 提交产品实现和规格更新。
- [ ] 运行 Trellis archive/record-session 流程并提交任务归档与 journal。
- [x] 更新 Epic `task-map.md`：前四项完成，下一项为 `08-31-warehouse-temporary-offline`。
