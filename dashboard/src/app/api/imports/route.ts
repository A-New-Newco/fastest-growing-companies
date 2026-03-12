import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { parseFileSample, detectFormat } from "@/lib/file-parser";
import { callGroqMapper, GROQ_MODEL, PROMPT_VERSION } from "@/lib/groq-mapper";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// GET /api/imports — list team's import batches
export async function GET() {
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

  const { data, error } = await supabase
    .from("import_batches")
    .select("*")
    .eq("team_id", membership.team_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const batches = (data ?? []).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    sourceName: row.source_name,
    countryCode: row.country_code,
    year: row.year,
    fileName: row.file_name,
    fileFormat: row.file_format,
    totalRecords: row.total_records,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json(batches);
}

// POST /api/imports — upload file, parse sample, call Groq, create batch + mapping
export async function POST(req: NextRequest) {
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

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const countryCode = (formData.get("country_code") as string | null)?.toUpperCase().trim();
  const yearStr = formData.get("year") as string | null;
  const sourceNameOverride = (formData.get("source_name") as string | null)?.trim() || null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!countryCode || countryCode.length !== 2)
    return NextResponse.json({ error: "country_code is required (ISO 2-letter)" }, { status: 400 });
  if (!yearStr || isNaN(parseInt(yearStr)))
    return NextResponse.json({ error: "year is required" }, { status: 400 });

  const year = parseInt(yearStr);
  const format = detectFormat(file.name);

  if (!format)
    return NextResponse.json(
      { error: "Unsupported file format. Use .json, .jsonl, or .csv" },
      { status: 400 }
    );

  if (file.size > MAX_FILE_SIZE)
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  // Read file text
  const text = await file.text();

  // Parse sample (first 2 rows)
  let parseResult;
  try {
    parseResult = parseFileSample(text, format);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to parse file: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  if (parseResult.totalRows === 0)
    return NextResponse.json({ error: "File contains no records" }, { status: 400 });

  // Store file to Supabase Storage
  const admin = createAdminSupabaseClient();
  const fileKey = `${membership.team_id}/${crypto.randomUUID()}.${format}`;

  const { error: storageError } = await admin.storage
    .from("import-uploads")
    .upload(fileKey, new Blob([text], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
    });

  if (storageError) {
    return NextResponse.json(
      { error: `Failed to store file: ${storageError.message}` },
      { status: 500 }
    );
  }

  // Call Groq for field mapping (graceful degradation on failure)
  const groqApiKey = process.env.GROQ_API_KEY ?? "";
  let fieldMappingResult;
  let llmFailed = false;

  if (groqApiKey) {
    try {
      fieldMappingResult = await callGroqMapper(parseResult, file.name, groqApiKey);
    } catch (e) {
      console.error("Groq mapping failed:", e);
      llmFailed = true;
    }
  } else {
    llmFailed = true;
  }

  if (llmFailed || !fieldMappingResult) {
    fieldMappingResult = {
      mappings: [],
      extra_fields: parseResult.fields.map((f) => f.name),
      source_name_suggestion: "",
      notes: "LLM unavailable — please map fields manually.",
    };
  }

  const sourceName =
    sourceNameOverride ||
    fieldMappingResult.source_name_suggestion ||
    `import_${countryCode.toLowerCase()}_${year}`;

  // Convert LLM output to mapping JSONB format
  const mappingJsonb: Record<string, { target: string | null; transform: string | null; confidence: number }> = {};
  for (const m of fieldMappingResult.mappings) {
    mappingJsonb[m.source_field] = {
      target: m.target_field,
      transform: m.transform,
      confidence: m.confidence,
    };
  }
  // Extra fields → extra_data
  for (const f of fieldMappingResult.extra_fields) {
    if (!mappingJsonb[f]) {
      const key = f.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      mappingJsonb[f] = { target: `extra_data.${key}`, transform: null, confidence: 1.0 };
    }
  }

  // Create import_batch row
  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      team_id: membership.team_id,
      source_name: sourceName,
      country_code: countryCode,
      year,
      file_name: file.name,
      file_format: format,
      total_records: parseResult.totalRows,
      status: "mapping",
      created_by: user.id,
    })
    .select()
    .single();

  if (batchError) {
    await admin.storage.from("import-uploads").remove([fileKey]);
    return NextResponse.json({ error: batchError.message }, { status: 500 });
  }

  // Create field_mapping row
  const { data: fieldMapping, error: mappingError } = await admin
    .from("field_mappings")
    .insert({
      batch_id: batch.id,
      team_id: membership.team_id,
      source_schema: parseResult.fields.map((f) => f.name),
      mapping: mappingJsonb,
      status: "pending_review",
      llm_model: llmFailed ? null : GROQ_MODEL,
      created_by: user.id,
    })
    .select()
    .single();

  if (mappingError) {
    await admin.storage.from("import-uploads").remove([fileKey]);
    return NextResponse.json({ error: mappingError.message }, { status: 500 });
  }

  return NextResponse.json({
    batchId: batch.id,
    fieldMappingId: fieldMapping.id,
    fileKey,
    sourceName,
    parseResult,
    fieldMapping: {
      id: fieldMapping.id,
      sourceSchema: fieldMapping.source_schema,
      mapping: fieldMapping.mapping,
      status: fieldMapping.status,
      llmNotes: fieldMappingResult.notes,
      llmFailed,
      promptVersion: PROMPT_VERSION,
    },
    totalRows: parseResult.totalRows,
  });
}
