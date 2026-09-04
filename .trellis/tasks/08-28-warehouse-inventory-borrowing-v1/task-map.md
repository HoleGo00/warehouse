# 仓储系统 V1 子任务执行顺序

## 执行规则

- 总任务 `08-28-warehouse-inventory-borrowing-v1` 作为 Epic，保留完整 PRD、技术设计、飞书审计和跨任务验收标准，不直接承担业务代码实现。
- 九个子任务严格按下表顺序执行；一次只启动一个，完成实现、检查、自动化测试和提交后，再规划/启动下一项。
- 后续子任务发现总 PRD 缺陷时，先回到 Epic 修正规则，再继续，不在子任务中静默改变业务口径。
- 真实飞书新表创建和历史迁移仅允许在第 7 个子任务开始，前六个子任务不得修改现有 Base。

## 顺序

| 顺序 | 子任务 | 核心交付 | 前置依赖 |
| ---: | --- | --- | --- |
| 1 | `08-31-warehouse-foundation-domain` | 工程单仓库、PostgreSQL 模型、库存事务、审计、outbox 数据结构和测试基线 | Epic 已批准 |
| 2 | `08-31-warehouse-feishu-auth-rbac` | 飞书唯一登录、首位管理员、三角色、仓库级 RBAC | 1 |
| 3 | `08-31-warehouse-catalog-inventory-qr` | 商品/图片、双仓库存查询、历史停用商品、仓库二维码 | 1、2 |
| 4 | `08-31-warehouse-normal-borrowing` | 正常领用、整单审核预占、退回、取消和发放 | 1、2、3 |
| 5 | `08-31-warehouse-temporary-offline` | 临时领用、补手续、后补审核、线下登记 | 4 |
| 6 | `08-31-warehouse-inventory-operations` | 入库、归还、调拨、盘点、工作日历和管理员提醒 | 4、5 |
| 7 | `08-31-warehouse-feishu-sync-migration` | lark-cli Gateway、outbox worker、V1 新表、历史迁移、对账和回滚 | 1 至 6 |
| 8 | `08-31-warehouse-query-export-admin` | 组合查询、双工作表 Excel、管理员配置和同步异常后台 | 1 至 7 |
| 9 | `08-31-warehouse-integration-cutover` | 全链路 E2E、安全复核、生产部署、切换与回滚演练 | 1 至 8 |

## 当前状态

- 已完成：`08-31-warehouse-foundation-domain`、`08-31-warehouse-feishu-auth-rbac`、`08-31-warehouse-catalog-inventory-qr`、`08-31-warehouse-normal-borrowing`。
- 下一项允许规划和启动：`08-31-warehouse-temporary-offline`。
- 后续四个业务子任务：仅完成范围登记，保持 `planning`。
- 真实飞书数据：保持只读，直到第 7 个子任务通过其迁移 dry-run 和测试验收。
