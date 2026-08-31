# 产品图片存储调研

调研日期：2026-08-28

## 飞书能力

飞书多维表格支持附件字段。写入附件的基本流程为：

1. 将图片上传至目标多维表格素材空间，获取 `file_token`。
2. 将 `file_token` 写入产品记录的附件字段。
3. 网页展示时由后端根据附件 token 获取临时下载链接。

临时下载链接存在有效期，不能把临时 URL 当作永久产品图片地址保存。

## 推荐 V1 方案

- 在指环、腕表产品资料表中新增“主图”和“详情图”附件字段。
- 每个产品必须有一张主图，可选多张详情图。
- 系统管理员在网页后台上传、替换或排序图片。
- 后端通过飞书多维表格附件能力保存图片 token，通过受控接口刷新临时下载链接并返回给前端。
- 前端只访问本系统图片接口，不直接保存或长期缓存飞书临时下载 URL。
- V1 不额外引入对象存储，减少独立存储服务、迁移和权限维护成本。

## 产品决策

2026-08-28 已确认采用上述方案：飞书附件是唯一产品图片源，每款产品必须配置一张主图并可选多张详情图，由系统管理员在后台维护，V1 不引入额外对象存储。

## 权限与缓存

- 飞书素材上传、下载权限只配置给后端应用。
- 普通用户通过本系统查看产品图片，不获得飞书表编辑权限。
- 后端可短时缓存临时链接和图片响应，但缓存时间不得超过飞书链接有效期。
- 产品图片加载失败时显示统一占位图，不影响库存明细和申领操作。

## 官方资料

- [多维表格常见问题](https://open.feishu.cn/document/docs/bitable-v1/faq?lang=zh-CN)
- [更新记录](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update?lang=zh-CN)
- [多维表格记录数据结构](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/bitable-record-data-structure-overview?lang=zh-CN)
- [获取素材临时下载链接](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/batch_get_tmp_download_url?lang=zh-CN)
