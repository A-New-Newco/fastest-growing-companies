import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const SELECT_CAMPAIGNS_WITH_OUTREACH = `
  id, team_id, name, description, status, connection_note_template, quota_policy, pause_reason, integration_mode, created_by, created_at, updated_at,
  campaign_contacts(status)
`;

function mapCampaignRow(row: Record<string, unknown>) {
  const contacts = (row.campaign_contacts ?? []) as Array<{ status: string }>;
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    status: row.status,
    connectionNoteTemplate:
      typeof row.connection_note_template === "string" ? row.connection_note_template : null,
    quotaPolicy: typeof row.quota_policy === "string" ? row.quota_policy : "conservative",
    pauseReason: typeof row.pause_reason === "string" ? row.pause_reason : null,
    integrationMode: typeof row.integration_mode === "string" ? row.integration_mode : "dashboard",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalContacts: contacts.length,
    contactedCount: contacts.filter((c) => c.status !== "pending").length,
    repliedCount: contacts.filter((c) =>
      ["replied", "meeting_scheduled", "converted"].includes(c.status)
    ).length,
    convertedCount: contacts.filter((c) => c.status === "converted").length,
  };
}

// GET /api/campaigns — list team's campaigns with aggregated stats
export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a team member" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("campaigns")
    .select(SELECT_CAMPAIGNS_WITH_OUTREACH)
    .eq("team_id", membership.team_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaigns = (data ?? []).map((row) => mapCampaignRow(row as Record<string, unknown>));

  return NextResponse.json(campaigns);
}

// POST /api/campaigns — create a new campaign
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a team member" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, connectionNoteTemplate, quotaPolicy, integrationMode } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const baseInsertPayload = {
    team_id: membership.team_id,
    name: name.trim(),
    description: description?.trim() || null,
    created_by: user.id,
  };

  const outreachInsertPayload = {
    ...baseInsertPayload,
    connection_note_template: connectionNoteTemplate?.trim() || null,
    quota_policy: quotaPolicy || "conservative",
    integration_mode: integrationMode || "dashboard",
  };

  const { data, error } = await admin
    .from("campaigns")
    .insert(outreachInsertPayload)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaign = mapCampaignRow(data as Record<string, unknown>);
  return NextResponse.json({
    ...campaign,
    totalContacts: 0,
    contactedCount: 0,
    repliedCount: 0,
    convertedCount: 0,
  });
}
