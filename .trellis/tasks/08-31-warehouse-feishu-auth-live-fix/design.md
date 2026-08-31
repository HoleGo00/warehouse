# 飞书登录真实环境修复设计

## Behavior Gap

当前实现把 `authen/v1/user_info.data.user_id` 当作必填字段，并以 `user_id` 调用通讯录接口；真实飞书响应不提供该字段，因此真实 OAuth 即使通过授权码交换也会在身份解析阶段失败。与此同时，根目录 `.env.example` 没有对应的稳定加载路径，测试时容易退回到手动注入占位配置。

## Data Flow

```text
浏览器授权码
  -> authen/v2/oauth/token
  -> authen/v1/user_info (tenant_key, open_id, union_id, profile)
  -> contact/v3/users/{open_id}?user_id_type=open_id
  -> contact user_id + status + departments
  -> FeishuIdentity
  -> 现有 tenant/app-scope/status/bootstrap/session/RBAC 流程
```

外部响应只在 `HttpFeishuIdentityProvider` 边界使用 Zod 校验。领域层继续接收原有 `FeishuIdentity`，数据库和权限模型不变。

## Changes

- `apps/api/src/auth/feishu-identity.provider.ts`
  - 从 OAuth 用户资料 schema 移除错误的必填 `user_id`。
  - 用 `open_id` 查询通讯录，并从通讯录响应取得 `user_id`。
  - 保持缺失身份或状态字段时失败关闭。
- `apps/api/src/auth/auth.test.ts`
  - 使用与真实响应一致的 fixture。
  - 断言通讯录 URL 使用 `open_id`，并覆盖字段缺失失败。
- `packages/config/src/index.ts` 与测试
  - 对 `FEISHU_APP_ID` 添加真实格式约束，阻止占位值进入授权链接。
- `apps/api/src/main.ts`
  - 在解析环境变量前安全加载仓库根目录 `.env`，已有进程环境变量优先。
- `apps/web/vite.config.ts`
  - 将 Vite `envDir` 指向仓库根目录，使 `VITE_*` 与后端配置来自同一个本地文件。
- `README.md`、`.env.example`
  - 更新飞书本地配置、开放平台人工步骤和缺失权限的诊断说明。

## Explicitly Out Of Scope

- 不修改 Prisma schema、用户绑定规则、bootstrap 事务、session 或 RBAC。
- 不把 `lark-cli` 引入应用运行时，也不导出其 App Secret。
- 不自动授权 CLI scope、不自动修改飞书开放平台权限、回调 URL 或应用发布状态。
- 不启动带占位 App ID/App Secret 的可点击登录预览。

## Security

- App Secret 只存在于被 Git 忽略的本地 `.env` 或部署环境变量中。
- 测试仅使用明确的假 secret。
- 上游 schema、权限和网络错误继续映射为稳定业务错误，不返回完整飞书响应。
