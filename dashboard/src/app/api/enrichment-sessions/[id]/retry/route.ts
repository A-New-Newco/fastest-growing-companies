import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// POST /api/enrichment-sessions/[id]/retry
// Reset failed companies to pending so the session can be re-run.
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify session exists and belongs to user's team
  const { data: session, error: sessionErr } = await supabase
    .from("enrichment_sessions")
    .select("id, status, completed_count, found_count, failed_count")
    .eq("id", params.id)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (session.status === "running") {
    return NextResponse.json({ error: "Cannot retry while session is running" }, { status: 409 });
  }

  const admin = createAdminSupabaseClient();

  // Count failed companies
  const { count: failedCount } = await admin
    .from("enrichment_session_companies")
    .select("id", { count: "exact", head: true })
    .eq("session_id", params.id)
    .eq("status", "failed");

  if (!failedCount || failedCount === 0) {
    return NextResponse.json({ error: "No failed companies to retry" }, { status: 422 });
  }

  // Reset failed companies to pending, clear error/result fields
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
    .eq("session_id", params.id)
    .eq("status", "failed");

  if (resetErr) {
    return NextResponse.json({ error: resetErr.message }, { status: 500 });
  }

  // Adjust session counters: subtract failed from completed, reset failed to 0
  const newCompleted = Math.max(0, (session.completed_count ?? 0) - failedCount);
  const { error: sessionUpdateErr } = await admin
    .from("enrichment_sessions")
    .update({
      status: "pending",
      completed_count: newCompleted,
      failed_count: 0,
      completed_at: null,
    })
    .eq("id", params.id);

  if (sessionUpdateErr) {
    return NextResponse.json({ error: sessionUpdateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, retriedCount: failedCount });
}
