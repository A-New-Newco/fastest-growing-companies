import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

interface Params {
  params: { batchId: string };
}

// PATCH /api/imports/[batchId]/mapping — user confirms/edits mapping
export async function PATCH(req: NextRequest, { params }: Params) {
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

  // Verify batch belongs to team
  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, team_id, source_name")
    .eq("id", params.batchId)
    .maybeSingle();

  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  if (batch.team_id !== membership.team_id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { fieldMappingId, mapping, sourceName } = body as {
    fieldMappingId: string;
    mapping: Record<string, { target: string | null; transform: string | null }>;
    sourceName?: string;
  };

  if (!fieldMappingId) return NextResponse.json({ error: "fieldMappingId required" }, { status: 400 });
  if (!mapping || typeof mapping !== "object")
    return NextResponse.json({ error: "mapping object required" }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Normalise mapping to include confidence (preserve existing confidence if present)
  const { data: existing } = await admin
    .from("field_mappings")
    .select("mapping")
    .eq("id", fieldMappingId)
    .maybeSingle();

  const existingMapping = (existing?.mapping ?? {}) as Record<
    string,
    { target: string | null; transform: string | null; confidence: number }
  >;

  const normalisedMapping: Record<string, { target: string | null; transform: string | null; confidence: number }> = {};
  for (const [field, entry] of Object.entries(mapping)) {
    normalisedMapping[field] = {
      target: entry.target,
      transform: entry.transform,
      confidence: existingMapping[field]?.confidence ?? 1.0,
    };
  }

  const { data, error } = await admin
    .from("field_mappings")
    .update({
      mapping: normalisedMapping,
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", fieldMappingId)
    .eq("batch_id", params.batchId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update batch source_name if provided
  if (sourceName?.trim()) {
    await admin
      .from("import_batches")
      .update({ source_name: sourceName.trim() })
      .eq("id", params.batchId);
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    approvedAt: data.approved_at,
  });
}
