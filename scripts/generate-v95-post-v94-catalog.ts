/**
 * Dev-only generator. Recomputes encoding-v2 digests from the committed
 * typed fixture rows (no CSV required). Optionally accepts a CSV path.
 * Does not connect to a database.
 *
 * npx tsx --tsconfig tsconfig.json scripts/generate-v95-post-v94-catalog.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalogFingerprint,
  ENCODING_VERSION,
  loadValidatedCatalog,
  renderV95CatalogGuardDoBlock,
  type CatalogFixture,
  type InventoryRow,
} from "../src/lib/matching/v95PostV94Catalog";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const outPath = join(
  repoRoot,
  "src/lib/matching/v95PostV94Catalog.fixture.json",
);
const csvPath = process.argv[2];

const existing = JSON.parse(readFileSync(outPath, "utf8")) as CatalogFixture;
const rows: InventoryRow[] = csvPath
  ? loadValidatedCatalog(readFileSync(csvPath, "utf8"), existing.source).rows
  : existing.rows;

const first = buildCatalogFingerprint(rows, existing.source);
const second = buildCatalogFingerprint(rows, existing.source);
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error("generator is not deterministic");
}
if (first.encoding_version !== ENCODING_VERSION) {
  throw new Error("encoding version mismatch");
}

const fixture: CatalogFixture = {
  ...first,
  rows,
};
writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

const migrationPath = join(
  repoRoot,
  "supabase/migrations/20260911000003_create_contact_invitation_boundary_v95.sql",
);
const inventoryPath = join(
  repoRoot,
  "supabase/migrations/20260911000003_v95_preapply_catalog_inventory.verify.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const inventorySql = readFileSync(inventoryPath, "utf8");
const guard = renderV95CatalogGuardDoBlock(inventorySql, first);
const start = migration.search(/\bDO\s+\$\$/i);
const end = migration.indexOf("END $$;", start);
if (start < 0 || end < 0) {
  throw new Error("v95 guard DO block not found");
}
const next = `${migration.slice(0, start)}${guard}${migration.slice(end + "END $$;".length)}`;
writeFileSync(migrationPath, next, "utf8");

console.log(`wrote ${outPath}`);
console.log(`updated ${migrationPath}`);
console.log(`encoding_version=${first.encoding_version}`);
console.log(`rows=${first.row_count}`);
console.log(JSON.stringify(first.regions, null, 2));
console.log("overall", first.overall);
