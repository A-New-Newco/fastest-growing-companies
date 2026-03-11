/**
 * One-shot migration script: reads 2026_cleaned_en.csv and populates Supabase.
 *
 * Usage:
 *   npx tsx dashboard/scripts/migrate_to_supabase.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or SUPABASE_SERVICE_ROLE_KEY for bypassing RLS during bulk insert)
 * to be set in dashboard/.env.local or as env vars.
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env.local
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CSV_PATH_EN = path.join(
  __dirname,
  "../public/data/2026_cleaned_en.csv"
);
const CSV_PATH_IT = path.join(__dirname, "../public/data/2026_cleaned_en.csv");
const YEAR = 2026;
const SOURCE_NAME = "leader-della-crescita";
const PUBLISHER = "Il Sole 24 Ore";
const COUNTRY = "IT";

function pickFirstDefined(
  row: Record<string, string>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function parseNumber(
  row: Record<string, string>,
  keys: string[]
): number | null {
  const raw = pickFirstDefined(row, keys);
  if (raw === null) return null;
  // Handle both "12.345,67" and "12345.67" formats safely.
  const hasDot = raw.includes(".");
  const hasComma = raw.includes(",");
  let normalized = raw;
  if (hasDot && hasComma) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  }
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

const CONTACTS_ONLY = process.argv.includes("--contacts-only");

async function main() {
  const csvPath = fs.existsSync(CSV_PATH_EN) ? CSV_PATH_EN : CSV_PATH_IT;

  console.log("Reading CSV...");
  console.log(`Using file: ${csvPath}`);
  const raw = fs.readFileSync(csvPath, "utf-8");
  // Strip UTF-8 BOM if present
  const cleanRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: Record<string, string>[] = parse(cleanRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // Debug: print first row keys to catch BOM or column name issues
  if (rows.length > 0) {
    console.log("CSV columns:", Object.keys(rows[0]).join(", "));
  }
  console.log(`Found ${rows.length} rows.`);

  // 1. Upsert source
  console.log("Upserting source...");
  const { data: sourceData, error: sourceErr } = await supabase
    .from("sources")
    .upsert(
      { name: SOURCE_NAME, publisher: PUBLISHER, country: COUNTRY, year: YEAR },
      { onConflict: "name,year,country" }
    )
    .select("id")
    .single();

  if (sourceErr || !sourceData) {
    console.error("Error upserting source:", sourceErr);
    process.exit(1);
  }
  // Verify we got back the expected source (not a newly created duplicate)
  const { data: verifiedSource } = await supabase
    .from("sources")
    .select("id")
    .eq("name", SOURCE_NAME)
    .eq("year", YEAR)
    .eq("country", COUNTRY)
    .single();

  const sourceId = verifiedSource?.id ?? sourceData.id;
  console.log(`Source ID: ${sourceId}`);

  // 2. In contacts-only mode, pre-load all company rank→id for this source
  let globalRankToId = new Map<number, string>();
  if (CONTACTS_ONLY) {
    console.log("Fetching existing companies...");
    const { data: allCompanies, error: fetchErr } = await supabase
      .from("companies")
      .select("id, rank")
      .eq("source_id", sourceId);
    if (fetchErr || !allCompanies) {
      console.error("Error fetching companies:", fetchErr?.message);
      // Fallback: try without source_id filter
      const { data: allComp2 } = await supabase.from("companies").select("id, rank");
      console.log(`Fallback: found ${allComp2?.length ?? 0} companies total`);
      if (allComp2) {
        for (const c of allComp2) globalRankToId.set(c.rank, c.id);
      }
    } else {
      console.log(`Found ${allCompanies.length} companies with source_id=${sourceId}`);
      for (const c of allCompanies) globalRankToId.set(c.rank, c.id);
    }
  }

  // 3. Insert companies + contacts in batches
  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const companiesPayload = batch.map((r) => ({
      source_id: sourceId,
      rank: parseNumber(r, ["RANK"]) ?? null,
      name: pickFirstDefined(r, ["COMPANY", "AZIENDA"]) ?? "",
      website: pickFirstDefined(r, ["WEBSITE", "SITO WEB"]),
      growth_rate: parseNumber(r, ["GROWTH RATE", "TASSO DI CRESCITA"]),
      sector: pickFirstDefined(r, ["SECTOR", "SETTORE"]),
      region: pickFirstDefined(r, ["REGION", "REGIONE"]),
      appearances: parseNumber(r, ["APPEARANCES", "PRESENZE"]) ?? 0,
      financials: {
        revenue_start: parseNumber(r, ["REVENUE 2021", "RICAVI 2021"]),
        revenue_end: parseNumber(r, ["REVENUE 2024", "RICAVI 2024"]),
        year_start: 2021,
        year_end: 2024,
      },
    }));

    let rankToId: Map<number, string>;

    if (!CONTACTS_ONLY) {
      const { data, error: compErr } = await supabase
        .from("companies")
        .upsert(companiesPayload, { onConflict: "source_id,rank" })
        .select("id, rank");

      if (compErr || !data) {
        console.error(`Error inserting companies batch ${i}:`, compErr);
        continue;
      }
      rankToId = new Map(data.map((c: { id: string; rank: number }) => [c.rank, c.id]));
    } else {
      rankToId = globalRankToId;
    }

    // Insert contacts for rows that have a CFO
    const contacts = batch
      .filter((r) => pickFirstDefined(r, ["CFO_NAME", "CFO_NOME"]))
      .map((r) => {
        const rank = parseNumber(r, ["RANK"]);
        if (rank === null) return null;
        const companyId = rankToId.get(rank);
        if (!companyId) return null;
        const source =
          pickFirstDefined(r, ["SOURCE", "FONTE"]) === "agent"
            ? "claude-agent"
            : "manual";

        return {
          company_id: companyId,
          enrichment_source: source,
          name: pickFirstDefined(r, ["CFO_NAME", "CFO_NOME"]),
          role: pickFirstDefined(r, ["CFO_ROLE", "CFO_RUOLO"]),
          role_category: pickFirstDefined(r, [
            "CFO_ROLE_CATEGORY",
            "CFO_RUOLO_CATEGORY",
          ]),
          linkedin: pickFirstDefined(r, ["CFO_LINKEDIN"]),
          confidence: pickFirstDefined(r, ["CONFIDENCE", "CONFIDENZA"]),
          enriched_at: pickFirstDefined(r, ["SEARCH_DATE", "DATA_RICERCA"]),
          raw_data: null,
        };
      })
      .filter(Boolean);

    if (contacts.length > 0) {
      // Use insert (not upsert) to avoid needing a unique constraint
      const { error: contactErr } = await supabase
        .from("contacts")
        .insert(contacts as object[]);
      if (contactErr) {
        console.error(`Error inserting contacts batch ${i}:`, contactErr.message);
      } else {
        console.log(`  ✓ Inserted ${contacts.length} contacts`);
      }
    }

    inserted += batch.length;
    process.stdout.write(`\rProgress: ${inserted}/${rows.length}`);
  }

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
