# Catalog, Inventory Query, and Warehouse Entry

## Scenario: Read-only inventory and catalog administration

### 1. Scope / Trigger

Use this specification when changing catalog management, product-image proxying,
read-only inventory projections, warehouse entry links, or QR generation. Inventory
mutation remains owned by `InventoryService`; these query paths must never set
balances or write Feishu Base records.

### 2. Signatures

- `CatalogService.listCatalog(includeInactive?: boolean)` returns all catalog rows by default.
- `CatalogService.listSelectableCatalog()` returns only active products with an active variant and main image.
- `CatalogService.createProduct(command)` and `updateProduct(productId, command)` are transactional.
- `InventoryQueryService.query({ warehouse, category? })` accepts `ALL | XIHU | YUHANG`.
- HTTP endpoints: `GET /catalog`, `GET /catalog/selectable`, `POST /catalog`,
  `PUT /catalog/:productId`, `GET /inventory`, `GET /catalog/images/:imageRefId`,
  `GET /warehouses/entries`, and `GET /warehouses/:warehouseCode/qr.svg`.

### 3. Contracts

- Wire payloads come from `@glorychips/contracts`; controllers do not redeclare them.
- Availability is `confirmedFeishuQuantity + pendingMovementDelta - reservedQuantity`.
- A quantity aggregate is `PENDING_LOCAL_CHANGES` when any contributing warehouse
  is pending, even when positive and negative deltas sum to zero.
- Browser image URLs are local `/catalog/images/:id` paths. Attachment tokens and
  Feishu temporary URLs never appear in a response.
- `WEB_PUBLIC_URL` is a clean HTTP(S) origin with no credentials, path, query, or
  fragment. Production requires a non-loopback HTTPS origin. Parsed values end in `/`.
- QR payloads contain only `${WEB_PUBLIC_URL}/w/XIHU/apply` or
  `${WEB_PUBLIC_URL}/w/YUHANG/apply`.

### 4. Validation & Error Matrix

- Invalid query, UUID, or mutation payload -> `VALIDATION_ERROR` / HTTP 400.
- Missing catalog, image, or warehouse row -> `CATALOG_NOT_FOUND` / HTTP 404.
- Duplicate product code -> `CATALOG_CONFLICT` / HTTP 409.
- Activation without a main image -> `PRODUCT_IMAGE_REQUIRED` / HTTP 409.
- Category change after inventory, request, reconciliation, return obligation, or
  return usage -> `CATALOG_CATEGORY_LOCKED` / HTTP 409.
- Unconfigured image provider -> `IMAGE_UNAVAILABLE` / HTTP 503 without token leakage.
- Invalid production public URL -> configuration parsing fails before the API starts.

### 5. Good/Base/Bad Cases

- Good: `ALL` returns XIHU, YUHANG, and per-variant totals while preserving a pending flag.
- Base: a product without a main image remains queryable but is excluded from selectable results.
- Bad: netting `-1` and `+1` to `0` and reporting `CONFIRMED` hides unsynchronized work.
- Bad: treating a localhost HTTPS URL as production-ready creates unusable printed QR material.

### 6. Tests Required

- Contract tests parse catalog, inventory, warehouse-entry, and API-error payloads.
- PostgreSQL tests cover ring/watch variant creation, historical products, main-image
  selection, two-warehouse totals, and offsetting pending deltas.
- HTTP tests cover employee reads, administrator writes, invalid filters, image-provider
  failures, and downloadable non-empty QR SVG responses.
- Configuration tests cover clean development origins and rejection of production
  loopback, credentials, path, query, and fragment values.

### 7. Wrong vs Correct

#### Wrong

```ts
const total = toQuantity(sumInputs(warehouses));
await Promise.all(variants.map((variant) => transaction.productVariant.update({ ... })));
```

This loses component pending state and runs concurrent statements on one interactive transaction.

#### Correct

```ts
const total = addQuantities(warehouses, warehouses.some(isPending));
for (const variant of variants) {
  await transaction.productVariant.update({ ... });
}
```

