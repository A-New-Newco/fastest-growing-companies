import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";
import {
  QUOTA_SETTINGS,
  daysSince,
  resolveDailyLimit,
  startOfDayIso,
  startOfHourIso,
  toQuotaPolicy,
} from "@/lib/plugin/quota";

type Params = { params: { id: string } };

function firstName(value: string | null): string {
  return String(value ?? "").trim().split(/\s+/)[0] ?? "";
}

function renderTemplate(
  template: string,
  input: { firstName: string; companyName: string; sector: string }
): string {
  return template
    .replace(/{{\s*first_name\s*}}/gi, input.firstName)
    .replace(/{{\s*company_name\s*}}/gi, input.companyName)
    .replace(/{{\s*sector\s*}}/gi, input.sector)
    .trim()
    .slice(0, 300);
}

function defaultTemplate() {
  return "Ciao {{first_name}}, ho visto il tuo profilo in {{company_name}} e mi farebbe piacere connetterci.";
}

// POST /api/plugin/campaigns/[id]/claim-next
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const runId = body?.runId ? String(body.runId) : null;
  const leaseSeconds = Math.min(Math.max(Number(body?.leaseSeconds ?? 300), 60), 900);

  const admin = createAdminSupabaseClient();

  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("id, team_id, status, pause_reason, connection_note_template, quota_policy")
    .eq("id", params.id)
    .eq("team_id", auth.context.teamId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (campaign.status === "paused") {
    return NextResponse.json(
      { error: campaign.pause_reason || "Campaign is paused" },
      { status: 409 }
    );
  }

  const { data: pairing } = await admin
    .from("plugin_device_sessions")
    .select("paired_at, created_at")
    .eq("id", auth.context.sessionId)
    .maybeSingle();

  const policy = toQuotaPolicy(campaign.quota_policy);
  const cfg = QUOTA_SETTINGS[policy];
  const ageDays = daysSince(pairing?.paired_at || pairing?.created_at || null);
  const dailyLimit = resolveDailyLimit(policy, ageDays);
  const hourlyLimit = cfg.hourlyCap;

  const [{ count: dailyUsed }, { count: hourlyUsed }, { data: latestContacted }] = await Promise.all([
    admin
      .from("campaign_contact_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_user_id", auth.context.userId)
      .eq("event_type", "contacted")
      .gte("created_at", startOfDayIso()),
    admin
      .from("campaign_contact_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_user_id", auth.context.userId)
      .eq("event_type", "contacted")
      .gte("created_at", startOfHourIso()),
    admin
      .from("campaign_contact_events")
      .select("created_at")
      .eq("actor_user_id", auth.context.userId)
      .eq("event_type", "contacted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const usedDaily = dailyUsed ?? 0;
  const usedHourly = hourlyUsed ?? 0;
  const secondsSinceLastContact = latestContacted?.created_at
    ? Math.floor((Date.now() - new Date(latestContacted.created_at).getTime()) / 1000)
    : null;
  const cooldownRemaining = secondsSinceLastContact === null
    ? 0
    : Math.max(0, cfg.cooldownSec - secondsSinceLastContact);

  if (usedDaily >= dailyLimit || usedHourly >= hourlyLimit || cooldownRemaining > 0) {
    return NextResponse.json(
      {
        error: "Quota limit reached",
        quota: {
          policy,
          dailyLimit,
          hourlyLimit,
          cooldownSec: cfg.cooldownSec,
          usedDaily,
          usedHourly,
          remainingDaily: Math.max(0, dailyLimit - usedDaily),
          remainingHourly: Math.max(0, hourlyLimit - usedHourly),
          cooldownRemainingSec: cooldownRemaining,
        },
      },
      { status: 429 }
    );
  }

  const { data: claimedRows, error: claimError } = await admin.rpc("claim_next_contact", {
    p_campaign_id: campaign.id,
    p_actor_user_id: auth.context.userId,
    p_run_id: runId,
    p_lease_seconds: leaseSeconds,
  });

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  const claimed = Array.isArray(claimedRows) && claimedRows.length > 0 ? claimedRows[0] : null;

  if (!claimed) {
    return NextResponse.json({
      contact: null,
      quota: {
        policy,
        dailyLimit,
        hourlyLimit,
        cooldownSec: cfg.cooldownSec,
        usedDaily,
        usedHourly,
        remainingDaily: Math.max(0, dailyLimit - usedDaily),
        remainingHourly: Math.max(0, hourlyLimit - usedHourly),
        cooldownRemainingSec: cooldownRemaining,
      },
    });
  }

  const { data: company } = await admin
    .from("companies_full")
    .select("id, name, sector")
    .eq("id", claimed.company_id)
    .maybeSingle();

  const companyName = company?.name ?? "";
  const sector = company?.sector ?? "";
  const contactName = claimed.contact_name as string | null;
  const contactFirstName = firstName(contactName);

  const template = campaign.connection_note_template?.trim() || defaultTemplate();
  const renderedMessage = renderTemplate(template, {
    firstName: contactFirstName,
    companyName,
    sector,
  });

  await admin.from("campaign_contact_events").insert({
    campaign_id: campaign.id,
    campaign_contact_id: claimed.contact_id,
    run_id: runId,
    actor_user_id: auth.context.userId,
    event_type: "prepared",
    payload: {
      lease_expires_at: claimed.lease_expires_at,
      rendered_message_length: renderedMessage.length,
    },
  });

  return NextResponse.json({
    contact: {
      contactId: claimed.contact_id,
      companyId: claimed.company_id,
      companyName,
      contactName,
      contactRole: claimed.contact_role,
      contactLinkedin: claimed.contact_linkedin,
      message: renderedMessage,
      leaseExpiresAt: claimed.lease_expires_at,
      runId,
    },
    quota: {
      policy,
      dailyLimit,
      hourlyLimit,
      cooldownSec: cfg.cooldownSec,
      usedDaily,
      usedHourly,
      remainingDaily: Math.max(0, dailyLimit - usedDaily),
      remainingHourly: Math.max(0, hourlyLimit - usedHourly),
      cooldownRemainingSec: cooldownRemaining,
    },
  });
}
