import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";
import { FAILURE_CODES_THAT_PAUSE } from "@/lib/plugin/quota";

type Params = { params: { contactId: string } };

// POST /api/plugin/contacts/[contactId]/fail
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const campaignId = String(body?.campaignId ?? "").trim();
  const runId = body?.runId ? String(body.runId) : null;
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  const code = String(body?.code ?? "ui_unknown").trim();
  const message = String(body?.message ?? "").trim();
  const metadata = typeof body?.metadata === "object" && body.metadata ? body.metadata : {};

  if (!campaignId || !idempotencyKey) {
    return NextResponse.json(
      { error: "campaignId and idempotencyKey are required" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();

  const { data: recentEvents, error: eventsError } = await admin
    .from("campaign_contact_events")
    .select("id, payload")
    .eq("campaign_contact_id", params.contactId)
    .eq("event_type", "failed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  const duplicate = (recentEvents ?? []).some((event) => {
    const payload = event.payload as Record<string, unknown>;
    return String(payload?.idempotencyKey ?? "") === idempotencyKey;
  });

  if (duplicate) {
    return NextResponse.json({ ok: true, idempotent: true, autoPaused: false });
  }

  const { data: contact, error: contactError } = await admin
    .from("campaign_contacts")
    .select("id, campaign_id, campaigns!inner(team_id)")
    .eq("id", params.contactId)
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (contactError || !contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const campaignTeamId = (contact as { campaigns?: { team_id?: string } }).campaigns?.team_id;
  if (campaignTeamId !== auth.context.teamId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("campaign_contacts")
    .update({
      last_attempt_at: nowIso,
      last_error_code: code,
      claimed_by: null,
      claim_expires_at: null,
    })
    .eq("id", params.contactId)
    .eq("campaign_id", campaignId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: eventInsertError } = await admin.from("campaign_contact_events").insert({
    campaign_id: campaignId,
    campaign_contact_id: params.contactId,
    run_id: runId,
    actor_user_id: auth.context.userId,
    event_type: "failed",
    payload: {
      idempotencyKey,
      code,
      message,
      metadata,
      failed_at: nowIso,
    },
  });

  if (eventInsertError) {
    return NextResponse.json({ error: eventInsertError.message }, { status: 500 });
  }

  let autoPaused = false;
  if (FAILURE_CODES_THAT_PAUSE.has(code)) {
    autoPaused = true;

    if (runId) {
      await admin
        .from("campaign_outreach_runs")
        .update({
          status: "paused",
          pause_reason: `Auto-paused due to ${code}`,
        })
        .eq("id", runId)
        .eq("team_id", auth.context.teamId);
    }

    await admin
      .from("campaigns")
      .update({ status: "paused", pause_reason: `Auto-paused due to ${code}` })
      .eq("id", campaignId)
      .eq("team_id", auth.context.teamId);
  }

  return NextResponse.json({ ok: true, idempotent: false, autoPaused });
}
