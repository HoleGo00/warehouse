CREATE TYPE "RequestExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');
CREATE TABLE "request_exports" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "filters" JSONB NOT NULL,
  "filter_hash" TEXT NOT NULL,
  "warehouses" TEXT[] NOT NULL,
  "status" "RequestExportStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_until" TIMESTAMPTZ(3),
  "snapshot_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "file_key" TEXT,
  "file_size" INTEGER,
  "file_hash" TEXT,
  "summary_count" INTEGER NOT NULL DEFAULT 0,
  "detail_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "request_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "request_exports_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "request_exports_status_lease_until_created_at_idx" ON "request_exports"("status", "lease_until", "created_at");
CREATE INDEX "request_exports_actor_user_id_created_at_idx" ON "request_exports"("actor_user_id", "created_at");
CREATE INDEX "request_exports_expires_at_idx" ON "request_exports"("expires_at");
CREATE INDEX "requests_report_submitted_idx" ON "requests"("warehouse_id", (COALESCE("submitted_at", "created_at")) DESC, "id" DESC);
CREATE INDEX "requests_report_all_submitted_idx" ON "requests"((COALESCE("submitted_at", "created_at")) DESC, "id" DESC);
CREATE INDEX "fulfillments_report_date_idx" ON "fulfillments"("fulfilled_at" DESC, "request_id");
CREATE INDEX "request_items_report_product_idx" ON "request_items"("product_id", "size_snapshot", "request_id");
