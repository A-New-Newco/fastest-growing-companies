import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// GET /api/enrichment-sessions/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row, error } = await supabase
    .from("enrichment_sessions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(toSessionShape(row));
}

// PATCH /api/enrichment-sessions/[id] — update name, status (pause), model_config
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("enrichment_sessions")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.status !== undefined) updates.status = body.status;
  if (body.modelConfig !== undefined) updates.model_config = body.modelConfig;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("enrichment_sessions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(toSessionShape(data));
}

// DELETE /api/enrichment-sessions/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("enrichment_sessions")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.status === "running") {
    return NextResponse.json({ error: "Cannot delete a running session. Pause it first." }, { status: 409 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("enrichment_sessions").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// ── Shape helper ──────────────────────────────────────────────────────────────

function toSessionShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    status: row.status,
    modelConfig: row.model_config,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    tokensTotal: row.tokens_total,
    totalCompanies: row.total_companies,
    completedCount: row.completed_count,
    foundCount: row.found_count,
    failedCount: row.failed_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastHeartbeat: row.last_heartbeat,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
