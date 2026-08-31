# 飞书 CLI 环境调研

调研日期：2026-08-28

## 结论

- 项目所称飞书 CLI 对应飞书官方开源的 `lark-cli`。
- npm 包名称为 `@larksuite/cli`。
- 2026-08-28 已在本机全局安装 `@larksuite/cli@1.0.91`，实际命令为 `lark-cli`。
- `lark-cli --version` 已验证为 `1.0.91`；配置与授权完成后，`lark-cli doctor` 健康检查已通过。
- 安装时仅对白名单包 `@larksuite/cli` 放行官方 `postinstall` 脚本，未扩大其他 npm 包的脚本权限。

## 当前配置状态

- 已通过 `lark-cli config init --new` 创建专用飞书自建应用，profile 为 `glorychips-warehouse`。
- 应用 ID 为 `cli_aa1be4e16179dbfc`；密钥由 CLI 安全保存，不写入项目文件。
- 应用身份与用户身份均已就绪，当前授权用户为孔心成。
- Base 表、字段、记录、附件、视图、工作流等操作权限已授予。
- 增量申请 `search:docs:read` 后，飞书最终未授予该 scope；CLI 明确提示不得持续重试。
- 后续不使用标题全局搜索，改为由实际 Base URL 通过 `lark-cli base +url-resolve --as user` 精确定位两套库存表。

## 项目使用边界

本项目仅使用 `lark-cli` 的多维表格能力：

- 通过 Base URL 或标题解析 `base_token`、`table_id`、`view_id` 等真实坐标。
- 查询、创建、复制和更新数据表及字段结构。
- 查询、搜索、批量创建、批量更新和幂等 upsert 记录，并读取记录变更历史。
- 上传、下载和移除记录附件，用于产品主图与详情图。
- 管理视图的筛选、排序、分组、可见字段、卡片与时间轴配置。
- 管理必要的表单、仪表盘、工作流以及 Base 高级权限和角色。
- 使用 JSON DSL 查询、筛选、排序和聚合 Base 数据。
- 调研现有指环、腕表底账结构并执行兼容性增量优化。

不通过 CLI 执行登录认证、个人提醒、即时消息或其他无关飞书业务能力。

## 实施前验证

1. 决定创建仓储系统专用飞书应用，或绑定已有飞书开放平台应用。
2. 配置 `feishu` 品牌、认证 profile 和目标公司租户。
3. 只申请登录、通讯录事件和 Base 操作所需的最小权限，不启用飞书机器人提醒权限。
4. 运行 `lark-cli doctor`、`auth status`、`whoami` 和 scope 检查。
5. 以只读方式按标题或 URL 定位两套现有多维表格，列出数据表、字段、视图和少量样例记录。
6. 导出完整结构与记录基线，不在探索阶段执行写操作。
7. 在新建测试表验证字段创建、批量幂等写入、附件上传下载、视图与工作流能力。
8. 迁移真实历史数据前使用 `--dry-run` 或等价预览，保留源数据快照和迁移报告。

## CLI 操作约束

- Base 操作优先使用 `lark-cli base +...` 高层快捷命令，只有无对应快捷命令时才使用原始 API。
- 所有读取显式使用用户或应用身份并记录 profile；不擅自切换或删除 profile。
- 写操作先读取现状，再以最小变更执行并统一回读验收。
- 表、字段、记录、工作流和权限的删除属于高风险操作，未经用户对具体目标确认不得执行 `--yes`。
- 旧库存表永不删除；迁移后只读归档。
- 批量记录单批不超过 CLI 当前支持的 200 条，同一数据表串行写入，避免并发冲突。
- 查询与迁移输出写入任务 `research/` 或实施期受控产物目录，保留结构化 NDJSON/JSON 证据。

## 官方资料

- [飞书 CLI 产品页](https://www.feishu.cn/feishu-cli)
- [飞书官方 CLI GitHub](https://github.com/larksuite/cli)
- [飞书 CLI 安装指南](https://open.feishu.cn/document/no_class/mcp-archive/feishu-cli-installation-guide)
