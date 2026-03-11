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

  const { team_id, message } = await req.json()

  if (!team_id) {
    return NextResponse.json({ error: "team_id is required" }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()

  // Ensure the profile row exists (may be missing if trigger wasn't active at signup)
  await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name ?? null,
    },
    { onConflict: "id" }
  )

  const { data, error } = await admin
    .from("join_requests")
    .upsert(
      {
        team_id,
        user_id: user.id,
        message: message || null,
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
      },
      { onConflict: "team_id,user_id" }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
