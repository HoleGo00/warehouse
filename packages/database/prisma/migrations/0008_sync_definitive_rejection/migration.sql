ALTER TYPE "FeishuSyncWriteStatus" ADD VALUE 'REJECTED';
ALTER TABLE "feishu_sync_writes"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error_code" TEXT;
