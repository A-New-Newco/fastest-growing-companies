import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";

type Params = { params: { runId: string } };

// PATCH /api/plugin/runs/[runId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "").trim();
  const reason = String(body?.reason ?? "").trim() || null;

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  const { data: run, error: runError } = await admin
    .from("campaign_outreach_runs")
    .select("id, campaign_id, team_id, status")
    .eq("id", params.runId)
    .eq("team_id", auth.context.teamId)
    .maybeSingle();

  if (runError || !run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {};

  if (action === "pause") {
    updates.status = "paused";
    updates.pause_reason = reason ?? "Paused by plugin";
  } else if (action === "resume") {
    updates.status = "running";
    updates.pause_reason = null;
  } else if (action === "stop") {
    updates.status = "stopped";
    updates.ended_at = nowIso;
  } else if (action === "complete") {
    updates.status = "completed";
    updates.ended_at = nowIso;
  } else {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from("campaign_outreach_runs")
    .update(updates)
    .eq("id", run.id)
    .select("id, campaign_id, team_id, started_by, status, pause_reason, started_at, ended_at, updated_at")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message ?? "Unable to update run" },
      { status: 500 }
    );
  }

  if (action === "pause") {
    await admin
      .from("campaigns")
      .update({ status: "paused", pause_reason: updates.pause_reason })
      .eq("id", run.campaign_id)
      .eq("team_id", auth.context.teamId);
  }

  if (action === "resume") {
    await admin
      .from("campaigns")
      .update({ status: "active", pause_reason: null })
      .eq("id", run.campaign_id)
      .eq("team_id", auth.context.teamId);
  }

  return NextResponse.json({
    id: updated.id,
    campaignId: updated.campaign_id,
    teamId: updated.team_id,
    startedBy: updated.started_by,
    status: updated.status,
    pauseReason: updated.pause_reason,
    startedAt: updated.started_at,
    endedAt: updated.ended_at,
    updatedAt: updated.updated_at,
  });
}
