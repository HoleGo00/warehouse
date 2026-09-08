CREATE TYPE "FeishuBindingEnvironment" AS ENUM ('TEST', 'FORMAL');
CREATE TYPE "FeishuTableKind" AS ENUM ('PRODUCT', 'BALANCE', 'MOVEMENT');
CREATE TYPE "FeishuBindingStatus" AS ENUM ('PREPARED', 'ACTIVE', 'ROLLED_BACK');
CREATE TYPE "InventoryMigrationMode" AS ENUM ('DRY_RUN', 'TEST', 'FORMAL_SHADOW', 'FINAL_DELTA');
CREATE TYPE "InventoryMigrationStatus" AS ENUM ('PLANNED', 'RUNNING', 'RECONCILING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "FeishuSyncWriteStatus" AS ENUM ('INTENT', 'CONFIRMED', 'UNCERTAIN');

ALTER TABLE "inventory_balances"
  ADD COLUMN "movement_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "confirmed_movement_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "confirmed_last_movement_id" UUID;
ALTER TABLE "inventory_movements" ADD COLUMN "balance_sequence" INTEGER;
CREATE UNIQUE INDEX "inventory_movements_warehouse_id_variant_id_balance_sequence_key"
  ON "inventory_movements" ("warehouse_id", "variant_id", "balance_sequence");
ALTER TABLE "outbox_jobs" ADD COLUMN "lease_token" UUID;
ALTER TABLE "outbox_job_steps"
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "started_at" TIMESTAMPTZ(3),
  ADD COLUMN "result" JSONB;
ALTER TABLE "inventory_reconciliations"
  ADD COLUMN "target" "OutboxStepTarget",
  ADD COLUMN "confirmed_feishu_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pending_movement_delta" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "remote_record_id" TEXT,
  ADD COLUMN "binding_id" UUID,
  ADD COLUMN "schema_version" INTEGER,
  ADD COLUMN "job_id" UUID,
  ADD COLUMN "migration_batch_id" TEXT,
  ADD COLUMN "evidence" JSONB;

CREATE TABLE "feishu_table_bindings" (
  "id" UUID NOT NULL,
  "target" "OutboxStepTarget" NOT NULL,
  "kind" "FeishuTableKind" NOT NULL,
  "environment" "FeishuBindingEnvironment" NOT NULL,
  "base_token" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "schema_fingerprint" TEXT NOT NULL,
  "field_ids" JSONB NOT NULL,
  "status" "FeishuBindingStatus" NOT NULL DEFAULT 'PREPARED',
  "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ(3),
  "rolled_back_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "feishu_table_bindings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "feishu_table_bindings_environment_target_kind_schema_version_key"
  ON "feishu_table_bindings" ("environment", "target", "kind", "schema_version");
CREATE UNIQUE INDEX "feishu_table_bindings_base_token_table_id_key"
  ON "feishu_table_bindings" ("base_token", "table_id");
CREATE UNIQUE INDEX "feishu_table_bindings_active_target_kind_key"
  ON "feishu_table_bindings" ("environment", "target", "kind") WHERE "status" = 'ACTIVE';

CREATE TABLE "inventory_migration_batches" (
  "id" UUID NOT NULL,
  "batch_key" TEXT NOT NULL,
  "mode" "InventoryMigrationMode" NOT NULL,
  "status" "InventoryMigrationStatus" NOT NULL DEFAULT 'PLANNED',
  "source_snapshot" JSONB NOT NULL,
  "expected_summary" JSONB,
  "actual_summary" JSONB,
  "anomaly_summary" JSONB,
  "freeze_confirmed_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "report_path" TEXT,
  "last_error_code" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_migration_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_migration_batches_batch_key_key" ON "inventory_migration_batches" ("batch_key");
CREATE TABLE "inventory_migration_sources" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "source_target" "OutboxStepTarget" NOT NULL,
  "source_table_id" TEXT NOT NULL,
  "source_record_id" TEXT NOT NULL,
  "semantic_kind" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "movement_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_migration_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_migration_sources_batch_id_fkey" FOREIGN KEY ("batch_id")
    REFERENCES "inventory_migration_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_migration_sources_source_key"
  ON "inventory_migration_sources"("source_target", "source_table_id", "source_record_id", "semantic_kind");
CREATE UNIQUE INDEX "inventory_migration_sources_movement_id_key" ON "inventory_migration_sources"("movement_id");
CREATE INDEX "inventory_migration_sources_batch_id_idx" ON "inventory_migration_sources"("batch_id");

CREATE TABLE "feishu_sync_writes" (
  "id" UUID NOT NULL,
  "binding_id" UUID NOT NULL,
  "stable_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  "status" "FeishuSyncWriteStatus" NOT NULL DEFAULT 'INTENT',
  "record_id" TEXT,
  "owner_token" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "feishu_sync_writes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "feishu_sync_writes_binding_id_fkey" FOREIGN KEY ("binding_id")
    REFERENCES "feishu_table_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "feishu_sync_writes_binding_id_stable_key_key" ON "feishu_sync_writes" ("binding_id", "stable_key");

-- Existing movement order is inferred only where the before/after chain is unique.
-- Ambiguous chains remain NULL and are blocked by the synchronizer for manual review.
DO $$
DECLARE balance RECORD; cursor_row RECORD; ids UUID[]; candidates UUID[]; n INTEGER;
BEGIN
  FOR balance IN SELECT * FROM inventory_balances WHERE last_movement_id IS NOT NULL LOOP
    ids := ARRAY[]::UUID[];
    SELECT * INTO cursor_row FROM inventory_movements WHERE id = balance.last_movement_id;
    WHILE FOUND AND cursor_row.id IS NOT NULL LOOP
      ids := array_prepend(cursor_row.id, ids);
      SELECT array_agg(id) INTO candidates FROM inventory_movements
      WHERE warehouse_id = balance.warehouse_id AND variant_id = balance.variant_id
        AND id <> ALL(ids) AND quantity_after = cursor_row.quantity_before;
      IF coalesce(cardinality(candidates), 0) <> 1 THEN EXIT; END IF;
      SELECT * INTO cursor_row FROM inventory_movements WHERE id = candidates[1];
    END LOOP;
    SELECT count(*) INTO n FROM inventory_movements
      WHERE warehouse_id = balance.warehouse_id AND variant_id = balance.variant_id;
    IF cardinality(ids) = n THEN
      FOR i IN 1..n LOOP
        UPDATE inventory_movements SET balance_sequence = i WHERE id = ids[i];
      END LOOP;
      UPDATE inventory_balances SET movement_sequence = n WHERE id = balance.id;
      UPDATE inventory_balances SET
        confirmed_movement_sequence = coalesce((
          SELECT max(balance_sequence) FROM inventory_movements
          WHERE warehouse_id = balance.warehouse_id AND variant_id = balance.variant_id
            AND sync_status = 'SYNCED'
        ), 0),
        confirmed_last_movement_id = (
          SELECT id FROM inventory_movements
          WHERE warehouse_id = balance.warehouse_id AND variant_id = balance.variant_id
            AND sync_status = 'SYNCED' ORDER BY balance_sequence DESC LIMIT 1
        )
        WHERE id = balance.id;
    END IF;
  END LOOP;
END $$;
