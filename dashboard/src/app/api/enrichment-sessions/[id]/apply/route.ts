import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// POST /api/enrichment-sessions/[id]/apply
// Apply all 'done' and not yet applied results back to the source company records.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify session is accessible (RLS enforces team scope)
  const { data: session } = await supabase
    .from("enrichment_sessions")
    .select("id, status")
    .eq("id", params.id)
    .single();

  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminSupabaseClient();

  // Fetch all done, not-yet-applied rows
  const { data: rows, error: rowsErr } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("session_id", params.id)
    .eq("status", "done")
    .is("applied_at", null);

  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const pending = rows ?? [];
  let applied = 0;
  let skipped = 0;

  const now = new Date().toISOString();

  for (const row of pending) {
    if (!row.result_nome) {
      skipped++;
      continue;
    }

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

      if (error) {
        skipped++;
        continue;
      }
    }
    // For 'curated' companies: the underlying source is read-only (scraped data).
    // We mark as applied but do not overwrite the source — enrichment results
    // remain visible in the session. Future: support a cfo_overrides table.

    // Mark as applied
    await admin
      .from("enrichment_session_companies")
      .update({ applied_at: now, applied_by: user.id })
      .eq("id", row.id);

    applied++;
  }

  return NextResponse.json({ applied, skipped, total: pending.length });
}
