# Historical Migration Fixture

Immutable, business-only source projection captured on 2026-09-04. It contains
product/size, quantities, business dates and types, but no claimants, destinations
or remarks. The twelve source files were copied unchanged from the task's
`research/live-baseline/`; SHA-256 equality was checked on 2026-09-08 before
formatting. Manifests were then formatted with Prettier and parsed JSON equality
was verified; NDJSON files remain byte-identical to the captured source.

The fixture deliberately retains the 715-row historical baseline. Tests must
recalculate its totals, not treat them as current production inventory. Manifest
export paths are historical provenance only, never runtime input paths.

Tests load this package-owned directory so task archival cannot break them.
