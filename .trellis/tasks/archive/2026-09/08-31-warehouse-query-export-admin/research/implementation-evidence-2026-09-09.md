# 第 8 项实施与验收记录

日期：2026-09-09。实施已获批准；本记录区分自动验证、浏览器合成测试、人工验收和发布授权。

## 1. 交付范围

- 基线 `53a27c4`，分支 `codex/warehouse-query-export-admin`。
- 实施工作树：`D:/GloryChips/glorychips-warehouse-query-export-admin`。
- 新增授权范围内的组合查询、双日期口径、关联库存流水、后台 Excel 导出、下载和过期清理、人员权限管理页面。
- 混领单只导出同一条明细同时命中商品大类/产品/尺码条件的商品，汇总数量等于导出明细数量之和。
- 日期默认提交日期；实际发放日期取 `Fulfillment.fulfilledAt`，上海自然日包含首尾日期。
- 文件固定两表：`领用单汇总`、`商品明细`；成功起算 24 小时重复下载，当前身份/授权/所有权失效立即拒绝。
- 新增 `0009_request_exports`，不改库存余额、原领用状态机或飞书绑定；现有商品、日历、待办和同步入口保留。
- 单独的 exporter 进程、两连接数据库池、256 MiB Node old-space 堆上限；配置见 `.env.example` 和 `pnpm dev:export`。

## 2. 修复与验证过程

1. **真实 Excel 回读发现无效文件**：最小流式写入样例生成成功，但 ZIP 中元数据 XML 为空，ExcelJS 回读报 `company` 未定义。定向固定 ExcelJS 的 ZIP 依赖到 `archiver@5.3.2` 后，小样例和真实两表文件均恢复回读。该证据定位到依赖组合兼容问题，不声称已定位旧 ZIP 包内部的具体缺陷行。
2. **首轮十万条导出超时**：300 秒上限实际触发。查询计划存在重复扫描和回表，测试样本又缺少完整统计。增加全仓提交时间排序索引、500 行批次、批量样本 ANALYZE，并改为真正独立的 API/exporter 进程后通过。没有降低十万条规模或放宽验收阈值。
3. **资源余量**：未固定堆上限时多轮 RSS 在约 470–505 MiB 间波动，虽通过但接近 512 MiB 目标。固定 exporter old-space 为 256 MiB 后，实测 RSS 降到约 307 MiB；最终数值以第 3 节末轮记录为准。
4. **清理错误覆盖原错误**：压力负例曾偶发把 `EXPORT_TOO_LARGE` 覆盖为 `ERR_STREAM_DESTROYED`。捕获原始失败后再销毁流，首个流错误不被后续事件覆盖；保留超量和阻塞查询超时回归。
5. **状态与页面**：保留详情返回后的筛选/页码，轮询不丢已展开的导出页，任务按创建时间倒序；取消失效请求并阻止撤权后的晚到响应恢复敏感内容。
6. **本地启动**：3108 端口已有服务，未停止该服务；隔离 QA API 使用 39108，前端使用 5188。QA 初始化通过项目原有 Prisma 命令入口运行，未修改原项目的 dotenv/Prisma 配置。

## 3. 自动检查

最终复核已通过。以下日志在该工作树根目录，均为本地生成产物，不提交原始日志；提交和归档回执见第 6 节说明及 Git/journal：

| 检查 | 证据 | 当前状态 |
| --- | --- | --- |
| Prisma generate / validate | 构建及 validate 实际命令 | 通过 |
| lint | `task8-lint.log` | 通过 |
| typecheck | `task8-typecheck.log` | 全部工作包通过 |
| 单元/HTTP | `task8-unit.log` | 42 文件、181 项通过 |
| PostgreSQL 全量集成 | `task8-integration-all.log` | 10 文件、71 项通过，容量项按设计单独运行 |
| build | `task8-build.log` | 通过，保留原有前端包体提示 |
| format / diff | `task8-format-check.log`、`git diff --check` | 通过 |
| 十万条及独立 API 压测 | `task8-capacity-final.log` | 6 项通过，含容量及失败/快照回归 |

最终容量记录（2026-09-09 18:53 开始，Windows 本机 Docker PostgreSQL）：

- 100,000 单据 / 100,000 条指环明细；两表各 100,003 行，汇总和明细数量各为 100,000。
- 导出耗时 **26,319.74 ms**，文件 **18,966,369 bytes（约 18.1 MiB）**。
- exporter RSS 峰值 **320,987,136 bytes（约 306.1 MiB）**，低于 512 MiB 目标；堆上限 256 MiB。
- 20 并发查询，无导出基线 p95 **302.30 ms**；导出期间 **2,080 次**查询，无失败，p95 **182.90 ms**。基线和负载阶段缓存状态不同，不据此宣称导出使 API 更快。
- 全部既定门槛通过；真实 HTTP 下载回读和数量逐行核对通过。

覆盖的新增负例包括：同明细 AND 条件、上海午夜、补手续/完成时间不代替发放时间、超量/超时不发布、并发快照更改、同时幂等创建、两执行者抢单、租约丢失和恢复、过期、所有权、撤权、路径穿越、符号链接根目录、非法文本、CSRF、最后管理员保护。

100,000 明细验收固定条件：一个独立 API、一个独立 exporter、20 个并发普通业务查询；先测无导出基线，再测导出负载。导出文件经真实 HTTP 下载，用流式 Excel 读取器逐行核对两表各 100,003 行（含 3 行表头/元信息）及两表数量各 100,000。RSS 每 100 ms 采样，不是堆大小或系统总内存。

## 4. 浏览器与失败恢复

使用独立合成库及测试会话，不调用真实飞书登录。成功流程不做 API 响应替换。

- 1440x900 与 390x844：查询、分页、完整详情返回、提交/实际发放日期切换、权限编辑弹窗均通过。
- 61 张指环/腕表混领单筛选指环，真实浏览器下载回读：两表各 61 条数据，明细全部为指环，汇总和明细数量均为 183。
- 重复下载、普通员工禁止查询、仓库管理员范围约束、他人导出不可下载、外站写入拒绝、错误日期拒绝、最后管理员保护经真实 API 验证。
- 人员表只有 3 名已登录测试员工，不包含未登录的历史档案；通过页面保存仓库角色后，回读权限一致。
- 真实撤销仓库管理员角色后，下一次轮询触发权限错误并清空表格；测试随后恢复测试账号的原权限。
- 浏览器中额外模拟过期/503 响应，验证禁用下载和可见错误提示；这两项 UI 模拟不冒充真实文件到期，真实到期拒绝和清理另由数据库测试覆盖。
- 页面无整体横向溢出，表格在内部滚动；等待弹窗动画结束后检查截图，未见文字/控件重叠；没有浏览器运行时错误。
- 停用 exporter 时任务为 `QUEUED`，API 查询及库存接口可用；配置普通文件作为存储目录时 exporter 退出码 1 且明确记录不可用，API 仍健康；恢复正确目录后原任务成功生成，下载返回 200。

证据位于 `.trellis/.runtime/task8-qa/`：`browser-results.json`、`browser-download.xlsx`、`reports-desktop.png`、`reports-mobile.png`、`access-desktop.png`、`access-mobile.png`、`access-dialog-mobile.png`、过期和错误截图。测试脚本、合成会话和文件不进入 Git。浏览器记录日志为 `task8-browser-qa.log`，进程失败恢复记录为 `task8-worker-negative.log`。

本地预览：`http://localhost:5188/admin/reports`，API 为 `http://localhost:39108`；仅接隔离测试库。自动化使用合成会话 Cookie，未增加免登录入口，普通新浏览器仍会显示登录页。`pnpm --filter @glorychips/worker dev:export` 已用隔离配置、单次运行模式启动验证成功。Docker PostgreSQL 容器已实查为 healthy。

## 5. 依赖审计和剩余风险

- ExcelJS 4.4.0 包声明 MIT；版本已固定，真实 XLSX 验收包含依赖覆盖后的实际写入/回读。
- 定向 overrides：`exceljs>archiver=5.3.2`、`exceljs>fast-csv=4.3.6`、`exceljs>uuid=11.1.1`、`tar-stream@2>bl=4.1.0`。
- npm 官方 registry 的生产依赖审计：9 条，6 high、2 moderate、1 low，0 critical。基线锁文件与最终锁文件的告警编号完全相同，本次新增告警为 0。
- 保留的告警涉及 Nest/multer、Prisma/mysql2/deepmerge-ts、Vue Router/Vite/Stylus/decode-uri-component 依赖链。没有扩大任务修改这些框架；**整体依赖安全审计仍未通过**，正式上线前需单独处理。
- 构建仍提示前端单包超过 500 kB；PostgreSQL 驱动仍有 pg 未来版本并行 query 弃用提示。未将这些现有提示改成静默忽略，也未升级无关依赖。
- 正式 OAuth、生产共享卷权限、真实飞书调用/映射变更和部署均未验收。本任务只证明本地开发交付，不代表上线批准。

## 6. 提交计划与保护边界

用户已于 2026-09-09 在验收汇报和提交确认请求后回复“继续”，批准以下范围完整的本地工作提交：

`feat(reports): add scoped queries, private Excel exports and access administration`

包含 67 个本任务文件（25 个已跟踪修改、42 个新增）：contracts、config、数据库导出模型和 migration、reports 服务、API/controllers/guard、独立 exporter、Vue 查询与权限页面、受影响测试、依赖锁文件、任务文档和落地规格。

排除：主工作树 auth-live-fix 两份延期文件、主工作树原规划副本、第 7 项工作树的 `AGENTS.md`、所有 `.env`/QA 会话/导出文件/截图/原始日志。不自动推送、合并、删工作树或开始第 9 项。

首次验收汇报时尚未执行 commit/push/archive/merge。用户本次批准后，按工作提交 -> 任务归档提交 -> journal 提交的顺序执行；本记录随工作提交固化，不提前编造提交哈希，实际哈希及完成回执见 Git 和 `.trellis/workspace/holego/` 的会话记录。推送和合并仍需各自授权。
