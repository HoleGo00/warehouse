# 商品图片、库存查询与仓库二维码技术设计

## 1. 边界

本任务跨 `packages/contracts`、`packages/database`、`apps/api` 和 `apps/web`，但只新增商品管理和只读库存能力。库存数量变化继续只能经过现有 `InventoryService`；本任务不得直接更新 `inventory_balances`，不得启动 worker 或写真实飞书 Base。

真实 OAuth 尚未部署不改变接口安全模型：所有商品管理、库存和图片内容接口继续使用 `SessionGuard`；商品写操作额外使用 `SystemAdminGuard`。HTTP 测试使用现有 fake session port，浏览器测试使用受控测试会话，不增加生产认证绕过开关。

## 2. Contracts

在 `packages/contracts` 增加以下共享 schema：

- `catalogProductSchema`：商品 ID/code/name/category/specificationMode/status、图片就绪状态、主图 URL、详情图元数据。
- `catalogVariantSchema`：variant ID/code/displayName/size/isActive。
- `catalogMutationSchema`：创建/更新商品允许字段，禁止浏览器提交数据库 ID、飞书 record ID 或附件临时 URL。
- `inventoryQuerySchema`：仓库 `XIHU | YUHANG | ALL` 和可选商品类别。
- `inventoryProductSchema`：商品信息、按仓库/规格组织的数量、汇总数量与同步标识。
- `warehouseEntrySchema`：仓库 code/name、稳定 apply path、完整公开 URL 和二维码 URL。

响应在 API 边界以 Zod 解码；Web 只消费这些类型。

## 3. Database Services

### 3.1 CatalogService

新增 `packages/database/src/catalog/catalog-service.ts`：

- `listCatalog({ includeInactive })` 查询商品、类别、规格、排序后的图片引用。
- `listSelectableCatalog()` 只返回 `Product.status=ACTIVE`、`ProductVariant.isActive=true` 且存在主图的商品。
- `createProduct(command)` 在事务中创建商品和规格。指环固定生成 6# 至 13#；腕表生成 `DEFAULT` 无尺码规格。
- `updateProduct(command)` 只更新允许字段；停用商品同步停用规格，重新启用前验证主图存在。
- 不提供硬删除 API；唯一 code/variantKey 冲突转换为稳定领域错误。

### 3.2 InventoryQueryService

新增只读查询服务，按一次 Prisma 查询读取仓库、商品、规格、图片引用和余额：

- 单仓模式返回目标仓各规格数量。
- `ALL` 模式同时返回西湖、余杭和逐规格汇总，不能只返回合计而丢失仓库明细。
- 每个余额使用共享 `calculateAvailability` 计算；`pendingMovementDelta !== 0` 映射为 `PENDING_LOCAL_CHANGES`。
- 查询包含停用/历史停用商品；选择接口另行过滤，避免在多个控制器重复业务条件。

## 4. API

新增 Nest feature modules：

- `GET /catalog`：登录员工可读，默认包含停用商品。
- `GET /catalog/selectable`：登录员工可读，仅返回后续申领可选商品。
- `POST /catalog`、`PUT /catalog/:productId`：仅系统管理员。
- `GET /inventory?warehouse=ALL&category=SMART_RING`：所有登录员工可读。
- `GET /catalog/images/:imageRefId`：登录员工读取图片内容；provider 不可用时返回稳定 `IMAGE_UNAVAILABLE`，不得泄漏 token/CLI stderr。
- `GET /warehouses/entries`：返回两个稳定入口及二维码地址。
- `GET /warehouses/:warehouseCode/qr.svg`：根据 `WEB_PUBLIC_URL` 生成 SVG，内容仅为 `/w/:warehouseCode/apply`。

二维码使用成熟 QR 编码库，不手写编码算法。响应限制为 SVG，设置安全的 `Content-Disposition` 文件名和缓存头。

## 5. Image Provider

定义 `ProductImageContentProvider` port：输入本地 `ProductImageRef`，输出受限的 binary stream/byte array、MIME 类型和可选 ETag。

- 本任务实现测试 provider 和不可用 provider，以验证代理边界和缺图体验。
- 正式飞书附件下载 provider 由第 7 个 `lark-cli Gateway` 任务接入，API 控制器本身不执行子进程。
- 不把本地素材复制进生产仓库，不把飞书临时 URL 下发浏览器。

## 6. Web

引入 Vue Router，保留 `AuthShell` 负责会话恢复，将登录后的工作区拆成应用外壳与三个路由区域：

- `/inventory`：仓库分段控件（全部/西湖/余杭）、品类 tabs、指环矩阵、腕表列表、同步状态和缺图状态。
- `/w/:warehouseCode/apply`：显示锁定仓库和正常/临时两个入口，申请表单留给后续任务。
- `/admin/catalog`：系统管理员商品列表与新增/编辑表单；非系统管理员不显示入口且 API 继续强制鉴权。

界面保持仓储工具属性：紧凑、可扫描、低装饰；不使用营销 Hero、嵌套卡片或单色大面积主题。桌面和移动端使用稳定 grid/表格尺寸，指环矩阵允许横向滚动但不能遮挡标签。

## 7. Compatibility

- 认证 return path 当前已白名单 `/w/XIHU/apply` 和 `/w/YUHANG/apply`，继续使用大写 warehouse code，避免破坏现有测试和已生成链接。
- `Warehouse.publicSlug` 保留给未来自定义公开别名，本任务不改变现有数据库值。
- 新合同字段全部新增，不改变现有认证响应。
- 如需 Prisma 变更，只允许新增索引或支持字段，并创建新迁移；不得修改已应用迁移。

## 8. Failure And Rollback

- 无主图：库存仍可查询，商品不进入 selectable，页面显示缺图。
- 图片 provider 失败：返回稳定错误或图片失败状态，不影响库存 JSON。
- 非法仓库/品类：边界 Zod 校验失败，不进入数据库查询。
- 二维码域名缺失或生产环境不是 HTTPS：API 拒绝生成正式二维码并返回配置错误。
- 回滚可按 feature module 撤销；不涉及库存写入或真实飞书写入，因此没有外部数据补偿。
