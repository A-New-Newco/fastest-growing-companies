import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CreateEnrichmentSessionInput } from "@/types";

// GET /api/enrichment-sessions — list team's enrichment sessions
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
    .from("enrichment_sessions")
    .select("*")
    .eq("team_id", membership.team_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data ?? []).map(toSessionShape));
}

// POST /api/enrichment-sessions — create a new session with companies
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

  const body: CreateEnrichmentSessionInput = await req.json();
  const { name, companies, modelConfig } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!companies?.length) return NextResponse.json({ error: "companies must not be empty" }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Create session
  const { data: session, error: sessionErr } = await admin
    .from("enrichment_sessions")
    .insert({
      team_id: membership.team_id,
      name: name.trim(),
      status: "pending",
      model_config: modelConfig ?? {
        models: ["compound-beta", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
        current_model_index: 0,
      },
      total_companies: companies.length,
      created_by: user.id,
    })
    .select()
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: sessionErr?.message ?? "Failed to create session" }, { status: 500 });
  }

  // Insert companies
  const companyRows = companies.map((c, i) => ({
    session_id: session.id,
    company_id: c.companyId,
    company_origin: c.companyOrigin,
    company_name: c.companyName,
    company_website: c.companyWebsite ?? null,
    company_country: c.companyCountry ?? null,
    status: "pending" as const,
    position: i + 1,
  }));

  const { error: rowsErr } = await admin
    .from("enrichment_session_companies")
    .insert(companyRows);

  if (rowsErr) {
    // Cleanup session on failure
    await admin.from("enrichment_sessions").delete().eq("id", session.id);
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }

  return NextResponse.json(toSessionShape(session), { status: 201 });
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
