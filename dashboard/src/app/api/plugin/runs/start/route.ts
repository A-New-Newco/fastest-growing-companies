import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";

// POST /api/plugin/runs/start
export async function POST(req: NextRequest) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const campaignId = String(body?.campaignId ?? "").trim();

  if (!campaignId) {
    return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  const [{ data: campaign, error: campaignError }, { data: operatorProfile }] = await Promise.all([
    admin
      .from("campaigns")
      .select("id, team_id, status")
      .eq("id", campaignId)
      .eq("team_id", auth.context.teamId)
      .maybeSingle(),
    admin
      .from("plugin_operator_profiles")
      .select("user_id, verified_at")
      .eq("user_id", auth.context.userId)
      .eq("team_id", auth.context.teamId)
      .maybeSingle(),
  ]);

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (!operatorProfile?.verified_at) {
    return NextResponse.json(
      { error: "Operator profile must be verified before starting a run" },
      { status: 412 }
    );
  }

  const { data: run, error: runError } = await admin
    .from("campaign_outreach_runs")
    .insert({
      campaign_id: campaign.id,
      team_id: auth.context.teamId,
      started_by: auth.context.userId,
      status: "running",
    })
    .select("id, campaign_id, team_id, started_by, status, pause_reason, started_at, ended_at, updated_at")
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: runError?.message ?? "Unable to start run" }, { status: 500 });
  }

  if (campaign.status !== "active") {
    await admin
      .from("campaigns")
      .update({ status: "active", pause_reason: null })
      .eq("id", campaign.id);
  }

  return NextResponse.json({
    id: run.id,
    campaignId: run.campaign_id,
    teamId: run.team_id,
    startedBy: run.started_by,
    status: run.status,
    pauseReason: run.pause_reason,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    updatedAt: run.updated_at,
  });
}
