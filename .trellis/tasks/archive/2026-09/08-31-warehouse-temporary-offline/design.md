# 临时领用与线下登记技术设计

## 1. Design Goals

- 将临时领用和线下登记的请求、库存扣减、逐明细流水、outbox、出库记录、管理员任务和审计绑定在同一 PostgreSQL 幂等事务中。
- 复用正常领用已经验证的共享契约、仓库权限、稳定库存锁顺序和 `InventoryTransactionExecutor`，不复制另一套库存写逻辑。
- 将业务流程状态与飞书同步状态继续分离；本地已发生的出库即使尚未同步，也必须反映在可用库存中。
- 保持正常领用 API 行为兼容，同时让本人列表和详情能够统一投影三种来源。
- 首次按项目规范渐进引入 shadcn-vue，不借本任务进行无关的全站视觉重写。

## 2. Existing Reuse and Refactor Boundary

- 保留 `NormalRequestService` 的正常领用创建、重提、取消、预占和发放状态机。
- 提取当前 `normal-request-service.ts` 中的请求 include、投影、允许动作、商品明细校验、日期转换和仓库授权为 requests 包内部共享模块。
- 新增 `RequestQueryService`，统一负责本人列表、可见详情、正常管理员队列、待补手续队列和本地员工候选查询；正常领用控制器改用该查询服务，但现有 URL 不变。
- 新增 `TemporaryOfflineRequestService`，只负责临时领用、补手续、后补审核、线下登记及其事务动作。
- 复用 `InventoryTransactionExecutor.applyMovementBatchInTransaction` 创建负 `ISSUE` 流水和 outbox；临时/线下路径不得先预占再消费。

## 3. Schema and Migration

新增向前迁移 `0003_temporary_offline_requests`：

- 将 `requests.type` 从必填改为可空，允许 `EXPRESS + PENDING_PAPERWORK` 的最小记录尚未选择业务类型。
- 不修改已有正常领用数据；`ONLINE`、`OFFLINE` 以及进入后补审核后的 `EXPRESS` 均由服务层保证 `type` 非空。
- 截止时间使用现有 `admin_tasks.due_at`，不在 `requests` 重复保存同一事实。
- 一个临时领用复用一条待补手续任务：初始为 `PAPERWORK_REQUIRED`，超期时原行升级为 `PAPERWORK_OVERDUE`，补齐资料时完成；退回补正时按原 `dueAt` 重新打开。
- 现有 `fulfillments` 记录已经发生的出库执行人：临时领用为提交员工，线下登记为代录管理员。

Prisma 生成类型后，所有正常领用读取必须显式处理理论上的空类型，并以领域完整性错误阻断不合法的 `ONLINE/OFFLINE` 数据，不能用虚构默认值掩盖损坏记录。

## 4. Shared Contracts and Projection

将现有正常领用响应扩展为通用请求投影：

- 增加 `origin: ONLINE | EXPRESS | OFFLINE`。
- `type`、`purposeObject`、`finalDestination` 在待补手续阶段允许 `null`，UI 显示功能性状态文本，不伪造字段值。
- 增加 `paperworkDueAt`、`paperworkOverdue` 和来源感知的 `allowedActions`。
- `allowedActions` 保留正常领用的 `resubmit`、`cancel`、`review`、`fulfill`、`adminCancel`，并增加 `completePaperwork`；每个动作由来源、状态、本人关系和实际仓库权限共同决定。
- 新增临时创建、补手续、线下登记、待补手续队列和本地员工搜索契约。
- 本地员工候选只返回稳定用户 ID、姓名和必要头像，不暴露角色、仓库授权或飞书身份载荷。

保留现有导出名的兼容别名，逐步把 Web/API 内部调用迁移到通用 `RequestSummary`、`RequestDetail` 和 `RequestActionResponse`，避免一次无意义的大范围命名改动。

## 5. Business Calendar

新增纯日期工具和数据库日历服务：

- 输入为提交时间和工作日数量，统一按 `Asia/Shanghai` 取得提交本地日期。
- 提交日不计，从下一本地日期开始逐日判断；`WorkCalendarDay` 显式记录覆盖默认周一至周五规则。
- 第三个工作日转换为上海时区 `23:59:59.999` 的 UTC 时间保存到 `dueAt`。
- 测试覆盖周五提交、法定节假日、周末调休、跨月和上海午夜边界。
- 超期刷新是可重复执行的领域方法。管理员待补队列读取前调用该方法，后续 worker 子任务可直接复用，不改变当前计算结果。

## 6. Temporary Borrowing Transaction

`createTemporary`：

1. 校验命令、会话员工、活动仓库、无重复明细和活动商品。
2. 在库存写入前创建服务器业务单号和 `EXPRESS` 请求，`type=null`、`status=PENDING_PAPERWORK`。
3. 调用事务内库存执行器，按稳定库存键整批锁定并创建负 `ISSUE` 流水与 outbox。
4. 创建 `Fulfillment(executorId=claimantId)`、三个工作日截止任务和审计。
5. 将请求 `syncStatus` 设为 `PENDING`，返回保存后的通用详情。

状态机：

```text
create + immediate issue -> PENDING_PAPERWORK
PENDING_PAPERWORK --complete paperwork--> PENDING_APPROVAL
REJECTED ----------complete correction--> PENDING_APPROVAL
PENDING_APPROVAL ---approve-------------> COMPLETED
PENDING_APPROVAL ---reject--------------> REJECTED
```

- `completePaperwork` 只更新完整业务字段和状态，锁定仓库、领用人、明细和数量，并完成待补手续任务。
- `reviewTemporary` 复用现有审批记录；拒绝必须有意见并按原截止时间重新打开待补任务，通过时创建归还义务。
- 任一状态迁移都先锁请求行；补手续和审核禁止调用库存执行器。
- 临时领用没有取消、预占、待发放或再次发放路径。

## 7. Offline Registration Transaction

`createOffline`：

1. 校验当前账号拥有目标仓库权限。
2. 查询实际领用人是本地有效用户且拥有普通领用人基础角色；未找到时返回稳定错误。
3. 校验完整业务字段、活动商品、无重复明细和库存。
4. 创建 `OFFLINE + COMPLETED` 请求并立即调用事务内库存执行器创建负 `ISSUE` 流水与 outbox。
5. 创建 `Fulfillment(executorId=adminId)`、必要的归还义务和审计；不创建审批或预占。
6. 返回详情，其中 `claimant` 是实际领用人，`fulfillment.executor` 是代录管理员。

## 8. API Surface

员工端新增：

```text
POST /requests/temporary
PUT  /requests/:requestId/paperwork
```

管理员端新增：

```text
GET  /admin/claimants?query=<name>
GET  /admin/requests/paperwork?warehouse=<code>&state=REQUIRED|CORRECTION|OVERDUE
POST /admin/requests/offline
```

现有接口保持：

```text
GET  /requests/me
GET  /requests/:requestId
GET  /admin/requests?warehouse=<code>&status=PENDING_APPROVAL|PENDING_RELEASE
POST /admin/requests/:requestId/review
```

通用审核入口根据请求来源执行不同语义：`ONLINE` 批准时预占，`EXPRESS` 批准时只完成资料审核并创建归还义务；`OFFLINE` 不允许审核。控制器仍保持薄层，所有输入由共享 Zod 契约解析。

## 9. Frontend Flow

- 配置 Tailwind Vite 插件、`@` 别名、`components.json` 和 shadcn-vue 设计 token；仅生成本任务需要的 `Button`、`Input`、`Textarea`、`Select`、`Label`、`Badge`、`Table`、`Alert`、`Skeleton` 等最小组件。
- 提取可复用商品明细编辑器，正常、临时和线下表单共用商品选项、数量约束与库存展示，避免复制商品业务规则。
- `/w/:warehouseCode/apply/temporary` 只显示锁定仓库、当前领用人、商品明细和提交动作。
- 本人详情在 `PENDING_PAPERWORK/REJECTED + EXPRESS` 时显示补手续表单，商品明细只读。
- `/admin/requests/offline` 提供仓库、现有员工候选、完整业务字段和商品明细；服务端仍重新校验权限和库存。
- `/admin/requests` 增加待补手续、待补正和超期视图，超期使用语义红色而非装饰性强阴影或大卡片。
- 修改二维码入口时删除与操作重复的描述性文案，仅保留仓库、流程名称、可用状态和必要环境提示。

## 10. Audit and Observability

至少新增：

- `TEMPORARY_REQUEST_ISSUED`
- `TEMPORARY_REQUEST_PAPERWORK_SUBMITTED`
- `TEMPORARY_REQUEST_PAPERWORK_APPROVED`
- `TEMPORARY_REQUEST_PAPERWORK_REJECTED`
- `TEMPORARY_REQUEST_PAPERWORK_OVERDUE`
- `OFFLINE_REQUEST_RECORDED`

审计保存 actor、claimant、warehouse、request、前后状态、截止时间和必要意见，不复制完整备注或敏感飞书身份载荷。库存执行器继续写统一库存审计和 outbox。

## 11. Testing

- 合约单测覆盖最小临时命令、完整资料、来源感知投影、本地员工搜索和日期边界。
- PostgreSQL 集成覆盖整单立即出库、库存不足回滚、幂等重试/冲突、并发扣减、三个工作日、补手续锁定明细、退回补正、审核零库存副作用、线下登记双人身份和跨仓越权。
- Nest HTTP 覆盖 `401/403/404/409`、固定幂等头、本人权限、静态路由不被 `:requestId` 吞掉及稳定错误映射。
- Vue 单测覆盖最小表单、完整资料表单、来源/状态标签、服务端动作、员工选择和命令感知幂等键。
- Playwright 在 `1440x900` 和 `390x844` 验收临时立即出库、补手续、退回补正、审核通过、超期待办和线下登记，检查控制台、失败资源、文本遮挡和横向溢出。

## 12. Rollback

- Prisma 迁移只放宽 `requests.type` 的空值能力，可通过先修复所有空类型记录、再恢复非空约束回滚；禁止在有待补手续记录时直接回退约束。
- shadcn-vue/Tailwind 配置与现有 scoped CSS 并存，可按新增页面和共享组件回退，不改动无关旧页面。
- 产品代码按 contracts -> database -> API -> web 顺序回退；真实飞书尚未写入，测试数据可通过隔离数据库清理，不手工修改库存余额。
