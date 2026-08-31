# 钉钉第三方登录接入调研

调研日期：2026-08-28

> 状态：未采用。V1 已确定只使用公司飞书登录，不接入钉钉或本地密码登录。本文件仅保留技术评估历史。

## 结论

可以接入钉钉 OAuth 2.0 作为第三方登录方式，并兼容当前“扫码注册后由管理员审核”的产品规则。

推荐将钉钉登录作为手机号密码登录之外的可选入口，而不是直接替代本地账号体系：

- 钉钉负责证明用户身份。
- 本系统保留账号状态、管理员审核、角色和仓库权限。
- 钉钉登录不用于发送提醒。
- 第一次钉钉登录仍需补齐必要资料并等待系统管理员审核。

## 推荐流程

1. 用户扫描西湖仓或余杭仓二维码，系统保存仓库上下文。
2. 用户选择“钉钉登录”。
3. 浏览器跳转至钉钉 OAuth 授权页，或使用钉钉扫码登录第三方网站。
4. 钉钉回调携带授权码，后端校验 `state` 后换取用户级访问凭证。
5. 后端获取当前授权用户的 `openId`、`unionId` 等个人身份信息，并校验所属企业 `corpId`。
6. 首次登录时创建本地待审核账号，预填已获授权的信息，用户补齐缺失字段。
7. 系统管理员审核通过后，用户才可以提交正常或临时领用。
8. 再次登录时按已绑定的钉钉身份找到本地账号，并继续执行本地账号状态与权限校验。

## 数据字段

- `auth_provider`：`password` 或 `dingtalk`，也可同时绑定。
- `dingtalk_union_id`：钉钉跨应用统一身份标识。
- `dingtalk_open_id`：当前应用下的身份标识。
- `dingtalk_corp_id`：授权时选择的企业组织。
- `dingtalk_bound_at`：绑定时间。
- `dingtalk_profile_snapshot`：必要的昵称、头像等历史快照，避免将钉钉实时资料当作业务审计唯一来源。

## 安全约束

- 仅接受配置允许的公司 `corpId`，外部组织或个人钉钉账号不能直接获得系统访问权。
- OAuth 回调必须校验 `state`，防止登录请求被替换。
- 客户端密钥和用户 token 只在后端处理。
- 不按姓名自动合并本地账号；已有账号绑定需通过可信手机号匹配或管理员确认。
- 钉钉授权成功不等于本地审核通过，也不授予仓库管理员权限。

## 官方资料

- [实现网页方式登录应用](https://open.dingtalk.com/document/development/tutorial-obtaining-user-personal-information)
- [扫码登录第三方网站](https://open.dingtalk.com/document/orgapp-server/scan-qr-code-to-log-on-to-third-party-websites)
- [获取登录用户的访问凭证](https://open.dingtalk.com/document/orgapp-server/obtain-identity-credentials)
- [获取用户通讯录个人信息](https://open.dingtalk.com/document/development/dingtalk-retrieve-user-information)
- [钉钉基础概念](https://open.dingtalk.com/document/dingstart)
