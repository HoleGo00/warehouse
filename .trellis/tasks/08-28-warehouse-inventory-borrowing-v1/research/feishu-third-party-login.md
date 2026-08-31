# 飞书第三方登录接入方案

调研日期：2026-08-28

## 结论

飞书可以作为本系统的第三方登录入口，并兼容当前“本地账号 + 系统管理员审核 + 本地角色和仓库权限”的产品规则。

## 最新产品决策

2026-08-28 已确认：V1 取消所有本地登录、注册审核和钉钉登录，只保留公司飞书登录。公司租户内且处于应用可用范围的员工首次登录自动创建普通领用人档案，无需管理员审核。系统仍在本地保存业务用户档案、角色、仓库授权和审计记录，但不保存登录密码。

以下原始方案说明保留作技术参考；其中“首次登录进入待审核”和“补齐本地密码”已被最新决策取代。

这不等于重新采用完整飞书身份体系：

- 飞书只负责认证当前用户。
- 本系统仍创建并管理本地账号。
- 首次飞书登录仍进入待审核。
- 三类角色与仓库授权仍由本系统配置。
- 不启用飞书机器人，也不向个人发送飞书提醒。

## 推荐入口

### 普通浏览器

使用飞书网页应用 OAuth 2.0：

1. 用户扫描西湖仓或余杭仓二维码，系统保存仓库上下文。
2. 用户选择“飞书登录”。
3. 跳转飞书授权页，或展示飞书扫码登录二维码。
4. 飞书回调携带短时授权码，后端校验 `state`。
5. 后端使用授权码换取 `user_access_token`，再获取用户身份。

### 飞书客户端内网页

从飞书客户端打开仓库网页时，使用客户端内网页免登流程获取授权码，减少重复登录操作；后续后端处理与普通浏览器一致。

## 本地账号流程

1. 首次飞书登录后，按 `union_id`、`open_id` 等标识查找绑定关系。
2. 没有绑定账号时创建本地待审核注册记录，并预填获授权的姓名、头像、手机号或邮箱等信息；具体字段取决于应用权限。
3. 用户补齐部门、密码等本地必填资料。
4. 系统管理员审核通过后才可以提交正常或临时领用。
5. 后续飞书登录按绑定关系进入本地账号，并继续检查账号状态、角色和仓库权限。

## 建议保存字段

- `feishu_user_id`：企业/组织内用户身份。
- `feishu_open_id`：当前应用内用户身份。
- `feishu_union_id`：同一开发者下的统一身份。
- `feishu_tenant_key`：所属企业租户标识。
- `feishu_bound_at`：绑定时间。
- `feishu_profile_snapshot`：必要的用户资料历史快照。

## 安全约束

- 只接受配置允许的企业租户和应用可用范围。
- OAuth 回调必须校验 `state`，防止登录请求被替换。
- `App Secret`、授权码交换和用户 token 仅在后端处理。
- 不按姓名自动合并账号；已有账号绑定需通过可信手机号/邮箱匹配或管理员确认。
- 飞书授权成功不能绕过本地账号审核、停用状态、角色或仓库权限。
- 仓库二维码上下文必须经过登录跳转完整保留，但不能依赖二维码赋予权限。

## 与飞书多维表格集成的关系

登录与库存同步是两个独立通道：

- 登录使用飞书 OAuth 用户身份。
- 多维表格同步使用服务端应用凭证和飞书 CLI/相关接口。
- 登录用户不直接持有库存表写权限，所有库存写入仍由后端统一校验和审计。

## 官方资料

- [网页应用登录流程概述](https://open.feishu.cn/document/sso/web-application-sso/login-overview)
- [获取授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
- [获取 `user_access_token` v2](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)
- [网页应用扫码登录](https://open.feishu.cn/document/qr-code-scanning-login-for-web-app/introduction)
- [飞书客户端内网页应用授权指南](https://open.feishu.cn/document/sso/web-application-end-user-consent/webapp-incremental-authorization-access-guide)
- [用户身份概述](https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/introduction)
