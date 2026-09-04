# 归还、调拨、盘点与提醒技术设计

## 1. Design Goals

- 为采购/其他入库、实物归还、双仓调拨和盘点建立明确业务单据，所有有效数量变化继续复用统一库存事务执行器。
- 保证多明细命令、归还累计、调拨守恒、任务去重和工作日历维护在 PostgreSQL 中可并发验证、可幂等重试、可审计。
- 将业务事实与飞书同步状态分离。本任务只创建本地 movement/outbox，真实飞书消费仍由第 7 个子任务实现。
- 将已有待补手续队列扩展为统一管理员任务中心，并由 Worker 执行可重复的归还到期扫描。
- 保持现有请求、商品和库存查询 API 兼容，前端沿用 shadcn-vue 和既有视觉规范。

## 2. Ownership and Reuse Boundary

- `packages/contracts` 拥有所有请求/响应 Zod schema、枚举和共享 TypeScript 类型。
- `packages/database/src/inventory` 拥有库存业务单据、归还、工作日历和任务领域服务；控制器不得直接调用 Prisma 修改余额。
- `InventoryTransactionExecutor` 继续负责稳定库存键锁序、逐明细 movement、余额变化、outbox 和库存审计。
- `InventoryService.transferBatch` 的锁行与守恒逻辑下沉为事务内可复用入口，使业务单据和一出一入流水处于同一幂等事务。
- `RequestQueryService` 扩展归还投影，但正常、临时和线下请求状态机不迁入库存操作服务。
- `apps/api` 只负责会话、Zod 解析、HTTP 状态映射和服务调用；`apps/worker` 只编排可重复扫描服务。

## 3. Schema and Migration

新增向前迁移 `0004_inventory_operations`。

### 3.1 Inventory movement source

`InventoryMovement.source` 当前错误复用了 `RequestOrigin`，无法准确表达管理员入库、归还、调拨、盘点和历史迁移。新增独立枚举：

```text
InventoryMovementSource
  ONLINE_REQUEST
  EXPRESS_REQUEST
  OFFLINE_REQUEST
  ADMIN_INBOUND
  ADMIN_RETURN
  ADMIN_TRANSFER
  ADMIN_STOCKTAKE
  MIGRATION
```

迁移将现有 `ONLINE`、`EXPRESS`、`OFFLINE` 分别映射为前三项。`Request.origin` 保持原枚举和兼容行为，不允许用管理员操作来源污染请求来源。

### 3.2 Inventory operation document

新增 `InventoryOperation`：

- `id`、唯一 `operationNumber`、`type=INBOUND|TRANSFER|STOCKTAKE`。
- 入库可选 `inboundType=PURCHASE|OTHER`。
- `warehouseId` 用于入库/盘点，`sourceWarehouseId` 与 `destinationWarehouseId` 用于调拨。
- `actorUserId`、`occurredAt`、必需业务原因/来源说明、可选备注、创建时间。
- 一对多 `lines` 和 `movements`。

新增 `InventoryOperationLine`：

- 关联 operation 与 variant。
- 入库/调拨保存正 `quantity`。
- 盘点保存 `systemQuantity`、`countedQuantity` 和 `difference`，零差异也保留行记录。
- 同一 operation 内 variant 唯一。

`InventoryMovement` 增加可空 `operationId` 外键。已有请求流水继续使用 `requestId`，管理员操作流水使用 `operationId`；归还流水继续通过 `ReturnRecord` 关联原请求义务。

### 3.3 Administrator task deduplication

`AdminTask` 增加可空唯一 `deduplicationKey`。已有任务保持 `null`；新扫描任务使用稳定键：

```text
return:<requestId>
departure:<claimantId>:<requestId>
```

同一请求只保留一个开放待归还任务，类型可从 `RETURN_DUE` 原行升级为 `RETURN_OVERDUE`。并发扫描依靠唯一键而非先查后写。

## 4. Shared Contracts

新增或扩展以下契约：

- `InventoryOperationType`、`InventoryInboundType`、`InventoryMovementSource`。
- 入库、调拨、盘点命令及结果，所有写命令要求 HTTP `Idempotency-Key`。
- 归还义务列表、分批归还命令、归还记录和剩余数量投影。
- 管理员任务筛选与分页前的稳定列表响应。
- 工作日历日期范围查询、upsert 和 delete 请求。
- 离职手动触发请求，原因必填且仅系统管理员可调用。

现有请求详情中的 `returnObligations` 增加：

- `returnedQuantity`、`remainingQuantity`、`status`。
- 已发生 `returns`，包含回库仓库、数量、处理人和时间。

服务端返回 `allowedActions` 或明确的处理能力，前端不得仅凭角色推断是否可归还或执行跨仓操作。

## 5. Inventory Operation Transactions

### 5.1 Inbound

`InventoryOperationsService.createInbound`：

1. 解析命令，校验操作人对目标仓有权限，商品和规格当前有效。
2. 进入数据库幂等事务，创建 `INBOUND` operation 和多条 operation lines。
3. 调用事务内 movement executor，按 variant 生成正 `INBOUND` 流水，来源为 `ADMIN_INBOUND`。
4. 将 movement 关联 operation，并写 outbox、业务审计和库存执行器审计。
5. 返回 operation、movement IDs 和最新库存投影。

入库不创建请求、审批、预占、发放或归还义务。

### 5.2 Transfer

`InventoryOperationsService.createTransfer`：

1. 校验两仓不同，操作人同时拥有两仓权限，明细为正且 variant 存在。
2. 在幂等事务中创建 `TRANSFER` operation。
3. 按两仓和 variant 稳定排序锁定所有余额，校验来源仓可用库存。
4. 每个明细创建 `TRANSFER_OUT` 与 `TRANSFER_IN`，共享 operation/transfer ID，来源为 `ADMIN_TRANSFER`。
5. 同事务更新两仓余额、创建单个 outbox 和审计。
6. 事务返回前断言每个 variant 的两仓 delta 合计为零。

调拨不使用预占，也不提供单边确认或部分到货状态。

### 5.3 Stocktake

`InventoryOperationsService.createStocktake`：

1. 校验目标仓权限、非负实盘数量、明细不重复和必填文字原因。
2. 在幂等事务中锁定全部库存余额，读取 `effectiveOnHandQuantity=confirmedFeishuQuantity+pendingMovementDelta`。预占数量不从盘点账面基准扣除。
3. 创建 `STOCKTAKE` operation 和所有 operation lines，保存锁定时账面数、实盘数与差异。
4. 正差异生成 `STOCKTAKE_GAIN`，负差异生成 `STOCKTAKE_LOSS`；零差异不调用 movement executor。
5. 非零差异统一批量执行并创建一个 outbox；全零批次只创建 operation 与审计，不创建 outbox。
6. 返回每行盘点前、实盘、差异和调整后数量。

盘点使用有效在库量而不是可领用量，现有预占保持不变；如果调整后有效在库量小于预占数量，命令拒绝，避免制造无法兑现的有效预占。

## 6. Physical Return Transaction

`ReturnService.confirmReturn` 接收同一请求下一个或多个 obligation 的本次归还数量和回库仓库：

1. 校验处理人对回库仓有权限，命令数量为正且 obligation 属于同一请求。
2. 按 obligation ID 稳定排序并 `FOR UPDATE` 锁定义务，再校验状态不是 `COMPLETED/WAIVED`。
3. 计算剩余应归还数量，任一行超量则整批失败。
4. 调用 movement executor 生成 `RETURN` 正流水，来源为 `ADMIN_RETURN`。
5. 按 movement 创建 `ReturnRecord`，累计 `returnedQuantity`，设置 `PARTIAL` 或 `COMPLETED`。
6. 当请求下所有归还义务完成时，完成该请求关联的开放 `RETURN_DUE/RETURN_OVERDUE` 任务；否则保留任务。
7. 写归还批次审计并返回更新后的请求详情。

同一幂等键重试返回第一次结果；相同键改变数量、回库仓或 obligation 时冲突。日期扫描、离职触发和任务状态都不能调用回库事务。

## 7. Work Calendar Service

扩展现有 `WorkCalendarService`：

- `listOverrides(from, to)` 返回指定日期范围的显式覆盖。
- `upsertOverride(date, isWorkingDay, description, actor)` 创建或修改唯一日期。
- `deleteOverride(date, actor)` 删除覆盖，使该日期恢复默认周历。
- 仅系统管理员入口可写，所有写操作记录 before/after 审计。
- 普通列表读取不写审计，避免页面刷新产生大量无业务价值的日志。
- 已保存到管理员任务的 `dueAt` 不重算；新临时领用继续通过现有计算器使用最新配置。

日期输入按 `YYYY-MM-DD` 解析，禁止由服务器本地时区隐式转换。测试固定 `Asia/Shanghai`。

## 8. Reminder and Task Services

新增 `AdminTaskService`：

- 在一个查询中按 principal 构造仓库可见范围。
- 支持 `status`、`type`、`severity`、`warehouse` 筛选，按严重级别、截止时间、创建时间稳定排序。
- 返回关联请求、领用人和允许动作，不暴露无权仓库记录。
- 不提供通用完成/忽略写接口；任务生命周期由对应领域动作控制。

新增 `ReturnReminderService`：

- `scanDueReturns(now)` 使用上海本地日期扫描 `DATE` 义务。
- 到期日当天创建 `RETURN_DUE + WARNING`；到期日结束后仍未完成则将同一任务升级为 `RETURN_OVERDUE + CRITICAL`。
- `triggerDeparture(claimantId, reason, actor)` 为该员工所有开放 `DEPARTURE` 义务创建红色任务并记录审计。
- 所有扫描和触发通过 `deduplicationKey`、请求/义务状态与事务锁保证重复执行无副作用。

## 9. Worker Integration

`apps/worker` 新增数据库 provider 和扫描 runner：

- 启动时先执行数据库健康检查，再运行一次归还到期扫描。
- `WORKER_RUN_ONCE=true` 时扫描完成后退出，便于部署探针和集成测试。
- 常驻模式按 `WORKER_POLL_INTERVAL_MS` 串行调度下一次扫描；前一轮未完成时不并发启动第二轮。
- 单次失败输出结构化错误并等待下一轮，不终止常驻进程。
- 本任务不消费飞书 outbox；第 7 个子任务在相同 worker 中增加独立消费者。

## 10. API Surface

管理员库存操作：

```text
POST /admin/inventory/inbound
POST /admin/inventory/transfers
POST /admin/inventory/stocktakes
```

归还与待办：

```text
GET  /admin/returns?warehouse=<code>&status=PENDING|PARTIAL|DUE|OVERDUE
POST /admin/returns/confirm
POST /admin/returns/departure-trigger
GET  /admin/tasks?warehouse=<code>&type=<type>&status=<status>&severity=<severity>
```

工作日历：

```text
GET    /admin/work-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
PUT    /admin/work-calendar/:date
DELETE /admin/work-calendar/:date
```

所有端点使用 SessionGuard。库存操作和任务读取在领域服务中按实际仓库重新授权；离职手动触发和日历写入额外要求 SystemAdminGuard。Zod 解析失败、权限不足、状态冲突、库存冲突和幂等冲突保持稳定错误结构。

## 11. Frontend Flow

新增管理路由：

```text
/admin/inventory/inbound
/admin/inventory/transfer
/admin/inventory/stocktake
/admin/returns
/admin/tasks
/admin/work-calendar
```

- 入库、调拨和盘点复用现有仓库、商品、规格和数量控件；调拨页面同时展示来源仓可用量和目标仓有效在库量。
- 盘点页面要求管理员填写实际数量，不让用户直接输入正负差额；系统实时展示账面数和计算差异，提交后由后端重新计算。
- 归还页按请求展示应归还、已归还、剩余数量和到期状态，允许本次分批数量与回库仓选择。
- 任务中心使用表格/紧凑列表展示类型、严重级别、仓库、人员、截止时间和业务动作；红色只用于真正超期。
- 工作日历提供月份/日期范围内的显式覆盖表，使用日期输入、工作日切换和删除恢复默认值。
- 导航使用 lucide 图标和功能名称。页面不加入描述性宣传文案，不嵌套卡片，不引入新主题。

## 12. Authorization, Audit and Errors

至少新增审计动作：

- `INVENTORY_INBOUND_RECORDED`
- `INVENTORY_TRANSFER_RECORDED`
- `INVENTORY_STOCKTAKE_RECORDED`
- `RETURN_PHYSICAL_RECEIPT_RECORDED`
- `RETURN_DUE_TASK_CREATED`
- `RETURN_OVERDUE_TASK_UPGRADED`
- `RETURN_DEPARTURE_TRIGGERED`
- `WORK_CALENDAR_OVERRIDE_UPSERTED`
- `WORK_CALENDAR_OVERRIDE_DELETED`

审计保存 actor、业务单号、仓库、variant、数量前后值、差异原因和状态变化；不复制会话令牌或无关飞书身份载荷。

新增稳定错误码覆盖无权仓库、无权双仓、归还超量、义务状态冲突、盘点导致预占无法兑现、日历日期冲突和管理员任务不可见。API filter 映射到 `400/403/404/409`，不暴露 Prisma 错误。

## 13. Testing and Verification

- 合约测试覆盖所有命令、筛选器、归还剩余数量和日期格式。
- PostgreSQL 集成测试覆盖多明细原子入库、分批归还/超量回滚、双仓权限与守恒、盘盈盘亏/零差异、预占约束、幂等重试/冲突和并发扫描去重。
- Nest HTTP 测试覆盖会话、角色、实际仓库授权、固定幂等头、稳定错误和静态路由顺序。
- Worker 测试覆盖 run-once、串行轮询、到期/逾期升级和失败后继续。
- Vue 测试覆盖各表单映射、服务端错误、任务筛选、分批归还和日历覆盖。
- Playwright 在 `1440x900` 与 `390x844` 验收全部六个管理页面，检查功能流程、文本遮挡、横向溢出、控制台错误、页面错误和失败请求。

## 14. Rollout and Rollback

- 迁移为新增业务表、可空 movement 外键、任务去重键和 movement source 枚举转换；部署前后运行 Prisma validate 与现有请求/库存回归测试。
- 回滚应用代码时可保留新增表和新枚举；不得删除已发生的库存业务单据或 movement。
- 如果新页面出现问题，可下线管理入口，但已提交操作仍由 movement 和 outbox 保留，不允许直接回改余额。
- 真实飞书 Base 尚未写入，因此本任务回滚不涉及远端数据逆操作。
