/**
 * Dev-only generator. Reads the live inventory CSV, validates it, and
 * writes the frozen catalog fixture. Does not connect to a database.
 *
 * npx tsx --tsconfig tsconfig.json scripts/generate-v95-post-v94-catalog.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadValidatedCatalog,
  renderV95CatalogGuardDoBlock,
  type CatalogFixture,
} from "../src/lib/matching/v95PostV94Catalog";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const csvPath =
  process.argv[2] ??
  "C:\\Users\\Administrator\\Downloads\\Supabase Snippet Untitled query (25).csv";
const outPath = join(
  repoRoot,
  "src/lib/matching/v95PostV94Catalog.fixture.json",
);

const csv = readFileSync(csvPath, "utf8");
const { rows, fingerprint } = loadValidatedCatalog(
  csv,
  "Supabase Snippet Untitled query (25).csv",
);
const fixture: CatalogFixture = {
  ...fingerprint,
  rows,
};
const first = JSON.stringify(fixture);
const second = JSON.stringify({
  ...loadValidatedCatalog(csv, fingerprint.source).fingerprint,
  rows,
});
if (first !== second) {
  throw new Error("generator is not deterministic");
}
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
const guard = renderV95CatalogGuardDoBlock(inventorySql, fingerprint);
const start = migration.search(/\bDO\s+\$\$/i);
const end = migration.indexOf("END $$;", start);
if (start < 0 || end < 0) {
  throw new Error("v95 guard DO block not found");
}
const next = `${migration.slice(0, start)}${guard}${migration.slice(end + "END $$;".length)}`;
writeFileSync(migrationPath, next, "utf8");

console.log(`wrote ${outPath}`);
console.log(`updated ${migrationPath}`);
console.log(`rows=${fingerprint.row_count}`);
console.log(JSON.stringify(fingerprint.regions, null, 2));
console.log("overall", fingerprint.overall);
