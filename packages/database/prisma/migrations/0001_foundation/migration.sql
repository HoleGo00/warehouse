-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('CLAIMANT', 'WAREHOUSE_ADMIN', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "ProductCategoryCode" AS ENUM ('SMART_RING', 'SMART_WATCH');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'INACTIVE_HISTORICAL');

-- CreateEnum
CREATE TYPE "SpecificationMode" AS ENUM ('RING_SIZE', 'NONE');

-- CreateEnum
CREATE TYPE "BaseTarget" AS ENUM ('RING', 'WATCH');

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('MAIN', 'DETAIL');

-- CreateEnum
CREATE TYPE "RequestOrigin" AS ENUM ('ONLINE', 'OFFLINE', 'EXPRESS');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('INTERNAL', 'GIFT', 'SALE', 'EXHIBIT');

-- CreateEnum
CREATE TYPE "ReturnMode" AS ENUM ('NOT_REQUIRED', 'BY_DATE', 'ON_DEPARTURE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PENDING_RELEASE', 'PENDING_PAPERWORK', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('INBOUND', 'ISSUE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'STOCKTAKE_GAIN', 'STOCKTAKE_LOSS', 'MIGRATION_OPENING');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReturnTrigger" AS ENUM ('DATE', 'DEPARTURE');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'WAIVED');

-- CreateEnum
CREATE TYPE "AdminTaskType" AS ENUM ('PAPERWORK_REQUIRED', 'PAPERWORK_OVERDUE', 'RETURN_DUE', 'RETURN_OVERDUE', 'SYNC_EXCEPTION');

-- CreateEnum
CREATE TYPE "AdminTaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TaskSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OutboxJobType" AS ENUM ('SYNC_INVENTORY_MOVEMENTS', 'RECONCILE_INVENTORY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "OutboxStepTarget" AS ENUM ('RING_BASE', 'WATCH_BASE');

-- CreateEnum
CREATE TYPE "OutboxStepStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'RETRY', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_key" TEXT NOT NULL,
    "feishu_user_id" TEXT,
    "feishu_open_id" TEXT,
    "feishu_union_id" TEXT,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "department_snapshot" JSONB,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_admin_scopes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_admin_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "code" "ProductCategoryCode" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "official_name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "specification_mode" "SpecificationMode" NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "base_target" "BaseTarget" NOT NULL,
    "feishu_product_record_id" TEXT,
    "image_sync_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_aliases" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LEGACY_FEISHU',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "specification_mode" "SpecificationMode" NOT NULL,
    "size" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image_refs" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attachment_token" TEXT NOT NULL,
    "kind" "ImageKind" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "file_name" TEXT,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "confirmed_feishu_quantity" INTEGER NOT NULL DEFAULT 0,
    "pending_movement_delta" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "last_movement_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "line_key" TEXT NOT NULL,
    "request_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "business_number" TEXT NOT NULL,
    "request_id" UUID,
    "transfer_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "source" "RequestOrigin" NOT NULL,
    "actor_user_id" UUID,
    "actor_feishu_user_id" TEXT,
    "actor_name_snapshot" TEXT,
    "source_table_id" TEXT,
    "source_record_id" TEXT,
    "source_name_snapshot" TEXT,
    "migration_batch_id" TEXT,
    "migration_occurred_at" TIMESTAMPTZ(3),
    "history_order_rebuilt" BOOLEAN NOT NULL DEFAULT false,
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reconciliations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "local_effective_quantity" INTEGER NOT NULL,
    "feishu_quantity" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "inventory_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "claimant_id" UUID NOT NULL,
    "origin" "RequestOrigin" NOT NULL,
    "type" "RequestType" NOT NULL,
    "purpose_object" TEXT,
    "final_destination" TEXT,
    "notes" TEXT,
    "return_mode" "ReturnMode" NOT NULL DEFAULT 'NOT_REQUIRED',
    "expected_return_date" DATE,
    "status" "RequestStatus" NOT NULL,
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "submitted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_items" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "size_snapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "previous_status" "RequestStatus" NOT NULL,
    "next_status" "RequestStatus" NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "executor_id" UUID NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'COMPLETED',
    "fulfilled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_obligations" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "trigger" "ReturnTrigger" NOT NULL,
    "due_date" DATE,
    "required_quantity" INTEGER NOT NULL,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "processor_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_calendar_days" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "is_working_day" BOOLEAN NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_tasks" (
    "id" UUID NOT NULL,
    "type" "AdminTaskType" NOT NULL,
    "severity" "TaskSeverity" NOT NULL,
    "status" "AdminTaskStatus" NOT NULL DEFAULT 'OPEN',
    "warehouse_id" UUID,
    "request_id" UUID,
    "assignee_id" UUID,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "warehouse_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response" JSONB,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" UUID NOT NULL,
    "type" "OutboxJobType" NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" TEXT,
    "last_error_code" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_job_steps" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "target" "OutboxStepTarget" NOT NULL,
    "status" "OutboxStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "feishu_record_id" TEXT,
    "last_error" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feishu_mappings" (
    "id" UUID NOT NULL,
    "local_entity_type" TEXT NOT NULL,
    "local_entity_id" TEXT NOT NULL,
    "base_token" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "migration_batch_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feishu_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_feishu_user_id_key" ON "users"("feishu_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_feishu_open_id_key" ON "users"("feishu_open_id");

-- CreateIndex
CREATE INDEX "users_tenant_key_status_idx" ON "users"("tenant_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_public_slug_key" ON "warehouses"("public_slug");

-- CreateIndex
CREATE INDEX "warehouse_admin_scopes_warehouse_id_idx" ON "warehouse_admin_scopes"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_admin_scopes_user_id_warehouse_id_key" ON "warehouse_admin_scopes"("user_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_code_key" ON "product_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");

-- CreateIndex
CREATE INDEX "product_aliases_product_id_idx" ON "product_aliases"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_aliases_source_alias_key" ON "product_aliases"("source", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_variant_key_key" ON "product_variants"("variant_key");

-- CreateIndex
CREATE INDEX "product_variants_product_id_is_active_idx" ON "product_variants"("product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_code_key" ON "product_variants"("product_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_refs_product_id_kind_sort_order_key" ON "product_image_refs"("product_id", "kind", "sort_order");

-- A product has at most one main image; detail images may have multiple sort orders.
CREATE UNIQUE INDEX "product_image_refs_one_main_per_product_key"
  ON "product_image_refs"("product_id")
  WHERE "kind" = 'MAIN';

-- CreateIndex
CREATE INDEX "inventory_balances_variant_id_idx" ON "inventory_balances"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_warehouse_id_variant_id_key" ON "inventory_balances"("warehouse_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_line_key_key" ON "inventory_reservations"("line_key");

-- CreateIndex
CREATE INDEX "inventory_reservations_batch_id_status_idx" ON "inventory_reservations"("batch_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_warehouse_id_variant_id_status_idx" ON "inventory_reservations"("warehouse_id", "variant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_deduplication_key_key" ON "inventory_movements"("deduplication_key");

-- CreateIndex
CREATE INDEX "inventory_movements_warehouse_id_variant_id_occurred_at_idx" ON "inventory_movements"("warehouse_id", "variant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movements_business_number_idx" ON "inventory_movements"("business_number");

-- CreateIndex
CREATE INDEX "inventory_movements_request_id_idx" ON "inventory_movements"("request_id");

-- CreateIndex
CREATE INDEX "inventory_movements_transfer_id_idx" ON "inventory_movements"("transfer_id");

-- CreateIndex
CREATE INDEX "inventory_movements_actor_user_id_idx" ON "inventory_movements"("actor_user_id");

-- CreateIndex
CREATE INDEX "inventory_reconciliations_status_checked_at_idx" ON "inventory_reconciliations"("status", "checked_at");

-- CreateIndex
CREATE INDEX "inventory_reconciliations_warehouse_id_variant_id_idx" ON "inventory_reconciliations"("warehouse_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "requests_request_number_key" ON "requests"("request_number");

-- CreateIndex
CREATE INDEX "requests_warehouse_id_status_created_at_idx" ON "requests"("warehouse_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "requests_claimant_id_created_at_idx" ON "requests"("claimant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_items_request_id_variant_id_key" ON "request_items"("request_id", "variant_id");

-- CreateIndex
CREATE INDEX "approval_records_request_id_reviewed_at_idx" ON "approval_records"("request_id", "reviewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_request_id_key" ON "fulfillments"("request_id");

-- CreateIndex
CREATE INDEX "return_obligations_status_due_date_idx" ON "return_obligations"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "return_obligations_request_id_variant_id_key" ON "return_obligations"("request_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_movement_id_key" ON "returns"("movement_id");

-- CreateIndex
CREATE INDEX "returns_obligation_id_returned_at_idx" ON "returns"("obligation_id", "returned_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_calendar_days_date_key" ON "work_calendar_days"("date");

-- CreateIndex
CREATE INDEX "admin_tasks_status_severity_due_at_idx" ON "admin_tasks"("status", "severity", "due_at");

-- CreateIndex
CREATE INDEX "admin_tasks_warehouse_id_status_idx" ON "admin_tasks"("warehouse_id", "status");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_warehouse_id_created_at_idx" ON "audit_logs"("warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_operation_created_at_idx" ON "idempotency_keys"("operation", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_idempotency_key_key" ON "outbox_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_jobs_status_available_at_idx" ON "outbox_jobs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_job_steps_job_id_target_key" ON "outbox_job_steps"("job_id", "target");

-- CreateIndex
CREATE INDEX "feishu_mappings_migration_batch_id_idx" ON "feishu_mappings"("migration_batch_id");


-- CreateIndex
CREATE UNIQUE INDEX "feishu_mappings_local_entity_type_local_entity_id_base_toke_key" ON "feishu_mappings"("local_entity_type", "local_entity_id", "base_token", "table_id");

-- CreateIndex
CREATE UNIQUE INDEX "feishu_mappings_base_token_table_id_record_id_key" ON "feishu_mappings"("base_token", "table_id", "record_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_admin_scopes" ADD CONSTRAINT "warehouse_admin_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_admin_scopes" ADD CONSTRAINT "warehouse_admin_scopes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_refs" ADD CONSTRAINT "product_image_refs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_claimant_id_fkey" FOREIGN KEY ("claimant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_executor_id_fkey" FOREIGN KEY ("executor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_obligations" ADD CONSTRAINT "return_obligations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_obligations" ADD CONSTRAINT "return_obligations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "return_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_processor_id_fkey" FOREIGN KEY ("processor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_job_steps" ADD CONSTRAINT "outbox_job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "outbox_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product specification invariants are deliberately enforced in the database as well as in contracts.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_size_allowed_chk"
  CHECK ("size" IS NULL OR "size" IN ('6#', '7#', '8#', '9#', '10#', '11#', '12#', '13#'));

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_specification_shape_chk"
  CHECK (("specification_mode" = 'RING_SIZE' AND "size" IS NOT NULL)
      OR ("specification_mode" = 'NONE' AND "size" IS NULL));

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_nonnegative_reserved_chk"
  CHECK ("reserved_quantity" >= 0);

CREATE OR REPLACE FUNCTION enforce_variant_product_specification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product_mode "SpecificationMode";
BEGIN
  SELECT "specification_mode" INTO product_mode
  FROM "products"
  WHERE "id" = NEW."product_id";

  IF product_mode IS NULL OR product_mode <> NEW."specification_mode" THEN
    RAISE EXCEPTION 'Variant specification mode must match its product';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "product_variants_product_specification_fk"
AFTER INSERT OR UPDATE ON "product_variants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_variant_product_specification();
