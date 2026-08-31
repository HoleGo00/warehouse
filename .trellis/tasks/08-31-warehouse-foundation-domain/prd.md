# 工程与核心库存领域基线

## Goal

建立可持续开发的 TypeScript 单仓库、PostgreSQL 数据模型和经过自动化测试的库存事务内核，为后续飞书登录、领用流程和 Base 同步提供稳定基础。

## Requirements

- 使用当前已验证的 Node.js `24.16.0`、pnpm `11.22.0` 建立 workspace。
- 建立 `apps/web`、`apps/api`、`apps/worker` 与 `packages/contracts`、`packages/config`、`packages/database`。
- Web 使用 Vue 3、Vite、TypeScript；API 和 worker 使用 NestJS；数据库使用 PostgreSQL + Prisma。
- 提供统一 lint、format、typecheck、unit、integration 和 build 命令。
- 提供本地 PostgreSQL Docker Compose、环境变量校验和不含真实密钥的示例配置。
- 建立 Epic 设计中的用户、角色、仓库权限、商品、variant、库存余额、预占、流水、领用骨架、审核、归还、管理员任务、审计、outbox、飞书映射和对账数据模型。
- 初始化西湖仓、余杭仓、三角色、10 款指环、健康腕表、三个历史停用腕表和指环 6# 至 13# variant。
- 商品和业务枚举必须来自共享 contracts，前后端不得各自维护不同字符串。
- 实现独立于具体领用流程的库存事务服务：查询可用库存、整单校验、整单预占/释放、追加库存流水、双仓调拨和请求幂等。
- 余额修改只能由库存事务服务执行；禁止提供直接设置余额的业务接口。
- 所有多明细操作按稳定库存键排序锁定，整单成功或整单回滚。
- 当前任务不连接飞书 OAuth，不调用真实 Base，不创建或修改飞书表。

## Acceptance Criteria

- [ ] `pnpm install --frozen-lockfile`、lint、typecheck、unit、integration 和 build 全部通过。
- [ ] `docker compose up` 后可执行 Prisma migrate 和幂等 seed，新环境可以一次启动成功。
- [ ] 种子包含 2 个仓库、3 个角色、14 个产品和 84 个 variant；三个历史腕表状态为 `INACTIVE_HISTORICAL`。
- [ ] 数据库约束保证仓库 + variant 余额唯一，流水和幂等键唯一，腕表 variant 不含尺码，指环 variant 只允许 6# 至 13#。
- [ ] 并发库存测试证明不能超卖；任一明细不足时不留下预占、余额或流水的部分变更。
- [ ] 调拨测试证明来源仓减少、目标仓增加且总量守恒。
- [ ] 重复幂等请求返回同一业务结果，不创建第二组流水。
- [ ] 审计和 outbox 记录可与同一业务事务原子写入。
- [ ] Web、API、worker 均有可启动的最小健康检查，但不包含尚未进入本任务的业务页面。
- [ ] 没有执行任何真实飞书写操作，项目文件不包含 App Secret、CLI profile 或历史快照个人信息。

## Out of Scope

- 飞书登录和用户权限页面。
- 商品图片、二维码和实际库存展示页面。
- 正常、临时、线下领用的完整状态机和 UI。
- 真实 `lark-cli` Base 写入、历史数据迁移和生产切换。

## Dependencies

- 来源需求：[Epic PRD](../08-28-warehouse-inventory-borrowing-v1/prd.md)。
- 技术边界：[Epic 技术设计](../08-28-warehouse-inventory-borrowing-v1/design.md)。
- 完成后解锁 `08-31-warehouse-feishu-auth-rbac`。
