import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// GET /api/annotations?year=2026
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const year = req.nextUrl.searchParams.get("year") ?? "2026";

  const { data, error } = await supabase
    .from("annotations")
    .select("id, company_id, contact_left, low_quality, note, updated_at, companies!inner(source_id, sources!inner(year))")
    .eq("companies.sources.year", parseInt(year));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/annotations
// Body: { company_id, contact_left, low_quality, note }
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve the user's team
  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a team member" }, { status: 403 });
  }

  const body = await req.json();
  const { company_id, contact_left, low_quality, note } = body;

  if (!company_id) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("annotations")
    .upsert(
      {
        company_id,
        team_id: membership.team_id,
        user_id: user.id,
        contact_left: contact_left ?? false,
        low_quality: low_quality ?? false,
        note: note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id,company_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
