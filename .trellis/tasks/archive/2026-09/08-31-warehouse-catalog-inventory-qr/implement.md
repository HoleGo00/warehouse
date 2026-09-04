# 商品图片、库存查询与仓库二维码实施计划

## Implementation Order

1. 补充商品、库存查询、图片和仓库入口 contracts 及纯函数测试。
2. 实现 `CatalogService` 与 `InventoryQueryService`，覆盖创建规格、状态过滤、缺主图、历史停用和数量计算。
3. 增加 PostgreSQL 集成测试，证明双仓明细/汇总、待同步标识和 selectable 过滤正确。
4. 新增 Nest catalog/inventory/warehouse controllers、guards 组合、图片 provider port 和二维码 SVG 输出。
5. 增加 API HTTP 测试：普通员工库存可见、系统管理员商品写入、越权拒绝、非法仓库、图片不可用和二维码内容。
6. 引入 Vue Router，重构认证后应用壳，并实现库存页、仓库入口页和系统管理员商品页。
7. 为 API adapter、composable 和关键视图逻辑增加 Vitest；验证 loading/error/empty/missing-image/pending-sync 状态。
8. 启动本地数据库、API 和 Web，以受控测试会话完成桌面与移动端 Playwright 视觉及交互检查。
9. 运行全量质量门禁、敏感信息检查和工作树复核。

## Expected Change Boundary

- `packages/contracts/src/`：新增共享 wire schemas 和状态枚举。
- `packages/database/src/catalog/`、`packages/database/src/inventory/`：商品管理与库存只读 projection。
- `packages/database/test/`：数据库集成测试。
- `apps/api/src/catalog/`、`apps/api/src/inventory/`、`apps/api/src/warehouses/`：薄控制器和 provider 边界。
- `apps/web/src/router/`、`apps/web/src/features/catalog/`、`apps/web/src/features/inventory/`、`apps/web/src/features/warehouse-entry/`：路由、API adapter、状态和页面。
- `packages/config`、`.env.example`：仅在二维码公开 URL 需要新配置时追加；不写真实域名或密钥。

明确不改：库存事务写路径、正常/临时领用状态机、outbox worker、真实飞书 Base、OAuth 开放平台配置和生产部署。

## Validation Commands

```text
pnpm exec vitest run packages/contracts packages/database/src apps/api/src apps/web/src
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
git diff --check
git status --short
```

## Browser Acceptance

- 桌面至少验证 1440×900，移动至少验证 390×844。
- 检查指环 8 列尺码矩阵、长产品名、腕表历史停用标识、零库存、待同步状态、缺图状态和图片加载失败。
- 检查 `/w/XIHU/apply`、`/w/YUHANG/apply`、非法仓库路径，以及登录 return path 不丢仓库。
- 检查二维码 SVG 非空、可扫描数据等于配置后的稳定 URL，且不含 token、用户或库存参数。

## Rollback Points

- Contracts/服务/API/Web 分层提交前保持可独立回退。
- 若二维码依赖或 Router 引入导致构建问题，先回退对应适配层，不改数据库库存数据。
- 本任务不执行真实飞书写入，不存在外部 Base 数据回滚。

## Pre-Start Gate

- [x] 用户确认真实主图上传和正式图片验收的阶段安排（2026-09-04）。
- [x] PRD Open Question 清空并完成 convergence pass。
- [x] 用户审阅最终规划摘要并在下一条消息明确批准实施（“继续”）。
