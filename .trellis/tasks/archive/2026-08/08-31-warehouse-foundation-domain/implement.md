# 工程与核心库存领域基线实施计划

1. 初始化 Git、`.gitignore`、Node/pnpm 版本文件和 workspace 根配置。
2. 创建 web、api、worker 和共享 packages，统一 TypeScript、lint、format、test、build 配置。
3. 建立 PostgreSQL Docker Compose、配置校验、Prisma schema 和首个迁移。
4. 编写幂等 seed，初始化仓库、角色、产品、别名和 variant。
5. 实现数据库事务 helper、库存计算、行锁、预占、流水、调拨、幂等和 outbox 原子写入。
6. 编写单元测试和真实 PostgreSQL 集成测试，包括并发超卖与整单回滚。
7. 完成 web/api/worker 最小健康检查和运行说明。
8. 补全本项目 backend/frontend Trellis 规范中的实际目录、类型和质量约定。
9. 运行全量 lint、typecheck、unit、integration、build、`git diff --check` 和敏感文件检查。

## Validation Commands

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
docker compose config
git diff --check
```

## Rollback Points

- 工程脚手架完成后提交一个独立基线提交。
- Prisma 首个迁移在进入后续子任务前必须可以在空数据库完整重建。
- 若库存并发测试不稳定，不允许以跳过测试的方式启动下一子任务。
