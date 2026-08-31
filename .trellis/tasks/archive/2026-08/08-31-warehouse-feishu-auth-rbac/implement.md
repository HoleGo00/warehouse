# 飞书登录与仓库权限实施计划

## Implementation Order

1. 扩展共享 contracts 与环境变量 schema，定义身份、会话、权限更新和稳定错误码；补齐单元测试及 `.env.example`。
2. 扩展 Prisma schema，新增登录 state、服务端 session 和永久 bootstrap event，生成独立不可变迁移。
3. 在 `packages/database` 实现事务拥有的身份绑定、首位管理员初始化、会话生命周期、角色/仓库授权与审计服务。
4. 在 `apps/api` 建立 `FeishuIdentityProvider` 接口与生产适配器，统一 OAuth 和客户端免登授权码解析；自动化测试使用 fake provider。
5. 实现 OAuth start/callback、客户端 challenge/login、`/auth/me` 和 logout；OAuth 使用独立短时 HttpOnly 浏览器绑定 cookie 并在 callback 消费 state 前恒时校验，客户端 challenge 不使用该 cookie；统一 session cookie、return path 与业务错误映射。
6. 实现 session、role 和 warehouse access 守卫/policy，并提供最小受保护探针接口证明 URL/请求体仓库不能绕过授权。
7. 实现系统管理员用户权限更新 API，保证角色/仓库组合、最后系统管理员保护和审计原子性。
8. 在 `apps/web` 实现最小飞书登录与会话外壳、客户端免登桥接、合法回跳恢复和失败状态；前端只消费共享 contracts。
9. 完成单元、真实 Nest HTTP 管线与 PostgreSQL 集成测试，重点覆盖 OAuth 浏览器绑定、并发 bootstrap、state 重放、身份冲突、停用会话和完整 RBAC 矩阵。
10. 运行全量质量门禁、敏感信息扫描和工作树复核；确认没有 `lark-cli` 登录调用和真实 Base 写入。

## Expected Change Boundary

- `packages/contracts/src/auth.ts` 与导出/测试：跨层身份、会话、权限和错误契约。
- `packages/config/src/index.ts`、测试与 `.env.example`：飞书和 session 配置。
- `packages/database/prisma/schema.prisma` 与新迁移：auth state/session/bootstrap 持久化。
- `packages/database/src/auth/**` 与集成测试：身份绑定、bootstrap、session、RBAC、审计事务。
- `apps/api/src/auth/**`、`apps/api/src/access/**`、模块和依赖：飞书适配、控制器、守卫和权限管理。
- `apps/web/src/features/auth/**`、路由/应用外壳与必要样式：最小登录体验。
- 根测试配置和 package manifests：仅添加上述实现真实需要的官方 SDK、Nest 测试或浏览器测试依赖。

明确不修改 worker、库存事务算法、真实 Base、商品目录和领用状态机。

## Validation Commands

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose config
git diff --check
git status --short
```

附加验收：

- 搜索仓库中是否出现 App Secret、access token、授权码样本或明文 session token。
- 搜索 `lark-cli` 调用，确认新增身份代码不依赖 CLI。
- 对新增迁移执行空库 migrate，并重复执行 seed 验证幂等。
- 定向运行并发首位管理员和 RBAC 矩阵测试，失败时不得通过降低并发或跳过测试规避。

## Rollback Points

- contracts/config 完成后先运行单元门禁，避免错误契约扩散到 API 与 Web。
- 数据库迁移落地后先在空库验证，再实现依赖该 schema 的服务。
- Provider 与领域服务通过接口隔离；飞书 API 适配失败时回滚适配器，不回滚已验证的本地权限模型。
- 若前端客户端免登桥接无法在本地自动验证，仍需保留 OAuth 路径与 provider fake 的完整自动化覆盖，并将真实客户端验收明确留到生产配置阶段。
- 任何回滚不得删除 bootstrap event 或审计历史；可以撤销 session，使所有用户重新登录。
