# 临时领用与线下登记实施计划

## Phase 0: Start Gate

- [x] 确认 V1 线下登记只选择已经登录并建立本地档案的有效员工。
- [x] 完成 PRD convergence pass、技术设计和实施计划。
- [x] 创建并绑定 `codex/warehouse-temporary-offline`，基线为已合并前端设计规范后的 `main`。
- [x] 配置并校验 `implement.jsonl` 与 `check.jsonl`。
- [x] 用户审核最终规划摘要并明确批准后运行 `task.py start`。

## Phase 1: Contracts, Schema, and Shared Request Projection

- [x] 扩展通用请求来源、可空补手续字段、来源感知允许动作、截止时间、队列和本地员工候选契约及测试。
- [x] 新增 Prisma 向前迁移，将 `requests.type` 改为可空，并验证已有正常领用数据不受影响。
- [x] 提取请求 include、投影、商品校验、仓库授权和日期转换共享模块；保持正常领用接口行为兼容。
- [x] 新增 `RequestQueryService`，统一本人列表、详情、管理员队列和员工候选读取。

Validation:

```bash
pnpm --filter @glorychips/contracts test
pnpm --filter @glorychips/database prisma:generate
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test
```

Rollback point: 正常领用合约、URL、状态机和库存行为必须保持原回归测试全绿；发现破坏性投影变更时先补兼容层。

## Phase 2: Calendar and Temporary/Offline Domain

- [x] 实现上海时区工作日计算，支持周历默认值和 `WorkCalendarDay` 节假日/调休覆盖。
- [x] 实现临时领用最小提交、整单立即出库、outbox、fulfillment、待补任务和审计。
- [x] 实现补手续/补正，锁定已出库明细并完成或重新打开原待补任务。
- [x] 实现来源感知的一道审核，确保临时审核只改流程和归还义务，不再次改变库存。
- [x] 实现线下完整登记、本地有效员工校验、管理员双人身份记录和直接整单出库。
- [x] 覆盖并发、幂等、库存不足、事务回滚、跨仓越权和非法状态迁移。

Validation:

```bash
pnpm --filter @glorychips/database typecheck
pnpm --filter @glorychips/database test:integration
```

Rollback point: 任一请求、流水、outbox、任务或审计非原子写入都阻断 API 实施；不得用控制器补偿调用修补事务边界。

## Phase 3: API

- [x] 注册查询服务和临时/线下领域服务，保持控制器只做输入解析与会话转发。
- [x] 新增临时提交和本人补手续接口。
- [x] 新增本地员工候选、待补手续队列和线下登记管理员接口。
- [x] 将现有审核入口扩展为来源感知行为，并保持正常领用审核回归兼容。
- [x] 扩展稳定错误映射和 Nest HTTP 测试，覆盖会话、仓库权限、本人权限、幂等、静态路由和冲突。

Validation:

```bash
pnpm --filter @glorychips/api typecheck
pnpm --filter @glorychips/api test
```

## Phase 4: shadcn-vue Foundation and Web Flows

- [x] 配置 Tailwind、Vite 插件、`@` 别名、`components.json`、共享工具和项目设计 token。
- [x] 生成并收敛本任务所需的最小 shadcn-vue 组件，圆角、颜色、边框和阴影符合设计规范。
- [x] 提取共享商品明细编辑器，并保持正常领用现有行为和测试不回退。
- [x] 启用二维码临时入口并实现锁仓最小临时领用页面。
- [x] 扩展本人列表/详情，展示来源、截止时间、超期状态、补手续和补正流程。
- [x] 扩展管理员页面，加入待补/补正/超期队列、来源感知审核和线下登记入口。
- [x] 实现本地员工搜索选择、加载/错误/空状态、稳定幂等重试和响应式布局。

Validation:

```bash
pnpm --filter @glorychips/web test
pnpm --filter @glorychips/web typecheck
pnpm --filter @glorychips/web build
```

## Phase 5: Full Gate and Visual QA

- [x] 串行运行 Prisma generate/validate，避免生成目录竞争。
- [x] 运行根级 lint、typecheck、test、build 和 `git diff --check`。
- [x] 启动 PostgreSQL 并运行正常领用及临时/线下 PostgreSQL 集成测试。
- [x] 启动可控 API/Web，使用 Playwright 在 `1440x900` 与 `390x844` 完成全部主流程。
- [x] 核对无蓝紫夜间模式、Claude 米白暖橙复古 serif 风格、大圆角/嵌套卡片、无目的边框或滥用阴影。
- [x] 核对无描述性宣传文案、文本遮挡、文档级横向溢出、控制台错误、页面错误或失败资源。
- [x] 运行独立 Trellis check，修复发现后重跑受影响门槛。

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

Independent check on 2026-09-04:

- Removed the fixed work-calendar look-ahead limit and verified long configured holiday ranges.
- Required exactly one paperwork task in the expected state for projection, paperwork submission, and review; retained claimant ID and the original deadline in paperwork/overdue audits.
- Added missing authorization, idempotency-conflict, zero-second-mutation, overdue-task, and mutation-header coverage.
- Migrated the modified standard controls to shadcn-vue, exposed rejected temporary requests as `待补正` with the review comment, removed redundant descriptive eyebrow copy, and aligned ESLint formatting rules with Prettier.
- Root Prisma validate, lint, typecheck, unit/HTTP tests (18 files, 84 tests), build, Prettier check, and `git diff --check` passed. PostgreSQL integration passed 5 files and 27 tests.
- Controlled Playwright QA produced 8 screenshots across `1440x900` and `390x844`; document overflow, console errors, page errors, and failed requests were all zero, followed by manual screenshot review.

## Phase 6: Delivery

- [x] 更新 backend/frontend Trellis spec，固化临时/线下事务、工作日和 UI 契约。
- [x] 检查工作树，只提交本任务文件，不纳入主工作树中的飞书真实登录延期改动。
- [ ] 提交实现和规格更新，推送分支并创建 PR。
- [ ] PR 合并后运行 Trellis archive/record-session 流程并提交任务归档与 journal。
- [x] 更新 Epic `task-map.md`：前五项完成，下一项为 `08-31-warehouse-inventory-operations`。
