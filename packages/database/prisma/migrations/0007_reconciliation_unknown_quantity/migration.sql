ALTER TABLE "inventory_reconciliations"
  ALTER COLUMN "feishu_quantity" DROP NOT NULL,
  ALTER COLUMN "difference" DROP NOT NULL;
