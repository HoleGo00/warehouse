# 飞书登录真实环境修复

## Goal

修复真实飞书 OAuth 用户资料字段兼容、本地环境变量加载和部署配置说明，并完成无密钥泄露的实测验证。

## Requirements

- 普通浏览器 OAuth 必须使用真实飞书 App ID 发起授权，API 启动时拒绝明显无效或占位的 App ID。
- 兼容飞书 `authen/v1/user_info` 的真实响应：该响应提供 `open_id`、`tenant_key` 等资料，但不依赖其返回 `user_id`。
- 后端必须使用 `open_id` 调用通讯录用户接口，再从受权限保护的通讯录响应取得稳定 `user_id`、员工状态和部门快照。
- 通讯录字段缺失、权限不足或响应异常时必须失败关闭，不得创建本地会话，也不得把飞书原始响应或 token 返回浏览器。
- 根目录 `.env` 必须被 API 和 Web 本地开发进程实际读取；生产环境仍允许部署平台环境变量覆盖本地文件。
- 文档必须明确真实 App ID、App Secret、允许租户、初始管理员 user ID、OAuth 回调白名单和通讯录权限的人工配置步骤。
- 不读取、导出或提交 `lark-cli` 安全凭据，不自动修改飞书开放平台配置，不写入真实飞书 Base。

## Acceptance Criteria

- [x] OAuth 用户资料不含 `user_id` 时，适配器仍能用 `open_id` 查询通讯录并生成现有 `FeishuIdentity`。
- [x] 通讯录请求明确使用 `user_id_type=open_id`，最终本地身份仍使用通讯录返回的稳定 `user_id`。
- [x] 通讯录缺少 `user_id` 或员工状态时登录失败并映射为稳定上游错误，数据库不产生会话。
- [x] 无效或占位 App ID 在 API 启动配置解析阶段被拒绝，不能再生成可点击的错误授权链接。
- [x] `pnpm dev:api` 与 `pnpm dev:web` 能从仓库根目录 `.env` 读取各自所需变量。
- [x] README 和 `.env.example` 给出不含真实密钥的完整本地配置契约。
- [x] focused tests、lint、typecheck、全量测试、build、`git diff --check` 和敏感信息检查通过。

## Notes

- 2026-08-31 实测确认：错误码 `20028` 来自视觉 QA 使用的占位 App ID；当前 `lark-cli doctor` 能验证真实应用凭据有效。
- 2026-08-31 实测确认：`authen/v1/user_info` 返回 `open_id`、`union_id`、`tenant_key`，不返回 `user_id`；当前应用的通讯录响应也因字段权限不足而缺少 `user_id`、`status` 和部门。
- 代码修复已完成；真实登录激活仍需用户在飞书开放平台补齐通讯录字段权限、应用可用范围和回调白名单并发布版本，然后在本地 `.env` 手动填入 App Secret 与通讯录 `user_id`。
