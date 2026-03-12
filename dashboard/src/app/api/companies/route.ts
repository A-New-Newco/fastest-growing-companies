import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// DELETE /api/companies — bulk delete imported companies for current team
export async function DELETE(req: NextRequest) {
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

  const body = await req.json().catch(() => null);
  const requestedIds = Array.isArray(body?.companyIds)
    ? body.companyIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const companyIds = [...new Set(requestedIds)];

  if (companyIds.length === 0) {
    return NextResponse.json({ error: "companyIds array is required" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("imported_companies")
    .select("id")
    .eq("team_id", membership.team_id)
    .in("id", companyIds);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const deletableIds = (existing ?? []).map((row) => row.id);

  if (deletableIds.length === 0) {
    return NextResponse.json(
      {
        error: "No imported companies found for the selected ids",
        deletedCount: 0,
        requestedCount: companyIds.length,
      },
      { status: 404 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { error: deleteError } = await admin
    .from("imported_companies")
    .delete()
    .eq("team_id", membership.team_id)
    .in("id", deletableIds);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    deletedIds: deletableIds,
    deletedCount: deletableIds.length,
    requestedCount: companyIds.length,
    ignoredCount: companyIds.length - deletableIds.length,
  });
}
