import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";

type Params = { params: { contactId: string } };

// POST /api/plugin/contacts/[contactId]/mark-contacted
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const campaignId = String(body?.campaignId ?? "").trim();
  const runId = body?.runId ? String(body.runId) : null;
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
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
    .eq("event_type", "contacted")
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
    return NextResponse.json({ ok: true, idempotent: true });
  }

  const { data: contact, error: contactError } = await admin
    .from("campaign_contacts")
    .select("id, campaign_id, status, contacted_at, campaigns!inner(team_id)")
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
  const updates: Record<string, unknown> = {
    last_attempt_at: nowIso,
    claimed_by: null,
    claim_expires_at: null,
    last_error_code: null,
  };

  if (contact.status === "pending") {
    updates.status = "contacted";
  }
  if (!contact.contacted_at) {
    updates.contacted_at = nowIso;
  }

  const { error: updateError } = await admin
    .from("campaign_contacts")
    .update(updates)
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
    event_type: "contacted",
    payload: {
      idempotencyKey,
      metadata,
      contacted_at: nowIso,
    },
  });

  if (eventInsertError) {
    return NextResponse.json({ error: eventInsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, idempotent: false });
}
