# 正常领用审核与发放技术设计

## 1. Design Goals

- 申请工作流和库存预占/流水必须处于同一 PostgreSQL 事务，任何中间失败都不能留下半张单、部分预占或部分发放。
- 控制器保持薄层，外部输入由 `packages/contracts` 的 Zod 契约验证，业务状态机、幂等、审计和库存一致性归 `packages/database`。
- 前端只呈现服务端允许的动作，权限和状态仍由 API 重新校验。
- 本任务只创建待同步 outbox，不接入真实飞书写入。

## 2. Existing Reuse

- 复用 `Request`、`RequestItem`、`ApprovalRecord`、`Fulfillment`、`ReturnObligation`、`InventoryReservation`、`InventoryMovement`、`IdempotencyKey`、`AuditLog` 和 `OutboxJob` 现有模型。
- 复用 `InventoryService` 已验证的稳定库存键排序、`FOR UPDATE` 行锁、库存充足校验、预占释放、消费预占、逐明细流水与 outbox 规则。
- 复用 `SessionGuard`、`assertWarehouseAccess`、会话主体和现有仓库目录服务。
- 复用 `/catalog/selectable` 与 `/inventory` 作为申请表单商品和库存来源；提交时绝不信任前端库存快照。

## 3. Shared Contracts

新增 `packages/contracts/src/requests.ts`，统一维护：

- 正常领用创建/重提命令、明细、条件归还字段和非空业务文本。
- 申请摘要、申请详情、审批记录、发放记录、归还义务和允许动作投影。
- 员工列表响应、管理员队列查询与响应。
- 审核、取消、确认发放命令和动作结果。
- 新的稳定 API 错误码，例如 `REQUEST_NOT_FOUND`、`REQUEST_STATE_CONFLICT`、`REQUEST_FORBIDDEN`、`REQUEST_ITEM_UNAVAILABLE`、`INVENTORY_INSUFFICIENT` 和 `IDEMPOTENCY_CONFLICT`。

所有日期以 ISO 8601 字符串传输；预计归还日期使用 `YYYY-MM-DD`。所有写接口从 `Idempotency-Key` 请求头读取非空稳定键。

## 4. Database Services

### 4.1 Transactional inventory reuse

将当前 `InventoryService` 的事务内部库存动作提取为只接受 `Prisma.TransactionClient` 的内部执行器：

- `reserveBatchInTransaction`
- `releaseReservationInTransaction`
- `applyMovementBatchInTransaction`

原有 `InventoryService` 继续用共享幂等执行器包裹这些动作，保持既有公共接口和测试不变。新的正常领用服务在自己的幂等事务中调用同一执行器，从而把申请状态、审批/发放记录、库存和审计绑定为原子提交。

通用幂等执行器从 `InventoryService` 私有方法提取到数据库包内部模块，继续使用 advisory transaction lock、操作名和命令哈希；相同键相同命令返回已保存响应，相同键不同命令抛出冲突。

### 4.2 NormalRequestService

新增 `packages/database/src/requests/normal-request-service.ts`：

- `createAndSubmit`：校验仓库、当前用户、启用商品/规格、重复明细和提交时库存；创建主单、快照明细和审计，状态为 `PENDING_APPROVAL`。
- `resubmit`：锁定申请；只允许本人修改 `REJECTED` 的在线正常领用单；替换明细并重新校验，保留旧审批历史，状态回到 `PENDING_APPROVAL`。
- `listMine` / `getVisibleDetail`：按本人或管理员仓库范围投影详情和允许动作。
- `listAdminQueue`：只返回会话授权仓库，支持待审核/待发放状态筛选。
- `review`：锁定申请；拒绝写审批记录和审计；批准时重新加载当前商品、锁定全部库存行、整批预占并写审批记录，状态进入 `PENDING_RELEASE`。
- `cancel`：申请人可取消本人 `PENDING_APPROVAL` 或 `PENDING_RELEASE` 申请；仓库管理员或系统管理员可取消授权仓库的 `PENDING_RELEASE` 申请。若存在活动预占则整批释放；所有取消必须填写原因、写审计并进入 `CANCELLED`。
- `fulfill`：锁定申请和活动预占；生成与明细完全一致的 `ISSUE` 流水并消费预占；创建 outbox、发放记录、必要的归还义务和审计，状态进入 `COMPLETED`、同步状态进入 `PENDING`。

申请号采用服务器生成的日期前缀加稳定随机后缀，并由数据库唯一约束兜底；申请幂等键保证重试不会创建新单号。

### 4.3 State machine

```text
create/submit -> PENDING_APPROVAL
PENDING_APPROVAL --approve+reserve--> PENDING_RELEASE
PENDING_APPROVAL --reject-----------> REJECTED
REJECTED --------resubmit-----------> PENDING_APPROVAL
PENDING_APPROVAL --claimant cancel--> CANCELLED
PENDING_RELEASE --claimant/admin cancel+release--> CANCELLED
PENDING_RELEASE --fulfill+movement--> COMPLETED
```

任何未列出的迁移都返回 `REQUEST_STATE_CONFLICT`。请求行先锁定，再按 `warehouse_id + variant_id` 固定顺序锁库存行。

## 5. Validation Rules

- 所有数量为正安全整数；同一 `variantId` 在一张单中只能出现一次。
- 每个规格必须启用、所属商品必须为 `ACTIVE`，并且快照名称从数据库生成。
- 提交/重提检查当时可用库存但不预占；批准再次检查并以批准时结果为准。
- `GIFT`、`SALE` 只能 `NOT_REQUIRED`；`EXHIBIT` 只能 `BY_DATE` 且有日期；`INTERNAL` 按选择组合校验。
- 审核拒绝意见、取消原因均为必填；批准意见可选。
- 发放仅消费与申请 ID、仓库、规格和数量完全匹配的单个活动预占批次。

## 6. API Surface

员工端：

```text
POST /requests/normal
PUT  /requests/:requestId/resubmit
GET  /requests/me
GET  /requests/:requestId
POST /requests/:requestId/cancel
```

管理员端：

```text
GET  /admin/requests?warehouse=<code>&status=PENDING_APPROVAL|PENDING_RELEASE
POST /admin/requests/:requestId/review
POST /admin/requests/:requestId/cancel
POST /admin/requests/:requestId/fulfill
```

控制器从会话读取 `userId`、角色与仓库范围；服务端根据申请实际仓库再次授权，不能依赖查询参数或前端隐藏。

## 7. Frontend Flow

- `/w/:warehouseCode/apply` 保留仓库选择页并启用正常领用链接。
- `/w/:warehouseCode/apply/normal` 提供锁仓表单；商品选择复用可选目录，库存查询固定当前仓库。
- `/requests/me` 展示本人申请；`/requests/:requestId` 展示详情、退回意见、修改重提和可取消动作。
- `/admin/requests` 展示当前管理员授权仓库的待审核/待发放队列和整单操作。
- 表单业务规则集中在纯 view-model/validator 模块，组件不复制后端枚举逻辑；API 适配器解析共享契约。
- 管理员队列在提交操作后重新读取服务端状态，防止并发操作后的本地乐观状态误导。

## 8. Audit and Observability

至少写入：`NORMAL_REQUEST_SUBMITTED`、`NORMAL_REQUEST_RESUBMITTED`、`NORMAL_REQUEST_APPROVED`、`NORMAL_REQUEST_REJECTED`、`NORMAL_REQUEST_CANCELLED`、`NORMAL_REQUEST_FULFILLED`。审计包含 actor、warehouse、request、前后状态和必要原因，不记录完整备注或敏感身份载荷。

库存执行器继续写 `INVENTORY_RESERVED`、`INVENTORY_RESERVATION_RELEASED` 与 `INVENTORY_MOVEMENT_BATCH_APPLIED`，并在同一事务中完成。

## 9. Testing

- 合约单测：四类领用与归还组合、明细、日期、列表/详情和错误响应。
- PostgreSQL 集成：提交不扣库存、整单批准、库存不足回滚、并发批准、退回重提、取消释放、发放消费、混领 outbox、归还义务、幂等重试和冲突。
- Nest HTTP：会话、本人可见性、仓库越权、管理员队列、幂等头、状态冲突和错误映射。
- Vue 单测：表单条件字段、数量汇总、允许动作、API 适配器和错误状态。
- 浏览器验收：1440x900 与 390x844 下完成提交、审核、发放、退回重提、取消和越权不可见路径。

## 10. Rollback

- 数据库模型原则上无需新增迁移；若实现发现现有字段不能满足不可缺审计，先回到规划并新增向前兼容迁移，不修改既有迁移。
- 产品代码可按 contracts -> database -> API -> web 顺序回退；真实飞书未接入，因此回滚只影响本地未同步测试数据。
- 任何集成测试失败时先停止归档，不通过手工改余额修复测试数据。
