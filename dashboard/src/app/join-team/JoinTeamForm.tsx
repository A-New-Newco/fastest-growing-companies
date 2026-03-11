"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClientSupabaseClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"

interface Team {
  id: string
  name: string
  slug: string
}

export default function JoinTeamForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const wasRejected = searchParams.get("rejected") === "true"
  const { user, signOut } = useAuth()

  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string>("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClientSupabaseClient()
    supabase
      .from("teams")
      .select("id, name, slug")
      .then(({ data }) => {
        if (data) {
          setTeams(data)
          if (data.length === 1) setSelectedTeam(data[0].id)
        }
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedTeam) return
    setError(null)
    setLoading(true)

    const res = await fetch("/api/team/join-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: selectedTeam, message }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? "Error while sending the request.")
      setLoading(false)
      return
    }

    router.push("/pending-approval")
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Request access</h1>
          <p className="mt-1 text-sm text-slate-500">Select the team you want to join</p>
        </div>

        {wasRejected && (
          <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
            Your previous request was rejected. You can submit a new one with an additional message.
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="space-y-2">
              {teams.map((team) => (
                <label
                  key={team.id}
                  className={`flex items-center gap-3 rounded-md border px-4 py-3 cursor-pointer transition-colors ${
                    selectedTeam === team.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="team"
                    value={team.id}
                    checked={selectedTeam === team.id}
                    onChange={() => setSelectedTeam(team.id)}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm font-medium text-slate-900">{team.name}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1">
              <label htmlFor="message" className="block text-xs font-medium text-slate-600 uppercase tracking-wider">
                Message (optional)
              </label>
              <textarea
                id="message"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                placeholder="Introduce yourself briefly or explain why you want access..."
              />
            </div>

            <button
              type="submit"
              disabled={loading || !selectedTeam}
              className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {loading ? "Sending..." : "Send request"}
            </button>
          </form>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-400">{user?.email}</span>
          <button onClick={() => signOut()} className="text-slate-500 hover:text-slate-700 transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
