# 飞书登录与仓库权限技术设计

## 1. Architecture

```text
apps/web
  auth feature -> OAuth redirect / Feishu client requestAccess -> apps/api

apps/api
  auth transport -> FeishuIdentityProvider -> AuthService -> PostgreSQL
  session guard -> role guard -> warehouse access policy -> feature controller
  access administration -> AccessControlService -> PostgreSQL + audit

packages/contracts
  auth/session/access request and response schemas

packages/config
  Feishu application, tenant, bootstrap, session and public URL configuration

packages/database
  auth session/state/bootstrap schema and transaction-owned identity/access services
```

飞书 OAuth、客户端免登和用户资料验证通过 API 内的专用 `FeishuIdentityProvider` 适配器完成。适配器可以使用飞书官方 Node SDK 或其官方 HTTP 接口，但对领域服务只返回经过 Zod 解码的统一身份，不向控制器泄露飞书 token 或原始响应。`lark-cli` 不进入依赖图。

## 2. Identity Flow

### 2.1 Browser OAuth

1. `GET /auth/feishu/oauth/start?returnTo=...` 校验站内 return path。
2. API 生成高熵 state，数据库只保存 state 摘要、规范化 return path、过期时间和消费状态；同时将同一随机值写入短时、独立、`HttpOnly`、`SameSite=Lax` 的 OAuth 浏览器绑定 cookie，生产环境启用 `Secure`，且 cookie Path 仅覆盖 callback。
3. API 重定向到飞书授权页，浏览器脚本不能读取绑定 cookie，绑定 cookie 不复用本地 session cookie。
4. `GET /auth/feishu/oauth/callback` 先清除绑定 cookie，并要求 query state 与该浏览器 cookie 恒时匹配；缺失或不匹配时不得消费数据库 state、不得兑换授权码。匹配后才在事务中原子消费 state；过期、已消费或篡改 state 直接拒绝。
5. Provider 用授权码换取用户凭据并读取统一身份资料；授权码和 token 不写日志、不落业务数据库。
6. `AuthService` 校验 tenant、应用可用范围和在职状态，随后幂等绑定本地用户、执行初始管理员检查并创建会话。
7. API 写入安全会话 cookie，并重定向到 state 中保存的站内路径。

### 2.2 Feishu Client SSO

1. Web 获取短时登录 challenge。
2. 飞书客户端通过 `requestAccess` 获取授权码。
3. Web 将授权码、challenge 和规范化 return path POST 到 API。
4. API 原子消费 challenge，并复用浏览器 OAuth 的身份校验、用户绑定、管理员初始化和会话签发流程。

两条入口不得各自维护用户匹配逻辑。统一身份至少包含 `tenantKey`、`userId`、`openId`、可选 `unionId`、姓名/头像/部门快照、`isInAppScope` 和 `isActive`。

## 3. Persistence

在现有 Prisma schema 上新增独立迁移：

- `auth_login_states`：state 摘要、入口类型、return path、过期时间、消费时间和创建时间。
- `auth_sessions`：会话 token 摘要、用户、过期/撤销/最后访问时间、创建时间；索引支持按摘要查找和按用户撤销。
- `system_bootstrap_events`：唯一 bootstrap key、获授用户、tenant、配置版本摘要和创建时间。固定 key `INITIAL_SYSTEM_ADMIN` 保证永久一次性。

现有 `users`、`user_roles`、`warehouse_admin_scopes` 和 `audit_logs` 继续作为身份与权限事实源。用户匹配优先使用允许 tenant 下的稳定 `feishuUserId`，并校验已有 `openId`/`unionId` 不发生冲突；资料字段只允许登录时刷新快照。

会话明文 token 仅存在于浏览器 cookie 与当前请求内存中。数据库保存 `SHA-256` 摘要；随机 token 本身提供足够熵，摘要用于降低数据库泄露后的直接复用风险。

## 4. Initial Administrator Concurrency

初始管理员流程与用户 upsert 位于同一个 PostgreSQL 事务：

1. 对固定 bootstrap key 取得事务级 advisory lock。
2. 若 `system_bootstrap_events` 已存在，永久跳过自动提权。
3. 若不存在，必须同时匹配 `FEISHU_ALLOWED_TENANT_KEY` 与 `INITIAL_ADMIN_FEISHU_USER_ID`。
4. 授予 `CLAIMANT` 和 `SYSTEM_ADMIN`，创建唯一 bootstrap event，并写入不可缺的审计日志。
5. 事务提交后才允许签发会话。

唯一约束与 advisory lock 共同覆盖多进程并发。以后即使系统管理员角色发生人工调整，环境变量变化也不能重新触发初始化。

## 5. Session Contract

- Cookie 名称固定且由服务端配置；`HttpOnly`、`SameSite=Lax`、`Path=/`，生产环境强制 `Secure`。
- OAuth 浏览器绑定使用与 session 不同的 cookie 名称、短时有效期和 callback 专用 Path；它只用于防止登录 CSRF，callback 无论成功失败都清除，不适用于飞书客户端 challenge 流程。
- 会话使用绝对过期时间；后续若需要滑动续期，只更新服务端 `lastSeenAt` 和受控过期时间，不更换身份事实。
- 全局 session guard 从 cookie 提取 token、计算摘要并加载 active session、active user、角色和仓库范围。
- 用户变为 `INACTIVE`、会话过期或撤销后立即拒绝，不依赖前端缓存。
- `POST /auth/logout` 撤销当前会话并清除 cookie；`GET /auth/me` 返回共享 contracts 定义的最小用户、角色和仓库范围。

## 6. Authorization Model

| 身份 | 通用登录后能力 | 西湖仓业务 | 余杭仓业务 | 权限管理 |
| --- | --- | --- | --- | --- |
| `CLAIMANT` | 库存查询、本人单据、发起领用 | 无管理员能力 | 无管理员能力 | 否 |
| 单仓 `WAREHOUSE_ADMIN` | 包含 CLAIMANT 能力 | 仅授权仓可管理 | 仅授权仓可管理 | 否 |
| 双仓 `WAREHOUSE_ADMIN` | 包含 CLAIMANT 能力 | 可管理 | 可管理 | 否 |
| `SYSTEM_ADMIN` | 全部登录后能力 | 可管理 | 可管理 | 是 |

实现分三层：

- `SessionGuard`：确认已登录且用户 active。
- `RoleGuard`：处理系统级能力，例如用户权限管理。
- `WarehouseAccessPolicy`：接收真实 warehouse ID/code，系统管理员直接通过；仓库管理员必须存在对应 scope；普通领用人拒绝管理员操作。

仓库权限必须在业务 service 调用前按请求参数或已加载实体重新判断。后续业务模块复用该 policy，不复制角色字符串判断。

## 7. Access Administration

系统管理员端点以一个事务提交目标角色集合和仓库集合：

- 所有用户保持 `CLAIMANT`。
- 存在仓库范围时必须具有 `WAREHOUSE_ADMIN`；移除该角色时同时清空范围。
- `SYSTEM_ADMIN` 不依赖仓库范围，读取时解释为全仓。
- 变更前锁定目标用户和相关角色记录；若操作会移除最后一名 active 系统管理员则拒绝。
- 审计保存规范化的 before/after 角色代码和仓库代码，不保存飞书 token 或完整个人资料。

## 8. Contracts and Errors

`packages/contracts` 定义并导出：

- `AuthMeResponse`、`AuthSessionUser`、`AccessProfile`。
- 客户端免登请求、角色/仓库授权更新请求和标准错误响应 schema。
- 稳定错误码：`AUTH_REQUIRED`、`AUTH_STATE_INVALID`、`FEISHU_TENANT_FORBIDDEN`、`FEISHU_APP_SCOPE_FORBIDDEN`、`USER_INACTIVE`、`FORBIDDEN_ROLE`、`FORBIDDEN_WAREHOUSE`、`LAST_SYSTEM_ADMIN`。

控制器只负责 schema 解码、cookie/redirect 和 HTTP 状态映射。身份绑定、bootstrap、会话与权限更新均由事务服务拥有。

## 9. Web Boundary

- 当前最小健康页升级为可恢复会话的应用外壳。
- 未登录时展示明确的飞书登录入口；飞书客户端可用时优先执行免登，失败后允许回退到普通 OAuth。
- 路由只保存规范化站内目标，不把任意 URL 交给 API。
- 登录中、登录失败、会话失效和已登录状态都有可见反馈；前端权限仅用于导航显示，不能替代 API 授权。

## 10. Testing Strategy

- Contracts/config 单测：未知 JSON、缺失密钥、生产 cookie 约束和错误码。
- Auth 单测：return path 规范化、state/challenge 摘要、OAuth 浏览器绑定 cookie、恒时匹配、身份冲突和 provider 错误映射。
- PostgreSQL 集成测试：用户幂等绑定、并发首位管理员、一次性 state、会话撤销、角色/仓库事务、最后系统管理员保护和审计原子性。
- API 测试：通过真实 Nest HTTP 管线覆盖 OAuth start/callback 浏览器绑定、客户端登录、`/auth/me`、logout、401/403 和仓库伪造请求。
- Web 测试/构建：OAuth 跳转保留二维码路径，客户端免登回退，登录状态渲染。

所有飞书网络调用在自动化测试中使用注入 provider fake；测试不依赖真实租户、授权码或 Base。

## 11. Rollout and Rollback

- 先迁移数据库，再部署 API，最后部署 Web；未配置飞书密钥时 API 以明确配置错误拒绝启动，不降级为本地登录。
- `.env.example` 只记录变量名和无敏感占位值；真实 App Secret 不进入仓库。
- 回滚应用版本时保留新增 auth 表，旧版本不会读取它们；必要时批量撤销所有 session，而不删除用户、审计或 bootstrap event。
- 本任务不进行开放平台控制台写入。生产回调域名、应用可用范围、权限申请和首位管理员稳定 user ID 由上线阶段人工配置并单独验收。
