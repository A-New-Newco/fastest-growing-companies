import { createServerSupabaseClient } from "@/lib/supabase/server"
import RequestsClient from "./RequestsClient"

export default async function AdminRequestsPage() {
  const supabase = createServerSupabaseClient()

  const { data: requests } = await supabase
    .from("join_requests")
    .select(
      `
      id,
      status,
      message,
      created_at,
      team_id,
      profiles!join_requests_user_id_fkey (id, email, full_name),
      teams (name)
    `
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })

  // Supabase infers joined types as single-object but returns arrays at runtime;
  // cast to avoid the TypeScript structural mismatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <RequestsClient requests={(requests ?? []) as any} />
}
