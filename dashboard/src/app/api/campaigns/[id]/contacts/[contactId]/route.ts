import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string; contactId: string } };

// PATCH /api/campaigns/[id]/contacts/[contactId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS ensures only team members can see/update this contact
  const { data: existing } = await supabase
    .from("campaign_contacts")
    .select("id, status, claimed_by, claim_expires_at, last_attempt_at, last_error_code")
    .eq("id", params.contactId)
    .eq("campaign_id", params.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    updates.status = body.status;
    // Auto-set timestamps on status transitions
    if (body.status === "contacted" && existing.status === "pending") {
      updates.contacted_at = new Date().toISOString();
    }
    if (
      body.status === "replied" &&
      !["replied", "meeting_scheduled", "converted"].includes(existing.status)
    ) {
      updates.replied_at = new Date().toISOString();
    }
  }

  if (body.notes !== undefined) updates.notes = body.notes ?? null;
  if (body.contactName !== undefined) updates.contact_name = body.contactName ?? null;
  if (body.contactRole !== undefined) updates.contact_role = body.contactRole ?? null;
  if (body.contactLinkedin !== undefined) updates.contact_linkedin = body.contactLinkedin ?? null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("campaign_contacts")
    .update(updates)
    .eq("id", params.contactId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    campaignId: data.campaign_id,
    companyId: data.company_id,
    contactName: data.contact_name,
    contactRole: data.contact_role,
    contactLinkedin: data.contact_linkedin,
    status: data.status,
    notes: data.notes,
    contactedAt: data.contacted_at,
    repliedAt: data.replied_at,
    claimedBy: data.claimed_by,
    claimExpiresAt: data.claim_expires_at,
    lastAttemptAt: data.last_attempt_at,
    lastErrorCode: data.last_error_code,
    addedBy: data.added_by,
    addedAt: data.added_at,
    updatedAt: data.updated_at,
  });
}

// DELETE /api/campaigns/[id]/contacts/[contactId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("campaign_contacts")
    .select("id")
    .eq("id", params.contactId)
    .eq("campaign_id", params.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("campaign_contacts")
    .delete()
    .eq("id", params.contactId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
