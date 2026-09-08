# 飞书库存同步与历史迁移实施计划

## Phase 0: Start Gate

- [x] 确认前六个业务子任务已合并，基线为 `origin/main@42a7d40`。
- [x] 创建 `codex/warehouse-feishu-sync-migration` 独立 worktree，并绑定 task branch/scope。
- [x] 使用 `lark-cli` 重新只读核验六张旧表，确认指环出库已增至 547 条、当前总记录 715 条。
- [x] 更新实时基线：指环 2,984 入 / 866 出 / 2,118 余额；腕表 326 入 / 61 出 / 265 余额。
- [x] 用户确认方案 A：正式切换允许旧 Base 短暂停写，采用 revision 冻结和最终增量收口。
- [x] 完成 PRD convergence pass 和技术设计。
- [x] 配置 `implement.jsonl` 与 `check.jsonl` 的真实 spec/research 上下文。
- [x] 用户审核最终规划摘要并明确批准后，运行 `task.py start`；批准前不得实现代码或写入飞书。

### 2026-09-05 Initial Execution Checkpoint

- 用户新增约束：后续禁止创建或调用子代理。已停止三个已启动的代理并保留其改动；项目 `AGENTS.md` 已追加单代理规则，后续实施与检查均在当前任务内执行。
- 已实现初稿：同步共享契约、增量数据库 migration、事务级 movement sequence、binding、outbox 领取/结转/恢复、受控 CLI Gateway、V1 schema planner/provisioner、Worker 配置及串行调度器。
- Worker 新调度器尚未接入启动入口；管理员 API/UI、完整迁移编排、实时 schema 校验及其余验收仍待完成。不得将本检查点当作第 7 子任务完成。
- 已核验：Prisma generate、migration deploy、全仓 lint、各包 typecheck、121 项单元/HTTP 测试、5 项新增同步 PostgreSQL 集成测试。
- 集成测试修复了 JSONB 键顺序造成的 binding 复跑误报；测试覆盖净 pending 为零、远端成功后本地回滚、未知写入结果不盲目重发、重复结转和过期 worker 拦截。
- 本次飞书操作仅为只读 CLI 帮助、身份和旧表结构/记录格式核验；未创建测试 Base 或正式 V1 表，未写入飞书记录。
- 正式影子迁移仍需到达 Phase 8 时再次取得“旧表当前已经停写”的当次确认。

### 2026-09-05 Continuation Checkpoint

- 本轮始终由主代理串行实施、检查；未创建或调用子代理/独立任务。
- Worker 启动接线、管理员 API、`/admin/sync` 页面及 adapter/composable/HTTP/契约/启动接线测试已完成。
- 修复生成 Tabs 的未定义 CSS 别名；弹窗使用受限圆角/阴影。Button 的生成器变动经确认只是换行符，已消除该无关差异。
- 权限撤销会同步清空页面数据并忽略晚到响应；重复提交被阻止，不确定失败的相同操作复用幂等键。
- 新库存流水和调拨流水在创建事务内保存产品正式名称及操作人快照；新增 `0006` migration，不改写已有历史快照。
- 对同一远端稳定键，未决产品写入意图阻断后续产品修订；混领 job 在仍有可自动重试 target 时继续处理该 target。
- 对账覆盖缺失、重复、额外记录和序列漂移；缺失或无法唯一确认的远端数量及差额使用 null，由 `0007` 增量 migration 支持。
- 同步集成测试使用每次独立创建并清理的本地测试数据库，避免污染持久绑定；未删除或覆盖旧 Base 或业务表。
- 本地已运行 140 项单元/HTTP 测试、全仓 typecheck/build 和 45 项 PostgreSQL 集成测试；最终结果及新增修正后的重跑证据见 `research/local-implementation-2026-09-05.md`。
- 已使用模拟 API 数据检查 `1440x900`、`390x844`：任务、对账、绑定、详情、重试、空状态、越权，页面无横向溢出或 console/page 错误。真实 OAuth 和飞书写入尚未验收。
- Phase 6 完整历史迁移工具、Phase 7 隔离 Base、Phase 8 正式 dry-run/影子迁移仍未完成，不得归档、推送合并或进入第 8 项。

## Phase 1: Contracts and Database Migration

- [x] 新增同步 job/detail、人工重试、binding、对账、迁移批次和结构化报告的共享 Zod 契约及稳定 API 错误。
- [x] 扩展 worker 环境：CLI 可执行文件、profile、identity、target Base、安全超时、租约、退避和最大尝试次数。
- [x] 新增 Prisma migration：table binding、migration batch、step 级错误/退避、扩展 reconciliation 和迁移防重约束。
- [x] 保持已有 movement/outbox/request 数据兼容；migration deploy 不得改写旧业务行或清空 pending delta。
- [x] 覆盖契约边界、环境脱敏、重复 schema/binding、非法状态转换和 migration key 防重。

Validation:

```bash
pnpm --filter @glorychips/contracts test
pnpm --filter @glorychips/config test
pnpm --filter @glorychips/database prisma:generate
pnpm --filter @glorychips/database exec prisma validate --config prisma.config.ts
pnpm --filter @glorychips/database typecheck
pnpm exec vitest run --config vitest.config.ts packages/database/src
```

Rollback point: migration 只允许增量建表/字段/索引；发现已有数据无法无损兼容时停止，不进入 CLI 或正式 Base 写入。

## Phase 2: CLI Gateway and Schema Provisioner

- [x] 定义 `FeishuBaseGateway` 接口和 fake 实现，业务层不依赖进程细节。
- [x] 实现基于 `spawn(args[])` 的 `LarkCliGateway`，包括超时、输出上限、JSON 版本契约、错误分类和脱敏日志。
- [x] 为 `whoami`、table/field list/create、record search/create/update/get 和 Base copy 建立 allowlist 参数构造器；`doctor` 仅作为人工诊断命令，不进入运行时调用。
- [x] 实现 V1 三表 schema planner/provisioner/fingerprint，固定中文字段语义并保存真实 field ID/binding。
- [x] 同名同结构复用；同名异结构、只读公式字段或 field type 漂移进入配置错误，不静默补猜字段。
- [x] 单元测试覆盖参数注入、shell 字符不可执行、timeout kill、stdout/stderr 截断、JSON 漂移、敏感信息脱敏和所有错误类别。

Validation:

```bash
pnpm exec vitest run --config vitest.config.ts apps/worker/src
pnpm --filter @glorychips/worker typecheck
lark-cli doctor --profile glorychips-warehouse
lark-cli whoami --profile glorychips-warehouse
```

Rollback point: Gateway 只在 fake/dry-run 环境工作；真实 schema 写入前必须完成 Phase 1-2 自动测试。

## Phase 3: Outbox State Machine and Local Settlement

- [x] 实现 `SKIP LOCKED` job claim、worker lease、过期 PROCESSING 恢复、target step 退避和随机 worker ID。
- [x] 实现 per warehouse/variant head-of-line 检查，阻止后续 movement 越过更早未同步 movement 更新远端余额。
- [x] 实现产品 find-or-create、movement find-or-create + payload hash 校验、balance 前置值/版本校验和远端回读。
- [x] 实现本地 settlement 事务：锁 balance/movement，movement -> SYNCED，pending delta 原子转 confirmed，保持 effective quantity 不变。
- [x] 实现混领 target step 汇总和 Request `PENDING/SYNCED/FAILED` 推导；管理员 operation 从 movement/job 投影状态。
- [x] 实现 RETRY/MANUAL_REVIEW、同步异常管理员任务和恢复后自动完成；人工重试只能复活原 step。
- [x] PostgreSQL 集成测试覆盖并发领取、租约恢复、远端成功/本地失败接续、乱序阻断、混领部分成功、人工重试和双重结转防护。

Validation:

```bash
pnpm exec vitest run --config vitest.config.ts packages/database/src
pnpm test:integration
```

Rollback point: 任一失败不得改变 movement/pending/confirmed 的总和；发现重复结转或远端内容冲突必须进入 MANUAL_REVIEW，禁止自动补偿。

## Phase 4: Reconciliation and Worker Scheduling

- [x] 实现 target/warehouse/variant 对账，记录 remote、confirmed、pending 和 effective 四值及 binding/schema 证据。
- [x] 远端与 confirmed 不一致时创建唯一同步异常任务；存在正常 pending 时不把 remote 与 effective 的暂时差异误报为底账冲突。
- [x] 扩展 Worker 同时调度 outbox、定期对账和现有归还扫描，启动任务串行、定时循环不重叠。
- [x] `WORKER_RUN_ONCE=true` 完整执行启用的 runner 后关闭数据库；一个 runner 失败不阻止未来轮询和其他 runner。
- [x] 覆盖调度次序、失败隔离、shutdown、租约回收和重复对账证据。

Validation:

```bash
pnpm exec vitest run --config vitest.config.ts apps/worker/src
pnpm --filter @glorychips/worker typecheck
pnpm test:integration
```

Rollback point: Worker 在未配置正式 binding 时必须保持同步禁用或拒绝生产启动，不得回退到硬编码表 ID。

## Phase 5: Administrator API and UI

- [x] 新增系统管理员 jobs/detail/retry、reconciliation list/run、binding list 和 migration list API。
- [x] 所有 mutation 要求 `Idempotency-Key`，共享契约解析，错误使用稳定 code；仓库管理员和普通用户一律 403。
- [x] 新增 `/admin/sync` 和认证 return path，使用 `任务/对账/绑定` tabs、target/status filters、刷新、详情和幂等重试。
- [x] 管理页隐藏 Base token、profile、CLI 命令、个人数据和原始堆栈，只显示脱敏错误和业务状态。
- [x] 使用现有 shadcn-vue、Lucide 和项目 token；只写功能性文本，禁止蓝紫夜间模式、Claude 风格、大圆角、嵌套卡片和装饰阴影。
- [x] 覆盖全部新端点 adapter、状态映射、重复点击、错误/空/加载状态和越权测试。

Validation:

```bash
pnpm --filter @glorychips/api test
pnpm --filter @glorychips/api typecheck
pnpm --filter @glorychips/web test
pnpm --filter @glorychips/web typecheck
pnpm --filter @glorychips/web build
```

## Phase 6: Migration Tooling and Dry-run

- [x] 实现只读 snapshot 命令：六张旧表全量分页、has_more/revision/count/schema/record ID hash 和脱敏 summary。
- [x] 完成旧记录转换：指环别名、腕表历史停用产品、余杭仓归属、空白零值异常、缺失字段保留和稳定排序。
- [x] 实现 migration batch plan/apply/reconcile/resume；source record 三层防重，旧台账只做 balance provenance 和对账。
- [x] 实现 test/formal binding、schema plan/provision 和 report 输出；完整源快照只写 `.trellis/.runtime`，可提交报告不得包含 PII。
- [x] 实现 `FINAL_DELTA` revision 栅栏和 cutover-check 命令；未确认停写、revision 不符、待同步 job 未清零或 mismatch 非零时拒绝继续。
- [x] 使用固定 fixture 和当前脱敏快照覆盖 715 条当前基线、10 条空白零值、24 条新指环出库以及同批复跑零新增。

Validation:

```bash
pnpm test:integration
pnpm exec vitest run --config vitest.config.ts apps/worker/src
pnpm exec vitest run --config vitest.config.ts packages/database/src/sync/migration-plan.test.ts
pnpm feishu:migration -- plan --batch readonly-YYYYMMDD
```

Rollback point: dry-run 只读；报告与任一实时 revision 不一致时自动失效，不创建正式 V1 表。

## Phase 7: Isolated Test Base Acceptance

- [x] 调用 `base +base-copy --without-content` 创建指环和腕表隔离测试副本，记录副本坐标但不删除源或副本。
- [x] 在副本 provision 产品、余额和流水 V1 表，并回读 schema fingerprint。
- [x] 写入合成 product/movement/balance，验证正常同步、混领两 target、写入后回执中断查重、新 Worker 实例恢复、人工重试和 reconciliation。
- [x] 对同一测试批次复跑，要求远端新增零记录、余额零变化、mapping 不重复。
- [x] 生成测试 Base 验收报告；真实查询延迟问题已修复并从保留的原 job 恢复，未重建副本或清除证据。

Operator gate: 测试副本创建属于外部非破坏性写入，只有最终规划获得用户实施批准后执行；不自动删除副本。

## Phase 8: Formal V1 Shadow Migration

- [x] 重新运行正式 Base dry-run，列出 schema 变化、当前六表 revision、有效/异常记录数、预期数量和批次数。
- [x] 测试 Base 报告与正式 dry-run 均通过后，在正式两套 Base 创建 V1 三表并保存 `PREPARED` bindings。
- [x] 在执行影子历史迁移前暂停，向用户确认“旧表当前已经停写”；未收到当次确认不得继续。
- [x] 停写确认后重新抓取最终快照；任一 revision 相比批准报告变化则新建批次并重新计算，不沿用旧数量常量。
- [x] 创建/复用本地 migration movement，通过 outbox 写入正式 V1 流水/余额，回读所有 mapping 和数量。
- [x] 按 Base、产品、variant/尺码和仓库对账，要求全部 MATCHED；再次执行同批，要求所有 created/quantity delta 为零。
- [x] 输出正式迁移报告并结束本次停写窗口；bindings 保持 `PREPARED`，旧表仍为生产入口，等待第 9 子任务最终增量和激活。

Operator gate: 这一阶段会创建正式 Base V1 表并写入影子数据。任何删除、旧表权限变更或 binding 激活均不执行。

2026-09-05 checkpoint: 正式六张 V1 表已创建并幂等复核，全部为空；独立本地
`warehouse_feishu_shadow` 已准备标准目录和零余额。尚未得到当次停写确认，禁止
继续历史导入。详见 `research/migration-tooling-acceptance-2026-09-05.md`。

## Phase 9: Full Gate and Visual QA

- [x] 串行运行 Prisma generate/validate，完成 lint、typecheck、unit/HTTP、PostgreSQL integration、build、format check 和 `git diff --check`。
- [x] 在当前任务内执行 Trellis check 的全部检查项，不调用检查子代理；重点检查外部不确定结果、锁/租约、head-of-line、敏感信息、迁移防重和 revision 栅栏。
- [x] 修复后重跑所有受影响门禁；最终一次 check 必须覆盖全部变更，不只覆盖最后修复。
- [x] 在 `1440x900` 与 `390x844` 验收真实 Web 的 `/admin/sync`，API 使用受控模拟；真实 HTTP/Worker 行为由独立自动化与原生迁移验收覆盖，不冒充生产 OAuth 联调。
- [x] 浏览器验收检查加载、空、部分成功、人工处理、长错误、重复重试、权限和横向溢出；console/page/request errors 为零。
- [x] 回读正式 V1 schema、migration report 和 reconciliation report，确认旧表结构、记录数和 revision 未被任务写操作破坏。

2026-09-08 checkpoint: 停写窗口 `17:14:28` 至 `18:23:44+08:00`，798 条源记录的
正式影子迁移、零差异对账和同批复跑已通过。161 项 unit/HTTP、57 项 PostgreSQL、
全包 typecheck、lint、build、Prisma validate 和 format check 已通过。模拟 API 的
桌面/移动浏览器复核已执行并逐张检查八张截图；不代表生产 OAuth 验收。
迁移测试样例已复制到包内固定目录并核对内容一致，避免任务归档破坏测试路径。

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

## Phase 10: Delivery

- [x] 更新 backend/frontend Trellis spec，固化 CLI Gateway、outbox settlement、reconciliation、migration revision 栅栏和同步 UI 契约。
- [x] 检查独立 worktree，只提交第 7 子任务文件，不接触主工作树的飞书登录延期改动。
- [x] 用户批准两批本地工作提交、归档和日志；功能、迁移工具与测试已提交为 `4c99e99`，任务/spec 文档已提交为 `254c9d3`。
- [x] 运行 Trellis archive；归档后 35 个测试文件、161 项测试全部通过，排除文件保持未提交，当前任务指针已清空。
- [ ] 推送 `codex/warehouse-feishu-sync-migration`，创建并合并 PR。
- [ ] 更新 Epic `task-map.md`：前七项完成，下一项为 `08-31-warehouse-query-export-admin`。
- [ ] 合并后验证 PR `MERGED`、`origin/main` 包含全部提交、所有本地分支 `ahead=0`，再移除临时 worktree。
- [ ] 仅在上述全部证据完成后汇报第 8 项规划入口；不得提前实施，不得创建或调用子代理、子任务或独立 Codex 任务。

2026-09-08 本次授权仅覆盖本地提交、归档与日志。上述推送、PR 合并、临时
worktree 移除和第 8 项启动均保留为独立后续关口，不因本地任务归档而视为完成。
归档后测试日志为 `.trellis/.runtime/post-archive-unit-20260908.log`；会话日志
通过 `add_session.py` 单独记录，以 `.trellis/workspace/holego/` 中对应记录为准。
