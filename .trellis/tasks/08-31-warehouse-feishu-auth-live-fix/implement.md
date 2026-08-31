# 飞书登录真实环境修复实施计划

## Implementation Order

1. 更新 OAuth 用户资料与通讯录响应 schema，改为以 `open_id` 查询并从通讯录取得稳定 `user_id`。
2. 更新 provider 单元测试，覆盖真实字段形态、请求 URL、客户端免登共用路径和缺字段失败。
3. 收紧 `FEISHU_APP_ID` 配置校验，补充占位/格式错误测试。
4. 让 API 与 Vite 从仓库根目录 `.env` 加载本地配置，保持进程环境变量覆盖优先级。
5. 更新 README 和 `.env.example`，记录开放平台回调、权限、发布和本地密钥步骤。
6. 运行 focused tests，再运行 lint、typecheck、全量 test、integration test、build、diff 和敏感信息检查。

## Validation Commands

```text
pnpm exec vitest run packages/config/src/config.test.ts apps/api/src/auth/auth.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
git diff --check
git status --short
```

附加验证：

- 生成 OAuth start 响应但不跟随外部跳转，确认授权 URL 使用真实格式的 `app_id` 与精确回调 URL。
- 搜索工作树，确认没有真实 App Secret、access token、授权码或 `lark-cli` 凭据引用进入版本控制。
- 根目录 `.env` 缺失时开发进程仍按现有 schema 清晰失败；存在时 API/Web 能读取对应变量。
