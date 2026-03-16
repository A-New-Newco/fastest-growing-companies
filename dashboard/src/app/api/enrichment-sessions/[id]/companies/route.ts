import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

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

// POST /api/enrichment-sessions/[id]/companies — add companies to existing session
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify session is accessible and not running/completed
  const { data: session } = await supabase
    .from("enrichment_sessions")
    .select("id, status, total_companies")
    .eq("id", params.id)
    .single();

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.status === "running") {
    return NextResponse.json({ error: "Cannot add companies to a running session. Pause it first." }, { status: 409 });
  }
  if (session.status === "completed" || session.status === "failed") {
    return NextResponse.json({ error: "Session is already finished." }, { status: 409 });
  }

  const body: {
    companies: Array<{
      companyId: string;
      companyOrigin: "curated" | "imported";
      companyName: string;
      companyWebsite: string | null;
      companyCountry: string | null;
      contactNome?: string | null;
      contactRuolo?: string | null;
    }>;
  } = await req.json();

  if (!body.companies?.length) {
    return NextResponse.json({ error: "companies must not be empty" }, { status: 400 });
  }

  // Get current max position
  const { data: lastRow } = await supabase
    .from("enrichment_session_companies")
    .select("position")
    .eq("session_id", params.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const startPosition = (lastRow?.position ?? 0) + 1;

  const admin = createAdminSupabaseClient();

  // Upsert to handle duplicates gracefully
  const rows = body.companies.map((c, i) => ({
    session_id: params.id,
    company_id: c.companyId,
    company_origin: c.companyOrigin,
    company_name: c.companyName,
    company_website: c.companyWebsite ?? null,
    company_country: c.companyCountry ?? null,
    contact_nome: c.contactNome ?? null,
    contact_ruolo: c.contactRuolo ?? null,
    status: "pending" as const,
    position: startPosition + i,
  }));

  const { error: insertErr } = await admin
    .from("enrichment_session_companies")
    .upsert(rows, { onConflict: "session_id,company_id,company_origin", ignoreDuplicates: true });

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Update total_companies counter
  const { data: total } = await admin
    .from("enrichment_session_companies")
    .select("id", { count: "exact", head: true })
    .eq("session_id", params.id);

  const newTotal = (total as unknown as { count: number } | null)?.count
    ?? (session.total_companies + body.companies.length);

  await admin
    .from("enrichment_sessions")
    .update({ total_companies: newTotal })
    .eq("id", params.id);

  return NextResponse.json({ added: body.companies.length, total: newTotal });
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
    contactNome: row.contact_nome ?? null,
    contactRuolo: row.contact_ruolo ?? null,
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
