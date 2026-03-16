import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// POST /api/enrichment-sessions/[id]/reset
// Reset all companies to pending so the session can be re-run from scratch.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify session exists and belongs to user's team
  const { data: session, error: sessionErr } = await supabase
    .from("enrichment_sessions")
    .select("id, status, total_companies")
    .eq("id", params.id)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.status === "running") {
    return NextResponse.json({ error: "Cannot reset while session is running" }, { status: 409 });
  }

  const admin = createAdminSupabaseClient();

  // Reset all companies to pending, clear result fields
  const { error: resetErr } = await admin
    .from("enrichment_session_companies")
    .update({
      status: "pending",
      error_message: null,
      result_nome: null,
      result_ruolo: null,
      result_linkedin: null,
      result_confidenza: null,
      tokens_input: 0,
      tokens_output: 0,
      model_used: null,
      logs: [],
    })
    .eq("session_id", params.id);

  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }

  // Reset session counters to zero
  const { error: sessionUpdateErr } = await admin
    .from("enrichment_sessions")
    .update({
      status: "pending",
      completed_count: 0,
      found_count: 0,
      failed_count: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      started_at: null,
      completed_at: null,
    })
    .eq("id", params.id);

  if (sessionUpdateErr) {
    return NextResponse.json({ error: sessionUpdateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resetCount: session.total_companies });
}
