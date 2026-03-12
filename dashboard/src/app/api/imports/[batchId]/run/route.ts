import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseAllRecords, detectFormat } from "@/lib/file-parser";
import { applyMapping, computeRuoloCategory } from "@/lib/groq-mapper";

interface Params {
  params: { batchId: string };
}

const BATCH_SIZE = 50;

// POST /api/imports/[batchId]/run — apply confirmed mapping, import companies
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a team member" }, { status: 403 });

  const body = await req.json() as { fieldMappingId: string; fileKey: string };
  const { fieldMappingId, fileKey } = body;

  if (!fieldMappingId || !fileKey)
    return NextResponse.json({ error: "fieldMappingId and fileKey required" }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Load batch
  const { data: batch } = await admin
    .from("import_batches")
    .select("*")
    .eq("id", params.batchId)
    .maybeSingle();

  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (batch.team_id !== membership.team_id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Load approved mapping
  const { data: fieldMappingRow } = await admin
    .from("field_mappings")
    .select("*")
    .eq("id", fieldMappingId)
    .eq("batch_id", params.batchId)
    .maybeSingle();

  if (!fieldMappingRow)
    return NextResponse.json({ error: "Field mapping not found" }, { status: 404 });
  if (fieldMappingRow.status !== "approved")
    return NextResponse.json({ error: "Field mapping must be approved before import" }, { status: 400 });

  const mapping = fieldMappingRow.mapping as Record<
    string,
    { target: string | null; transform: string | null }
  >;

  // Download file from Storage
  const { data: fileData, error: downloadError } = await admin.storage
    .from("import-uploads")
    .download(fileKey);

  if (downloadError || !fileData)
    return NextResponse.json(
      { error: `Failed to download file: ${downloadError?.message ?? "unknown"}` },
      { status: 500 }
    );

  const text = await fileData.text();
  const format = detectFormat(batch.file_name) ?? "jsonl";

  // Parse all records
  let allRecords: Array<Record<string, unknown>>;
  try {
    allRecords = parseAllRecords(text, format);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to parse file: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  // Mark batch as importing
  await admin
    .from("import_batches")
    .update({ status: "importing" })
    .eq("id", params.batchId);

  // Apply mapping and batch upsert
  const defaults = {
    teamId: membership.team_id,
    batchId: params.batchId,
    sourceName: batch.source_name,
    countryCode: batch.country_code,
    year: batch.year,
    importedBy: user.id,
  };

  let importedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const chunk = allRecords.slice(i, i + BATCH_SIZE);
    const rows = chunk.map((record) => {
      const row = applyMapping(record, mapping, defaults);
      // Auto-compute cfo_ruolo_category if cfo_ruolo is present but category is missing
      if (row.cfo_ruolo && !row.cfo_ruolo_category) {
        row.cfo_ruolo_category = computeRuoloCategory(
          row.cfo_ruolo as string,
          row.fonte as string | null
        );
      }
      return row;
    });

    const { data: upserted, error: upsertError } = await admin
      .from("imported_companies")
      .upsert(rows, {
        onConflict: "team_id,source_name,source_key",
        ignoreDuplicates: false,
      })
      .select("id");

    if (upsertError) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${upsertError.message}`);
      skippedCount += chunk.length;
    } else {
      importedCount += upserted?.length ?? 0;
      skippedCount += chunk.length - (upserted?.length ?? 0);
    }
  }

  // Update batch status
  const finalStatus = errors.length > 0 && importedCount === 0 ? "failed" : "done";
  await admin
    .from("import_batches")
    .update({
      status: finalStatus,
      imported_count: importedCount,
      skipped_count: skippedCount,
      total_records: allRecords.length,
    })
    .eq("id", params.batchId);

  // Clean up file from Storage
  await admin.storage.from("import-uploads").remove([fileKey]);

  return NextResponse.json({
    importedCount,
    skippedCount,
    totalRecords: allRecords.length,
    errors: errors.slice(0, 10), // cap error list
  });
}
