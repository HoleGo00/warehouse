CREATE TYPE "InventoryMovementSource" AS ENUM (
  'ONLINE_REQUEST',
  'EXPRESS_REQUEST',
  'OFFLINE_REQUEST',
  'ADMIN_INBOUND',
  'ADMIN_RETURN',
  'ADMIN_TRANSFER',
  'ADMIN_STOCKTAKE',
  'MIGRATION'
);

CREATE TYPE "InventoryOperationType" AS ENUM ('INBOUND', 'TRANSFER', 'STOCKTAKE');
CREATE TYPE "InventoryInboundType" AS ENUM ('PURCHASE', 'OTHER');

ALTER TABLE "inventory_movements"
  ALTER COLUMN "source" TYPE "InventoryMovementSource"
  USING (
    CASE "source"::text
      WHEN 'ONLINE' THEN 'ONLINE_REQUEST'
      WHEN 'EXPRESS' THEN 'EXPRESS_REQUEST'
      WHEN 'OFFLINE' THEN 'OFFLINE_REQUEST'
    END
  )::"InventoryMovementSource";

CREATE TABLE "inventory_operations" (
  "id" UUID NOT NULL,
  "operation_number" TEXT NOT NULL,
  "type" "InventoryOperationType" NOT NULL,
  "inbound_type" "InventoryInboundType",
  "warehouse_id" UUID,
  "source_warehouse_id" UUID,
  "destination_warehouse_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_operation_lines" (
  "id" UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "quantity" INTEGER,
  "system_quantity" INTEGER,
  "counted_quantity" INTEGER,
  "difference" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_operation_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_movements" ADD COLUMN "operation_id" UUID;
ALTER TABLE "admin_tasks" ADD COLUMN "deduplication_key" TEXT;

CREATE UNIQUE INDEX "inventory_operations_operation_number_key"
  ON "inventory_operations"("operation_number");
CREATE INDEX "inventory_operations_type_occurred_at_idx"
  ON "inventory_operations"("type", "occurred_at");
CREATE INDEX "inventory_operations_warehouse_id_occurred_at_idx"
  ON "inventory_operations"("warehouse_id", "occurred_at");
CREATE INDEX "inventory_operations_source_warehouse_id_occurred_at_idx"
  ON "inventory_operations"("source_warehouse_id", "occurred_at");
CREATE UNIQUE INDEX "inventory_operation_lines_operation_id_variant_id_key"
  ON "inventory_operation_lines"("operation_id", "variant_id");
CREATE INDEX "inventory_operation_lines_variant_id_idx"
  ON "inventory_operation_lines"("variant_id");
CREATE INDEX "inventory_movements_operation_id_idx"
  ON "inventory_movements"("operation_id");
CREATE UNIQUE INDEX "admin_tasks_deduplication_key_key"
  ON "admin_tasks"("deduplication_key");

ALTER TABLE "inventory_operations"
  ADD CONSTRAINT "inventory_operations_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_operations"
  ADD CONSTRAINT "inventory_operations_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_operations"
  ADD CONSTRAINT "inventory_operations_source_warehouse_id_fkey"
  FOREIGN KEY ("source_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_operations"
  ADD CONSTRAINT "inventory_operations_destination_warehouse_id_fkey"
  FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_operation_lines"
  ADD CONSTRAINT "inventory_operation_lines_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "inventory_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_operation_lines"
  ADD CONSTRAINT "inventory_operation_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "inventory_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
