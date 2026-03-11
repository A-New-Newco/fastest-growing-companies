import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Params = { params: { id: string } };

// GET /api/campaigns/[id]/contacts
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch raw contact rows
  const { data: contactRows, error } = await supabase
    .from("campaign_contacts")
    .select(
      "id, campaign_id, company_id, contact_name, contact_role, contact_linkedin, status, notes, contacted_at, replied_at, added_by, added_at, updated_at"
    )
    .eq("campaign_id", params.id)
    .order("added_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch company display data from companies_full view (name, sector, region)
  const companyIds = [...new Set((contactRows ?? []).map((r) => r.company_id))];
  const companyMap: Record<string, { name: string; sector: string; region: string }> = {};

  if (companyIds.length > 0) {
    const { data: companyRows } = await supabase
      .from("companies_full")
      .select("id, name, sector, region")
      .in("id", companyIds);

    for (const c of companyRows ?? []) {
      companyMap[c.id] = { name: c.name, sector: c.sector ?? "", region: c.region ?? "" };
    }
  }

  const contacts = (contactRows ?? []).map((row) => {
    const company = companyMap[row.company_id];
    return {
      id: row.id,
      campaignId: row.campaign_id,
      companyId: row.company_id,
      companyName: company?.name ?? null,
      companySector: company?.sector ?? null,
      companyRegion: company?.region ?? null,
      contactName: row.contact_name,
      contactRole: row.contact_role,
      contactLinkedin: row.contact_linkedin,
      status: row.status,
      notes: row.notes,
      contactedAt: row.contacted_at,
      repliedAt: row.replied_at,
      addedBy: row.added_by,
      addedAt: row.added_at,
      updatedAt: row.updated_at,
    };
  });

  return NextResponse.json(contacts);
}

// POST /api/campaigns/[id]/contacts — bulk add companies as contacts
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify campaign exists and user has access (RLS enforces team scope)
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const body = await req.json();
  const companies: Array<{
    companyId: string;
    contactName: string | null;
    contactRole: string | null;
    contactLinkedin: string | null;
  }> = body.companies ?? [];

  if (companies.length === 0) {
    return NextResponse.json({ error: "companies array is required" }, { status: 400 });
  }

  const rows = companies.map((c) => ({
    campaign_id: params.id,
    company_id: c.companyId,
    contact_name: c.contactName ?? null,
    contact_role: c.contactRole ?? null,
    contact_linkedin: c.contactLinkedin ?? null,
    added_by: user.id,
  }));

  const admin = createAdminSupabaseClient();
  const { data, error: insertError } = await admin
    .from("campaign_contacts")
    .upsert(rows, { onConflict: "campaign_id,company_id", ignoreDuplicates: false })
    .select();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data?.length ?? 0 });
}
