# Inventory and Catalog UI

## Scenario: Authenticated warehouse tools

### 1. Scope / Trigger

Use this specification for authenticated inventory, warehouse-entry, product-image,
or catalog-administration views. The UI is an operational tool: information density,
stable layout, and explicit state are more important than decorative presentation.

### 2. Signatures

- `createInventoryApi().query(query, signal?)` parses `inventoryQueryResponseSchema`.
- `createCatalogApi()` exposes `list`, `create`, and `update` with shared schemas.
- `createWarehousesApi()` exposes `listEntries` and `qrDownloadUrl`.
- `useInventoryQuery()` exposes writable `warehouse` and `category`, read-only
  `status`, `result`, and `errorMessage`, plus `reload()`.
- Routes are `/inventory`, `/w/:warehouseCode/apply`, and `/admin/catalog`.

### 3. Contracts

- All API success and error payloads are parsed from `@glorychips/contracts`.
- A missing main image displays `未配置主图`; an image request failure displays
  `主图加载失败`. Neither state may substitute a generic product image.
- Ring inventory uses a fixed `6#` through `13#` matrix. Watch inventory has no size input.
- Long matrices, tables, and mobile navigation may scroll inside their own containers;
  the document itself must not gain horizontal overflow.
- Icon-only actions have an accessible name and tooltip. Buttons, links, inputs, and
  selects share a visible `:focus-visible` treatment.

### 4. Validation & Error Matrix

- `AUTH_REQUIRED` is handled by the authentication shell, preserving the current safe return path.
- API/schema failure -> visible page error and retry action; no stack trace is rendered.
- Invalid warehouse route -> explicit invalid-entry state without an API mutation.
- Direct non-admin access to `/admin/catalog` -> visible forbidden state; the API remains authoritative.
- Aborted or stale inventory request -> ignore its result and keep the newest filter response.

### 5. Good/Base/Bad Cases

- Good: rapid XIHU/YUHANG changes display only the newest response.
- Base: zero inventory and historical inactive watches remain visible with status labels.
- Bad: an old slow request overwrites the response for the currently selected filter.
- Bad: a broken `<img>` icon is the only signal that the image provider failed.

### 6. Tests Required

- API adapters test URL, credentials, payload parsing, and stable error parsing.
- Inventory view-model tests cover status labels, pending state, and quantity summaries.
- Composable tests cover loading, error, reload, abort, and stale-response ordering.
- Browser acceptance covers 1440x900 and 390x844, both product types, long names,
  historical status, missing/failed images, pending sync, valid/invalid warehouse
  routes, QR download, admin create/edit, keyboard focus, and overflow boundaries.

### 7. Wrong vs Correct

#### Wrong

```ts
result.value = await api.query(filters);
```

Every response can win, including an obsolete slow request.

#### Correct

```ts
const requestId = ++latestRequestId;
const response = await api.query(filters, signal);
if (!signal?.aborted && requestId === latestRequestId) result.value = response;
```

