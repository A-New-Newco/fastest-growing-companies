import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Params = { params: { id: string } };

// GET /api/enrichment-sessions/[id]/companies — list company rows with logs
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100")));
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from("enrichment_session_companies")
    .select("*", { count: "exact" })
    .eq("session_id", params.id)
    .order("position", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    companies: (data ?? []).map(toCompanyShape),
    total: count ?? 0,
    page,
    limit,
  });
}

// ── Shape helper ──────────────────────────────────────────────────────────────

function toCompanyShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    sessionId: row.session_id,
    companyId: row.company_id,
    companyOrigin: row.company_origin,
    companyName: row.company_name,
    companyWebsite: row.company_website,
    companyCountry: row.company_country,
    status: row.status,
    resultNome: row.result_nome,
    resultRuolo: row.result_ruolo,
    resultLinkedin: row.result_linkedin,
    resultConfidenza: row.result_confidenza,
    logs: row.logs ?? [],
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    modelUsed: row.model_used,
    errorMessage: row.error_message,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
