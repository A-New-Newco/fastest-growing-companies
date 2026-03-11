"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface Profile {
  id: string
  email: string
  full_name: string | null
}

interface JoinRequest {
  id: string
  status: string
  message: string | null
  created_at: string
  team_id: string
  profiles: Profile[] | null
  teams: { name: string }[] | null
}

export default function RequestsClient({ requests }: { requests: JoinRequest[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, "approved" | "rejected">>({})

  async function review(requestId: string, action: "approve" | "reject") {
    setPending((p) => ({ ...p, [requestId]: true }))

    const res = await fetch("/api/admin/review-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, action }),
    })

    setPending((p) => ({ ...p, [requestId]: false }))

    if (res.ok) {
      setDone((d) => ({ ...d, [requestId]: action === "approve" ? "approved" : "rejected" }))
      router.refresh()
    }
  }

  const activeRequests = requests.filter((r) => !done[r.id])

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8">
      <div className="pb-4 mb-6 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Access requests</h1>
        <p className="mt-1 text-sm text-slate-500">
          {activeRequests.length === 0
            ? "No pending requests"
            : `${activeRequests.length} request${activeRequests.length !== 1 ? "s" : ""} awaiting approval`}
        </p>
      </div>

      {activeRequests.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          No pending requests at the moment.
        </div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          {activeRequests.map((req) => {
            const profile = req.profiles?.[0]
            const team = req.teams?.[0]
            return (
              <div key={req.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {profile?.full_name || profile?.email}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {profile?.email} · {team?.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(req.created_at).toLocaleString("en-GB")}
                    </p>
                    {req.message && (
                      <p className="mt-2 text-sm text-slate-600 bg-slate-50 rounded-md px-3 py-2 border border-slate-100">
                        {req.message}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => review(req.id, "approve")}
                      disabled={pending[req.id]}
                      className="rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => review(req.id, "reject")}
                      disabled={pending[req.id]}
                      className="rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
