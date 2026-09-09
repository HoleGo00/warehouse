# 第 8 项技术设计

## 1. 状态和边界

本设计已于 2026-09-09 获用户批准。基于 `main@53a27c4`，由当前代理串行实施和检查，不调用子代理。实际落地与验证差异记录在 `research/implementation-evidence-2026-09-09.md`。
只增加本地查询、导出及人员管理能力；不改变飞书目标、库存算法和登录方式。
业务依据以本任务 `prd.md` 为准；Epic 中早期 Element Plus 选型已由当前前端规格的 shadcn-vue 取代，不引入第二套组件库。

## 2. 模块和接口

沿用 contracts -> database domain -> Nest API / worker -> Vue 的结构。

| 层 | 计划变更 | 约束 |
| --- | --- | --- |
| contracts | `request-report.ts`、`request-export.ts`、人员查询契约及稳定错误码 | 输入、响应、日期、范围统一 Zod 校验 |
| database | `reports/` 查询构造、投影、导出任务及权限读取 | 参数化查询，分批读取，不写库存业务表 |
| API | `/admin/reports/requests`、`/admin/exports`、人员查询 | 服务端权限、幂等、流式下载 |
| worker | 独立 `export-main.ts`、`exports/` 生成器和文件清理 | 独立进程，不阻塞现有串行 outbox/reminder 调度 |
| web | 查询/导出和人员权限两个功能模块 | 复用现有详情、导航和 UI 基础组件 |
| config | 导出目录、容量、租约及并发配置 | API 与 exporter 共享目录，启动时失败明确 |

计划端点：

```text
GET  /admin/reports/requests
GET  /admin/reports/claimants
GET  /requests/:requestId/movements
POST /admin/exports
GET  /admin/exports
GET  /admin/exports/:id
GET  /admin/exports/:id/download
GET  /access/users
PUT  /access/users/:userId       (复用已有接口)
```

保留 `/admin/requests` 审核队列语义；不把所有历史业务塞入旧队列或破坏老响应。
新增流水接口遵守既有本人/授权管理员详情可见性；导出接口仅管理员。

## 3. 筛选、时间及投影

- 单据筛选包含日期口径和范围、warehouse、claimantId、category、productId、size、type、origin、status、syncStatus、finalDestination。
- 时间统一解析为上海自然日起点和结束日次日的开区间终点，不依赖服务器本地时区；默认 `SUBMITTED`，备选 `FULFILLED`。
- 提交时间使用已有 `submittedAt`，兼容旧投影仅对空值回退 `createdAt`；重提交沿用现有服务刷新提交时间的语义，不改写历史。
- 实际发放使用 `Fulfillment.fulfilledAt`。三类业务均在创建 ISSUE 流水的同一事务创建唯一发放记录；无发放记录则不命中，不使用 `Request.completedAt`。
- 详情直接显示现有发放记录时间；流水发生时间用于流水明细，不能把归还/同步时间当领用发放时间。
- 未指定 warehouse 时从当前权限计算有限仓库集合；明确越权 403。候选领用人只取授权范围内历史领用关联，不复用仅查 ACTIVE 的代录候选接口。
- category/product/size 编译为一个 request-item 谓词；同一个谓词同时用于单据 EXISTS 和明细读取。返回单据去重及匹配行数/数量。
- 列表分页默认 50，最大 100，使用稳定 `(date,id)` 游标；游标绑定规范化筛选哈希且参数仍由服务器验证，不把游标当授权依据。
- 详情复用现有投影；关联库存流水独立分页并白名单输出业务编号、类型、数量、前后快照、操作人快照、同步状态和时间，不输出 CLI 或远端原始 payload。
- 商品名称/尺码用 RequestItem 的既有快照，人员显示沿用本地档案语义；不声称原有 Request 含不可变姓名快照。

## 4. 导出任务模型和幂等

新增下一条顺序 migration，实施前检查 migrations 目录，不能覆盖 0001-0008。
增量建导出任务表和必要查询索引，不回填或修改库存历史。

任务字段至少包括：id、actorUserId、normalizedFilters、authorizedWarehouseIds、
status、createdAt、snapshotAt、completedAt、expiresAt、leaseToken、leaseUntil、
attemptCount、rowCounts、fileKey、fileSize、fileHash、errorCode。

状态：

```text
QUEUED -> RUNNING -> SUCCEEDED -> EXPIRED
QUEUED / RUNNING -> FAILED
RUNNING (lease expired) -> QUEUED (bounded retry)
```

- POST 要求 Idempotency-Key，复用当前幂等执行器；同 key/actor/command 返回原任务，改条件冲突。
- 原幂等 key 重放已过期任务仍返回原任务；用户主动重新生成使用新 key，不修改旧审计。
- 创建在事务内重查角色、活动用户和选定仓库，保存有限仓库范围，记录 `REQUEST_EXPORT_CREATED` 审计。
- 每个用户最多 2 个未完成任务；用用户级事务锁避免并发绕过。默认单 exporter 并发 1，任务领取使用 `FOR UPDATE SKIP LOCKED`。
- 租约 token 保护每次执行；发布必须比较 token。失去租约的进程只能清理自身尝试文件，不能发布或覆盖新结果。
- 最多 3 次自动尝试，配置/权限/超量/非法数据错误不自动重试。任务失败后可主动新建导出，保留历史错误代码。
- 审计创建、成功、失败、过期和下载请求；日志只放任务 ID、数量、稳定错误码，不放完整报表行或个人备注。

## 5. 快照和大文件生成

已使用固定版本 `exceljs@4.4.0`，仅在 worker 增加依赖，使用真实文件输出的 streaming writer。其 ZIP/CSV/UUID 依赖采用定向 override，具体版本和真实文件回读证据见实施记录及 backend spec。

流程：

1. 领取任务，独立读取发起人的最新权限，确认任务仓库范围仍全部获授权。
2. 在专用数据库连接开启有超时的 REPEATABLE READ 只读快照，记录 `snapshotAt`。
3. 以同一筛选先计算命中明细规模，超过 100,000 明确失败；无结果允许生成空表。
4. 分批读取主单及命中数量，逐行写 `领用单汇总` 并 commit 该 worksheet。
5. 同一快照内分批读取命中明细，逐行写 `商品明细` 并 commit；不同时堆积两个 worksheet 的大量待输出行。
6. 关闭读取事务，完成 workbook，回读元信息或校验文件大小/哈希。
7. 用快照外的最新权限再次验证发起人和仓库；原子发布文件，再在独立事务中比较租约 token 并标记成功。

分批默认 500 条。不会 `findMany` 全量 include 所有审核/归还/流水后一次性写文件。
两表顺序写入共享一个稳定快照，避免生成期间的归还或审核导致两表口径漂移。
快照数据截至生成开始，不截至点击按钮；页面及文件以功能字段显示数据截至时间。

资源上限随最终方案审批：100,000 明细、64 MiB 文件、300 秒单次生成。
独立进程、独立小连接池、流式写入和 SQL 超时共同限制资源占用；并不承诺数据库负载完全为零。
压测以合成数据实施，记录普通业务 API 延迟、导出内存和耗时；未达门槛不自动缩减已批准规模并宣布通过。

## 6. 文件和下载安全

- 配置私有 `EXPORT_STORAGE_DIR`；开发默认 `.trellis/.runtime/exports`，不在静态资源目录，不提交生成文件。
- API 和 exporter 共享这个目录或同一私有卷；当前版本不支持彼此无法共享文件的多机部署，不增加对象存储。
- 文件名仅由服务端 UUID 和尝试 token 构成；请求只接受任务 ID，不接受路径或文件名。
- 写入唯一 `.partial` 文件，成功后同目录原子 rename；文件发布和数据库非原子时，以任务成功状态为下载必要条件，孤儿文件交给清理器处理。
- `SUCCEEDED` 后从 completedAt 起算 24 小时。API 先检查 expiresAt，不等待清理完成；清理默认每 5 分钟，并在 exporter 启动时补扫。
- 清理只处理此导出根目录中有任务/尝试归属的生成文件，检查解析后路径和符号链接边界，不递归删整个根目录，更不触及快照、数据库及其他运行产物。
- 清理审计不保留整份导出或完整自由文本条件；最终去向等敏感筛选在文件到期后按任务明细保留策略清除，留必要哈希和计数。
- 下载校验当前会话、账户活动状态、所有权、任务状态、有效期以及文件所含全部仓库的当前权限；缩权后拒绝整份文件，不按旧权限放行。
- 返回附件 Content-Disposition、XLSX MIME、no-store 和 nosniff；使用文件流，不先读入 Buffer。
- 权限检查保证每次下载请求的起点有效；已发送到用户电脑的字节无法因之后撤权而收回，不做不可能的安全承诺。
- Excel 用户文本只赋 string，绝不使用 formula/hyperlink 对象；文本超出 XLSX 单元格可表示长度时明确失败，不静默截断。

## 7. 工作表列和页面

两表各自包含简短筛选/截至时间元信息行与固定列标题，不增加第三张工作表。

`领用单汇总`：业务单号、来源、仓库、领用人、类型、用途/对象、最终去向、
备注、提交日期时间、实际发放日期时间、整单流程状态、整单同步状态、
筛选明细行数、筛选明细数量、命中明细已归还数量、命中明细待归还数量、
最近审核人/时间/结论、发放人、归还方式、预计归还日期。

`商品明细`：业务单号、明细 ID、仓库、领用人、来源、商品大类、产品/款式、
尺码、申请数量、已发放数量、已归还数量、待归还数量、明细同步状态、
提交日期时间、实际发放日期时间、整单流程状态。

未要求归还和未发放行的待归还数量为 0，不直接用申请数量减已归还数量。
明细同步状态由对应 ISSUE 流水投影；未发生发放为 NOT_REQUIRED，冲突或缺失不能伪装成功。

页面：

- `/admin/reports`：查询/我的导出两个 tabs；紧凑筛选区、结果表、分页、导出、详情入口。
- 日期类型分段控件；仓库、人员、商品等沿用 shadcn-vue 选择组件；商品图片仅复用既有图片组件。
- `/admin/access`：分页人员表、姓名/状态/角色筛选、编辑权限弹窗；系统管理员采用整组角色规则而不是互相矛盾的独立开关。
- 普通用户不显示两个管理入口，后端仍独立拒绝。权限改变后清理页面缓存并忽略旧请求晚到响应。
- 用现有 auth adapter 处理 401/403、CSRF、下载错误；异步提交未知结果重用原 key。
- 保留查询条件返回路径；敏感自由文本不塞入可分享 URL 或长期浏览器缓存。
- 1440x900 和 390x844 验证加载/空/错误/长文本/下载/过期/权限撤销，不增加营销或功能介绍段落。

## 8. 兼容、回退和关口

- GET `/access/users` 只新增白名单人员投影；PUT 复用既有 `updateAccess`、最后管理员锁和审计，不重写授权体系。
- 日期和导出增强不修改旧队列筛选、单据状态和历史 ISSUE 发生时间。
- 不运行真实飞书重试或对账；采用 fake gateway 的回归证据证明原机制未变。
- 新 exporter 可独立停用；关闭导出功能不影响查询/审核/库存，停用期间到期文件仍被 API 拒绝。
- 新增 migration 以保留数据为前提；回退程序时保留任务表和审计，不自动 drop 表。
- 上线/OAuth/生产共享卷/真实图片仍属第 9 项；本任务开发验收不代表上线批准。
