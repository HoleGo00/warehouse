# 飞书库存同步与历史迁移技术设计

## 1. 决策与边界

### 已确认决策

- 飞书两套现有 Base 继续作为最终库存底账，PostgreSQL 保存业务事务、待同步变动、同步状态和完整审计。
- Base 写入只通过官方 `lark-cli`，固定 profile 为 `glorychips-warehouse`；不引入另一套飞书 SDK，不升级或切换现有 profile。
- 指环、腕表分别处理，一个业务 job 拆成独立 target step；混领允许部分同步，不能误标整单完成。
- 正式切换允许旧 Base 短暂停写，使用 revision 栅栏收口最后增量，不实现长期双写或 CDC。
- 第 7 子任务创建正式 V1 表并完成影子历史迁移，绑定保持 `PREPARED`；第 9 子任务才激活生产读写映射。
- 旧表、旧字段和旧记录不删除、不重命名、不批量覆盖。测试副本和新 V1 表也不自动删除。

### 本任务不承担

- 生产部署和最终业务开放。
- 删除、清理或自动修改旧 Base 高级权限。
- 第 8 子任务的完整组合查询、Excel 导出和综合后台。
- 飞书机器人或个人消息提醒。

## 2. 总体架构

```text
local business transaction
  -> InventoryMovement + pendingMovementDelta
  -> OutboxJob + OutboxJobStep(target)
  -> worker claims job with DB lease
  -> FeishuCliGateway
       -> validate/provision V1 schema
       -> find-or-create immutable movement rows
       -> compare-and-update balance rows
       -> read back remote evidence
  -> local settlement transaction
       -> movement SYNCED
       -> pending delta -> confirmed Feishu quantity
       -> step/job/request aggregate status
       -> audit / sync-exception task
```

职责边界：

- `packages/contracts`：同步状态、查询、人工重试、对账和迁移报告的 Zod 契约。
- `packages/database`：outbox 领取、step 状态机、本地结转、对账、迁移批次和管理员查询；不直接启动进程。
- `apps/worker`：调度 outbox、对账和现有归还扫描；调用一个 Gateway 接口，不包含库存业务规则。
- `apps/api`：系统管理员同步查询和人工重试适配器。
- `apps/web`：紧凑的同步/对账管理页，只展示脱敏业务状态。
- `scripts/feishu`：schema 计划、测试副本、dry-run、影子迁移、最终增量和 cutover 检查命令；命令复用数据库服务和 Gateway，不复制领域规则。

## 3. 数据模型

新增 Prisma migration，保留现有表含义并扩展以下模型。

### `FeishuTableBinding`

每个 target 的 V1 表坐标和生命周期状态：

```text
target: RING_BASE | WATCH_BASE
kind: PRODUCT | BALANCE | MOVEMENT
environment: TEST | FORMAL
baseToken / tableId
schemaVersion / schemaFingerprint
status: PREPARED | ACTIVE | ROLLED_BACK
preparedAt / activatedAt / rolledBackAt
```

唯一约束：`environment + target + kind + schemaVersion`。同一环境和 target 只能有一组 `ACTIVE` 绑定；激活/回滚服务在事务中验证并更新整组三张表，禁止半组切换。

### `InventoryMigrationBatch`

```text
batchKey (unique)
mode: DRY_RUN | TEST | FORMAL_SHADOW | FINAL_DELTA
status: PLANNED | RUNNING | RECONCILING | SUCCEEDED | FAILED
sourceSnapshot (six table revisions/counts/hashes)
expectedSummary / actualSummary / anomalySummary
freezeConfirmedAt / startedAt / completedAt
reportPath / lastErrorCode / lastError
```

`sourceSnapshot` 是切换栅栏。`FINAL_DELTA` 只有在操作员确认停写且六张旧表 revision 与命令参数一致时才能运行。

### 现有模型扩展

- `OutboxJobStep` 增加 `lastErrorCode`、`availableAt`、`startedAt` 和脱敏 `result`，用于 target 级退避和恢复证据。
- `InventoryReconciliation` 增加 target、`confirmedFeishuQuantity`、`pendingMovementDelta`、远端记录 ID、binding/schema version、job 或 migration batch 来源和 evidence 摘要。
- `InventoryMovement` 增加源记录唯一约束或等价迁移映射约束，确保 `sourceTableId + sourceRecordId + type` 只导入一次。
- `FeishuMapping` 继续保存本地实体到远端 record ID 的映射；`localEntityType` 使用受控常量 `PRODUCT`、`BALANCE`、`MOVEMENT`、`SOURCE_LEDGER`，不接受任意 API 输入。
- `AdminTask` 使用 `sync:<jobId>:<target>` 作为同步异常去重键；同一 step 恢复成功后由同步领域服务完成对应任务。

不把 CLI profile 密钥、用户 token 或一次性授权信息写入任何模型。

## 4. V1 Base 表结构

两套 Base 使用相同字段语义，schema provisioner 创建字段后立即读取 field ID，并把规范化 schema fingerprint 保存到 binding。

### 产品资料 V1

- 稳定键（主字段）、产品 ID、正式名称、商品大类、启用状态。
- 历史别名、规格模式、主图、详情图、更新时间。
- 一行对应一个本地 Product；尺码/variant 不在产品表重复产品图片。

### 仓库库存余额 V1

- 稳定键（`warehouseId:variantId`）、仓库 ID/名称、产品 ID/名称、variant ID、可选尺码。
- 当前库存、同步版本、最后 movement ID、最后业务单号、更新时间。
- 当前库存和同步版本是可写数值字段，不使用公式或 lookup 作为系统真值。

### 库存流水 V1

- 稳定幂等键（主字段）、movement ID、业务单号、仓库、产品、variant、可选尺码。
- movement 类型、来源、数量变化、变化前/后数量、操作人快照、发生时间。
- source table/record/name、migration batch、历史顺序重建标记、payload hash。
- 流水内容一旦创建只允许一致性回读，不允许同步 worker 覆盖已存在的不同内容。

用户可见字段使用中文名称；代码在 provision 后使用真实 field ID。字段名称可用于初次定位，但运行时不靠名称猜测写入。

## 5. `FeishuCliGateway`

Gateway 使用 Node `spawn` 的参数数组调用 CLI，不经过 shell，不拼接命令字符串。允许的命令仅覆盖：

- `whoami`、`doctor`
- `base +base-copy`
- `base +table-list/+table-create/+field-list/+field-create`
- `base +record-list/+record-search/+record-batch-create/+record-upsert/+record-get`

每次调用显式设置：

```text
--profile glorychips-warehouse
--as user|bot
--format json
--base-token <configured coordinate>
--table-id <binding coordinate when needed>
```

Gateway 返回类型化结果：`success`、`retryable`、`uncertain`、`permanent`。分类规则：

- 超时、连接中断、429、5xx：`retryable`；如果请求可能已经到达远端则为 `uncertain`。
- 无权限、表/字段不存在、schema fingerprint 不一致、非法 CellValue：`permanent`。
- JSON 解析失败或 CLI 返回结构不符合版本契约：`permanent`，避免以猜测响应继续写。

进程超时先发送终止信号并等待退出；stdout/stderr 有大小上限。日志仅记录 operation、target、table kind、duration、exit code、错误分类和 trace ID，不记录 token、完整字段内容、Base token 或个人快照。

## 6. Outbox 状态机

### 领取与租约

1. 数据库事务使用 `FOR UPDATE SKIP LOCKED` 领取 `PENDING/RETRY` 且已到 `availableAt` 的 job。
2. 将 job 标为 `PROCESSING`，写入随机 worker ID、`lockedAt` 和尝试次数。
3. 超过租约的 `PROCESSING` job 可被恢复为 `RETRY`；仍有活跃租约的 job 不被第二个 worker 处理。
4. 一个 runner 串行处理 job；并发扩容仍由数据库锁保证不重复领取。

### target step 执行

1. 根据 step target 过滤 job movement，并按持有余额锁时分配的 `balanceSequence` 排序；补录的 `occurredAt` 只作历史事实展示，不得改变库存写入顺序。
2. 对每个 warehouse/variant 检查是否存在更早且未同步的 movement；存在则本 step 延后，保证远端余额顺序。
3. 确保产品记录存在且字段内容兼容。
4. 按 movement 幂等键搜索远端流水：
   - 不存在：创建并保存 mapping。
   - 已存在且 payload hash 一致：视为远端步骤已完成。
   - 已存在但内容不同：立即 `MANUAL_REVIEW`。
5. 对每个 balance key 获取远端余额并校验其数量/版本等于本地 `confirmedFeishuQuantity`；再更新为 `confirmed + 本 step delta`。
6. 回读远端流水和余额。只有记录数、hash、数量和版本全部一致，才进入本地结转。
7. 本地事务锁定 balance 和 movement，把 movement 标为 `SYNCED`，执行：

```text
confirmedFeishuQuantity += sum(delta)
pendingMovementDelta    -= sum(delta)
```

并验证有效库存总量在结转前后不变。随后完成 step、相关异常任务以及可推导的 request 汇总状态。

若远端写入后本地事务失败，重试会通过远端幂等键和 mapping 接续，不会重写流水或重复增加余额。

### 重试与人工处理

- 退避使用有上限的指数增长与抖动，时间由可注入 clock/random 计算以便测试。
- 达到配置阈值或遇到永久错误时，step/job 进入 `MANUAL_REVIEW`，创建唯一红色管理员任务。
- 人工重试写审计并将原 step 置为 `RETRY`；job、movement 和幂等键保持不变。
- 不提供“直接标记成功”“删除失败 job”或“手填远端 record ID”接口。

## 7. 同步汇总状态

- `InventoryMovement.syncStatus` 是 movement 的最终事实状态。
- `Request.syncStatus` 由关联 target steps 推导：无同步需求为 `NOT_REQUIRED`，全部成功为 `SYNCED`，有人工失败为 `FAILED`，其他为 `PENDING`。
- 管理员操作单据没有统一 syncStatus 字段时，API 从其 movement/outbox 投影同步状态，不在多个表重复持久化易漂移的汇总。
- 混领业务只有 RING 和 WATCH 两个必需 step 都成功，request 才能成为 `SYNCED`。

## 8. 对账

对账服务按 binding target、warehouse、variant 批量读取远端余额，并与下列四个值同时记录：

```text
remote quantity
local confirmedFeishuQuantity
local pendingMovementDelta
local effective quantity = confirmed + pending
```

- 远端应等于 local confirmed；local effective 用于说明仍待同步的业务差异。
- 存在待同步 job 时，remote 与 effective 的差异不是自动错误；remote 与 confirmed 不一致才是底账差异。
- 对账结果持久化为 MATCHED/MISMATCH，重复运行追加证据，不覆盖旧检查。
- `MISMATCH` 只报告和生成任务；修复必须走补偿 movement 或迁移批次。

## 9. 历史迁移

### 快照与数据保护

- 全量源快照由 CLI 输出到 `.trellis/.runtime/feishu-migration/<batch>/`，保持 gitignored。
- 任务目录只保存不含个人信息的 manifest、数量汇总、schema、异常计数和哈希报告。
- 每张表读取必须 `has_more=false`；记录 manifest 中的 revision、count、record ID hash 和字段 schema hash。

### 转换规则

- 有效历史入库/出库记录各生成一条本地 `MIGRATION` movement，并写入 V1 流水。
- 有效旧台账记录映射到 V1 balance 及 `SOURCE_LEDGER` mapping；台账只用于对账，不重复生成库存变化。
- 同一日期内使用 source table + record ID 稳定排序；若字段不足以还原严格历史顺序，标记 `historyOrderRebuilt=true`，不伪造人员、用途或精确时间。
- 当前完整历史直接重建中间数量，保留并报告旧表的真实负库存，不自动生成虚构的期初/冲回流水。只有确实缺失历史、且经独立审阅的来源报告说明差额后，才允许另行规划 `MIGRATION_OPENING`；当前工具对此类差额停止，不自动补齐。
- 全部有效历史数量归余杭仓。西湖仓所有 variant 初始余额为零。
- 10 条已知全空白零值记录进入 anomaly report，不生成业务记录；其他字段缺失的记录仍迁移并保留空值。

### 幂等

- migration key 为 `source:<baseTarget>:<tableId>:<recordId>:<semanticKind>`。
- 本地 unique constraint、FeishuMapping 和远端流水稳定键形成三层防重。
- 同一 source snapshot 复跑时，不新增 movement、remote record 或余额变化；报告明确输出 `created=0, reused=N`。

## 10. 测试副本、影子迁移与切换

### 测试副本

1. 使用 `base +base-copy --without-content` 分别创建指环、腕表隔离副本。
2. 在副本建立 V1 表，写入合成产品、流水和余额。
3. 用 fake Gateway 注入超时/崩溃，用真实副本验证不确定结果恢复和幂等复跑。
4. 副本不自动删除，报告保存 Base 名称和受控坐标的脱敏引用。

### 正式影子迁移（第 7 子任务）

1. 重新读取正式旧表 schema 和全量快照，生成 dry-run。
2. dry-run 与当前实际 revision 一致后，在正式 Base 创建三张 V1 表并标为 `PREPARED`。
3. 用户确认短暂停写窗口已开始后，重新读取六张旧表；若 revision 变化则生成新批次并失效旧报告。
4. 运行历史迁移、远端回读和全维度对账。
5. 同一批次再次运行，要求所有新增计数为零。
6. 结束停写窗口，旧表继续作为生产入口；V1 binding 保持 `PREPARED`，等待第 9 子任务最终增量。

### 最终激活（第 9 子任务）

1. 再次短暂停写旧表。
2. 按 revision 捕获从第 7 子任务后产生的最后增量。
3. 等待全部 outbox 完成并要求全量 reconciliation 为 MATCHED。
4. 在 PostgreSQL 事务中激活整组 bindings，执行 smoke test 后再开放业务。
5. 失败则保持/恢复旧 binding 并暂停 worker；不删除 V1 数据。

## 11. API 与前端

系统管理员端点：

```text
GET  /admin/sync/jobs
GET  /admin/sync/jobs/:id
POST /admin/sync/jobs/:id/retry       Idempotency-Key required
GET  /admin/sync/reconciliations
POST /admin/sync/reconciliations/run  Idempotency-Key required
GET  /admin/sync/bindings
GET  /admin/migrations
```

切换、回滚、schema 创建和历史迁移不暴露为浏览器一键操作，只由受控脚本执行。

新增 `/admin/sync` 页面，使用现有 shadcn-vue、Lucide 和设计 token：

- `任务`、`对账`、`绑定` 三个紧凑 tab。
- 支持 target/status 筛选、查看脱敏错误、刷新和幂等重试。
- 不显示 Base token、profile、CLI 命令或个人明细。
- 只保留功能性文案；无蓝紫夜间模式、米白暖橙复古 serif、大圆角、嵌套卡片或装饰阴影。

## 12. 验证和回滚

自动验证：共享契约、Gateway 单元测试、PostgreSQL 并发/租约/结转/迁移集成测试、Nest HTTP、Worker、Vue adapter/view-model、根级全量门禁。

真实验收：

- CLI doctor/whoami 和 schema dry-run。
- 两个测试副本的创建、真实写入、超时后查重、重复运行零新增。
- 正式 Base dry-run、V1 schema 回读、影子迁移、源/目标数量和记录映射零差异。
- `/admin/sync` 在 `1440x900`、`390x844` 的浏览器验收。

任何阶段失败都先暂停对应 worker。正式 binding 未激活前不影响旧生产入口；影子 V1 数据保留用于诊断和可重复修复，不做破坏性清理。
