import { NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const teamId = typeof body?.team_id === "string" ? body.team_id : ""
  const targetUserId = typeof body?.user_id === "string" ? body.user_id : ""

  if (!teamId || !targetUserId) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "Self revoke is not allowed" }, { status: 400 })
  }

  const { data: callerAdminMembership, error: callerAdminMembershipError } = await supabase
    .from("team_memberships")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle()

  if (callerAdminMembershipError) {
    return NextResponse.json({ error: callerAdminMembershipError.message }, { status: 500 })
  }
  if (!callerAdminMembership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const admin = createAdminSupabaseClient()
  const { data: targetMembership, error: targetMembershipError } = await admin
    .from("team_memberships")
    .select("id, role")
    .eq("team_id", teamId)
    .eq("user_id", targetUserId)
    .maybeSingle()

  if (targetMembershipError) {
    return NextResponse.json({ error: targetMembershipError.message }, { status: 500 })
  }
  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 })
  }

  if (targetMembership.role === "admin") {
    const { count: adminCount, error: adminCountError } = await admin
      .from("team_memberships")
      .select("id", { head: true, count: "exact" })
      .eq("team_id", teamId)
      .eq("role", "admin")

    if (adminCountError) {
      return NextResponse.json({ error: adminCountError.message }, { status: 500 })
    }
    if ((adminCount ?? 0) <= 1) {
      return NextResponse.json({ error: "Cannot revoke the last admin" }, { status: 409 })
    }
  }

  const { error: deleteError } = await admin
    .from("team_memberships")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", targetUserId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
