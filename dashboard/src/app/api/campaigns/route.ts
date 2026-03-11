import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

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
    .select(
      `
      id, team_id, name, description, status, created_by, created_at, updated_at,
      campaign_contacts(status)
    `
    )
    .eq("team_id", membership.team_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Compute stats from raw contacts array
  const campaigns = (data ?? []).map((row) => {
    const contacts = (row.campaign_contacts ?? []) as Array<{ status: string }>;
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      status: row.status,
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
  });

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
  const { name, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("campaigns")
    .insert({
      team_id: membership.team_id,
      name: name.trim(),
      description: description?.trim() || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    teamId: data.team_id,
    name: data.name,
    description: data.description,
    status: data.status,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    totalContacts: 0,
    contactedCount: 0,
    repliedCount: 0,
    convertedCount: 0,
  });
}
