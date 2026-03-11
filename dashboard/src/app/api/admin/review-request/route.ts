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

  // Verify the caller is an admin in any team
  const { data: membership } = await supabase
    .from("team_memberships")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle()

  if (membership?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { request_id, action } = await req.json()

  if (!request_id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()

  // Update join_request status
  const { data: joinRequest, error: updateError } = await admin
    .from("join_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", request_id)
    .select()
    .single()

  if (updateError || !joinRequest) {
    return NextResponse.json(
      { error: updateError?.message ?? "Request not found" },
      { status: 500 }
    )
  }

  // If approving, create team membership
  if (action === "approve") {
    const { error: memberError } = await admin.from("team_memberships").insert({
      team_id: joinRequest.team_id,
      user_id: joinRequest.user_id,
      role: "member",
    })

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
