/**
 * backfill_cfo_category.ts
 *
 * Backfills cfo_ruolo_category for all imported_companies rows that have
 * a cfo_ruolo value but no cfo_ruolo_category (e.g. German companies imported
 * before migration 009).
 *
 * Usage:
 *   npx tsx dashboard/scripts/backfill_cfo_category.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * dashboard/.env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import { computeRuoloCategory } from "../src/lib/groq-mapper";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 100;

async function main() {
  console.log("Fetching imported_companies with cfo_ruolo but no cfo_ruolo_category...");

  const { data: rows, error } = await supabase
    .from("imported_companies")
    .select("id, cfo_ruolo")
    .not("cfo_ruolo", "is", null)
    .is("cfo_ruolo_category", null);

  if (error) {
    console.error("Error fetching rows:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  console.log(`Found ${rows.length} rows to backfill.`);

  let updated = 0;
  const categoryCount: Record<string, number> = {};

  // Compute categories and group by value (one UPDATE per category is most efficient)
  const byCategory = new Map<string, string[]>();
  for (const row of rows) {
    const category = computeRuoloCategory(row.cfo_ruolo, null);
    categoryCount[category] = (categoryCount[category] ?? 0) + 1;
    const ids = byCategory.get(category) ?? [];
    ids.push(row.id);
    byCategory.set(category, ids);
  }

  // One UPDATE per distinct category value
  for (const [category, ids] of byCategory.entries()) {
    // Process in BATCH_SIZE chunks to avoid URL length limits
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const { error: updateErr } = await supabase
        .from("imported_companies")
        .update({ cfo_ruolo_category: category })
        .in("id", chunk);

      if (updateErr) {
        console.error(`Error updating "${category}":`, updateErr.message);
      } else {
        updated += chunk.length;
        process.stdout.write(`\rProgress: ${updated}/${rows.length}`);
      }
    }
  }

  console.log("\n\nBackfill complete.");
  console.log("\ncfo_ruolo_category distribution:");
  for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(30)} ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
