import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import TeamMembersClient from "./TeamMembersClient"

export default async function AdminTeamPage() {
  const supabase = createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <TeamMembersClient currentUserId="" memberships={[]} requests={[]} />
  }

  const { data: adminMemberships, error: adminMembershipsError } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .eq("role", "admin")

  if (adminMembershipsError || !adminMemberships || adminMemberships.length === 0) {
    return <TeamMembersClient currentUserId={user.id} memberships={[]} requests={[]} />
  }

  const teamIds = [...new Set(adminMemberships.map((m) => m.team_id))]
  const admin = createAdminSupabaseClient()

  const { data: memberships } = await admin
    .from("team_memberships")
    .select(
      `
      id,
      team_id,
      user_id,
      role,
      created_at,
      profiles!team_memberships_user_id_fkey (id, email, full_name),
      teams (id, name, slug)
    `
    )
    .in("team_id", teamIds)
    .order("created_at", { ascending: true })

  const { data: requests } = await admin
    .from("join_requests")
    .select(
      `
      id,
      status,
      message,
      created_at,
      team_id,
      profiles!join_requests_user_id_fkey (id, email, full_name),
      teams (id, name, slug)
    `
    )
    .eq("status", "pending")
    .in("team_id", teamIds)
    .order("created_at", { ascending: true })

  // Supabase infers joined types as single-object but returns arrays at runtime;
  // cast to avoid the TypeScript structural mismatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const membershipsForClient = (memberships ?? []) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestsForClient = (requests ?? []) as any

  return (
    <TeamMembersClient
      currentUserId={user.id}
      memberships={membershipsForClient}
      requests={requestsForClient}
    />
  )
}
