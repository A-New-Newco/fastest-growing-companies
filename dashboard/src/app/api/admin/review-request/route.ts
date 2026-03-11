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
  const requestId = typeof body?.request_id === "string" ? body.request_id : ""
  const action = body?.action

  if (!requestId || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { data: joinRequest, error: joinRequestError } = await admin
    .from("join_requests")
    .select("id, team_id, user_id, status")
    .eq("id", requestId)
    .maybeSingle()

  if (joinRequestError) {
    return NextResponse.json({ error: joinRequestError.message }, { status: 500 })
  }
  if (!joinRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 })
  }

  // Verify the caller is admin for the request team
  const { data: membership, error: membershipError } = await supabase
    .from("team_memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("team_id", joinRequest.team_id)
    .eq("role", "admin")
    .maybeSingle()

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (joinRequest.status !== "pending") {
    return NextResponse.json({ error: "Request already reviewed" }, { status: 409 })
  }

  // Update join_request status
  const { data: reviewedRequest, error: updateError } = await admin
    .from("join_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id, team_id, user_id")
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }
  if (!reviewedRequest) {
    return NextResponse.json({ error: "Request already reviewed" }, { status: 409 })
  }

  // If approving, create team membership
  if (action === "approve") {
    const { error: memberError } = await admin.from("team_memberships").insert({
      team_id: reviewedRequest.team_id,
      user_id: reviewedRequest.user_id,
      role: "member",
    })

    if (memberError && memberError.code !== "23505") {
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
