# 飞书身份体系接入调研

调研日期：2026-08-28

## 产品决策

2026-08-28 最新确认：V1 仅使用公司飞书登录，不提供本地密码、注册审核或钉钉登录；所有补手续、超期和待归还提醒仍只进入系统内管理员待办，不使用飞书机器人发送个人提醒。

最终角色为三类：

- 普通领用人。
- 仓库管理员，同时承担一道审核、发放、线下登记和库存处理职责。
- 系统管理员。

此前“使用独立账号”的中间决策已被上述最新决策取代。以下内容中的本地角色划分仍有效，关于独立账号登录的描述不再适用。

## 已评估方案

曾建议使用企业自建应用承载网页入口，并将飞书身份认证与本系统业务授权分开：

- 飞书负责确认当前访问者是谁，并提供用户身份标识与基础资料。
- 本系统保存用户与业务角色的映射，决定其能否申请、审核、发放、线下登记或管理系统。
- 飞书机器人按用户身份标识发送待审核、待补手续、超期和待归还提醒。
- 库存表写入使用应用身份的服务端凭证，不依赖员工个人凭证执行库存扣减。

## 推荐流程

1. 在飞书开放平台创建企业自建应用，开启网页应用能力和机器人能力。
2. 配置桌面端/移动端主页、重定向地址和 H5 可信域名。
3. 员工从飞书工作台进入网页时，前端通过当前推荐的 `requestAccess` 免登流程获取授权码；在普通浏览器进入时走飞书 OAuth 2.0 网页登录。
4. 后端使用短时授权码换取 `user_access_token`，再获取当前用户身份信息。
5. 后端按飞书用户标识查找或创建本地用户，建立系统会话。
6. 本地角色表决定业务权限；角色不直接等同于飞书通讯录身份。
7. 机器人使用用户标识发送提醒，并携带领用单详情页链接。

## 建议角色

- 普通领用人：提交、补充和查看本人记录。
- 审核人：完成唯一一道审批；一道审核表示一个审批节点，不限制只能配置一个审核人员。
- 仓库管理员：确认发放、代录线下领取、处理入库/归还/调拨/盘点、查看库存流水。
- 系统管理员：配置角色、商品基础资料、飞书表映射和同步重试。

同一员工可以拥有多个角色。审核人与仓库管理员可以是同一人，也可以分开配置。

## 用户标识建议

- 本地用户记录保存飞书 `user_id`、`open_id`、姓名快照和在职状态。
- 同一租户内部，`user_id` 适合关联员工通讯录身份；`open_id` 是用户在当前应用中的身份标识，适合与应用消息能力配合。
- 不使用姓名作为唯一键，姓名只作为展示与历史快照。

## 安全边界

- `App Secret`、应用访问凭证和多维表格写权限仅放在后端。
- 前端只获得本系统会话，不保存飞书应用密钥。
- 每次审核、发放和库存变动记录飞书用户标识、姓名快照、时间与结果。

## 与飞书 CLI 的关系

飞书 CLI 或其他自动化工具用于应用配置、资源管理或调用飞书能力，不替代网页用户登录。身份认证仍按飞书开放平台的 OAuth/免登协议完成。具体 CLI 的可用能力需在确认工具名称和版本后单独验证。

## 官方资料

- [网页应用登录流程概述](https://open.feishu.cn/document/sso/web-application-sso/login-overview)
- [配置应用免登流程](https://open.feishu.cn/document/client-docs/h5/development-guide/step-3?lang=zh-CN)
- [`requestAccess`](https://open.feishu.cn/document/web-app/gadget-api/open-ability/login/requestaccess?lang=zh-CN)
- [获取 `user_access_token` v2](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token?lang=zh-CN)
- [用户身份概述](https://open.feishu.cn/document/platform-overveiw/basic-concepts/user-identity-introduction/introduction?lang=zh-CN)
- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create?lang=zh-CN)
