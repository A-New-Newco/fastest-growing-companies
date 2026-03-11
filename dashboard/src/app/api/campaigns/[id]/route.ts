import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// GET /api/campaigns/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("campaigns")
    .select(
      `
      id, team_id, name, description, status, connection_note_template, quota_policy, pause_reason, integration_mode, created_by, created_at, updated_at,
      campaign_contacts(status)
    `
    )
    .eq("id", params.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contacts = (row.campaign_contacts ?? []) as Array<{ status: string }>;
  return NextResponse.json({
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    status: row.status,
    connectionNoteTemplate: row.connection_note_template,
    quotaPolicy: row.quota_policy,
    pauseReason: row.pause_reason,
    integrationMode: row.integration_mode,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalContacts: contacts.length,
    contactedCount: contacts.filter((c) => c.status !== "pending").length,
    repliedCount: contacts.filter((c) =>
      ["replied", "meeting_scheduled", "converted"].includes(c.status)
    ).length,
    convertedCount: contacts.filter((c) => c.status === "converted").length,
  });
}

// PATCH /api/campaigns/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the campaign belongs to the user's team (RLS handles this, but explicit check)
  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.status !== undefined) updates.status = body.status;
  if (body.connectionNoteTemplate !== undefined) {
    updates.connection_note_template = body.connectionNoteTemplate?.trim() || null;
  }
  if (body.quotaPolicy !== undefined) updates.quota_policy = body.quotaPolicy;
  if (body.pauseReason !== undefined) updates.pause_reason = body.pauseReason?.trim() || null;
  if (body.integrationMode !== undefined) updates.integration_mode = body.integrationMode;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("campaigns")
    .update(updates)
    .eq("id", params.id)
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
    connectionNoteTemplate: data.connection_note_template,
    quotaPolicy: data.quota_policy,
    pauseReason: data.pause_reason,
    integrationMode: data.integration_mode,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

// DELETE /api/campaigns/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("campaigns").delete().eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
