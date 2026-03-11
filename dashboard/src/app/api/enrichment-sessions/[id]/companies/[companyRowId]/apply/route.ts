import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string; companyRowId: string } };

// POST /api/enrichment-sessions/[id]/companies/[companyRowId]/apply
// Apply a single company enrichment result back to the source record.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();

  const { data: row, error: rowErr } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("id", params.companyRowId)
    .eq("session_id", params.id)
    .single();

  if (rowErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "done") return NextResponse.json({ error: "Company not yet enriched" }, { status: 409 });
  if (!row.result_nome) return NextResponse.json({ error: "No result to apply (not found)" }, { status: 422 });

  if (row.company_origin === "imported") {
    const { error } = await admin
      .from("imported_companies")
      .update({
        cfo_nome: row.result_nome,
        cfo_ruolo: row.result_ruolo ?? null,
        cfo_linkedin: row.result_linkedin ?? null,
        cfo_confidenza: row.result_confidenza ?? null,
      })
      .eq("id", row.company_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin
    .from("enrichment_session_companies")
    .update({ applied_at: new Date().toISOString(), applied_by: user.id })
    .eq("id", row.id);

  return NextResponse.json({ ok: true });
}
