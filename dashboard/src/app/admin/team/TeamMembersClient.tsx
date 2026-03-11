"use client"

import { useMemo, useState } from "react"

interface Profile {
  id: string
  email: string
  full_name: string | null
}

interface Team {
  id: string
  name: string
  slug: string
}

interface TeamMembership {
  id: string
  team_id: string
  user_id: string
  role: "admin" | "member"
  created_at: string
  profiles: Profile | Profile[] | null
  teams: Team | Team[] | null
}

interface JoinRequest {
  id: string
  status: "pending" | "approved" | "rejected"
  message: string | null
  created_at: string
  team_id: string
  profiles: Profile | Profile[] | null
  teams: Team | Team[] | null
}

interface TeamGroup {
  teamId: string
  teamName: string
  members: TeamMembership[]
  adminCount: number
  requests: JoinRequest[]
}

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function getDisplayNameFromProfile(profile: Profile | null, fallback: string): string {
  return profile?.full_name || profile?.email || fallback
}

function getDisplayName(member: TeamMembership): string {
  const profile = firstOrNull(member.profiles)
  return getDisplayNameFromProfile(profile, member.user_id)
}

function getEmail(member: TeamMembership): string {
  const profile = firstOrNull(member.profiles)
  return profile?.email || "Unknown email"
}

function getRequestDisplayName(request: JoinRequest): string {
  const profile = firstOrNull(request.profiles)
  return getDisplayNameFromProfile(profile, request.id)
}

function getRequestEmail(request: JoinRequest): string {
  const profile = firstOrNull(request.profiles)
  return profile?.email || "Unknown email"
}

function getTeamNameFromMembership(membership: TeamMembership): string {
  return firstOrNull(membership.teams)?.name ?? "Unknown team"
}

function getTeamNameFromRequest(request: JoinRequest): string {
  return firstOrNull(request.teams)?.name ?? "Unknown team"
}

export default function TeamMembersClient({
  currentUserId,
  memberships: initialMemberships,
  requests: initialRequests,
}: {
  currentUserId: string
  memberships: TeamMembership[]
  requests: JoinRequest[]
}) {
  const [memberships, setMemberships] = useState(initialMemberships)
  const [requests, setRequests] = useState(initialRequests)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo<TeamGroup[]>(() => {
    const grouped = new Map<string, TeamGroup>()

    for (const membership of memberships) {
      const teamName = getTeamNameFromMembership(membership)
      const existing = grouped.get(membership.team_id)
      if (!existing) {
        grouped.set(membership.team_id, {
          teamId: membership.team_id,
          teamName,
          members: [membership],
          adminCount: membership.role === "admin" ? 1 : 0,
          requests: [],
        })
      } else {
        existing.members.push(membership)
        if (membership.role === "admin") existing.adminCount += 1
      }
    }

    for (const request of requests) {
      const teamName = getTeamNameFromRequest(request)
      const existing = grouped.get(request.team_id)
      if (!existing) {
        grouped.set(request.team_id, {
          teamId: request.team_id,
          teamName,
          members: [],
          adminCount: 0,
          requests: [request],
        })
      } else {
        existing.requests.push(request)
      }
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        members: [...group.members].sort((a, b) => {
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1
          return getDisplayName(a).localeCompare(getDisplayName(b))
        }),
        requests: [...group.requests].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName))
  }, [memberships, requests])

  async function reviewRequest(request: JoinRequest, action: "approve" | "reject") {
    const key = `review:${request.id}`
    setPending((p) => ({ ...p, [key]: true }))
    setError(null)

    const res = await fetch("/api/admin/review-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: request.id, action }),
    })

    setPending((p) => ({ ...p, [key]: false }))

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const apiError = typeof body?.error === "string" ? body.error : "Failed to review request"

      if (res.status === 403) setError("You are not allowed to review this request.")
      else if (res.status === 404) setError("The selected request does not exist anymore.")
      else if (res.status === 409) setError("This request has already been reviewed.")
      else setError(apiError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.id !== request.id))

    if (action === "approve") {
      const profile = firstOrNull(request.profiles)
      if (profile?.id) {
        setMemberships((prev) => {
          const alreadyMember = prev.some(
            (membership) =>
              membership.team_id === request.team_id && membership.user_id === profile.id
          )
          if (alreadyMember) return prev

          return [
            ...prev,
            {
              id: `approved-${request.id}`,
              team_id: request.team_id,
              user_id: profile.id,
              role: "member",
              created_at: new Date().toISOString(),
              profiles: request.profiles,
              teams: request.teams,
            },
          ]
        })
      }
    }
  }

  async function revokeAccess(member: TeamMembership) {
    const key = `revoke:${member.team_id}:${member.user_id}`
    const name = getDisplayName(member)
    const team = firstOrNull(member.teams)

    if (!window.confirm(`Revoke access for ${name} from ${team?.name ?? "this team"}?`)) {
      return
    }

    setPending((p) => ({ ...p, [key]: true }))
    setError(null)

    const res = await fetch("/api/admin/team-members/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_id: member.team_id,
        user_id: member.user_id,
      }),
    })

    setPending((p) => ({ ...p, [key]: false }))

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const apiError = typeof body?.error === "string" ? body.error : "Failed to revoke access"

      if (res.status === 400) setError(apiError)
      else if (res.status === 403) setError("You are not allowed to revoke this member.")
      else if (res.status === 404) setError("The selected member is no longer in this team.")
      else if (res.status === 409) setError("Cannot revoke the last admin of this team.")
      else setError(apiError)
      return
    }

    setMemberships((prev) =>
      prev.filter((m) => !(m.team_id === member.team_id && m.user_id === member.user_id))
    )
  }

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8">
      <div className="pb-4 mb-6 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Team management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review access requests and manage members for teams where you are admin.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          No teams found where you have admin permissions.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section
              key={group.teamId}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                <h2 className="text-sm font-semibold text-slate-900">{group.teamName}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {group.members.length} member{group.members.length !== 1 ? "s" : ""} ·{" "}
                  {group.adminCount} admin{group.adminCount !== 1 ? "s" : ""} ·{" "}
                  {group.requests.length} pending request{group.requests.length !== 1 ? "s" : ""}
                </p>
              </div>

              <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/40">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                  Pending access requests
                </h3>
              </div>
              {group.requests.length === 0 ? (
                <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-400">
                  No pending requests for this team.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border-b border-slate-100">
                  {group.requests.map((request) => {
                    const key = `review:${request.id}`
                    const isReviewing = !!pending[key]
                    return (
                      <div key={request.id} className="px-4 py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {getRequestDisplayName(request)}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">{getRequestEmail(request)}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Requested {new Date(request.created_at).toLocaleString("en-GB")}
                          </p>
                          {request.message && (
                            <p className="mt-2 text-sm text-slate-600 bg-white rounded-md px-3 py-2 border border-slate-100">
                              {request.message}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => reviewRequest(request, "approve")}
                            disabled={isReviewing}
                            className="rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => reviewRequest(request, "reject")}
                            disabled={isReviewing}
                            className="rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Team members
                </h3>
              </div>

              <div className="divide-y divide-slate-100">
                {group.members.map((member) => {
                  const isSelf = member.user_id === currentUserId
                  const isLastAdmin = member.role === "admin" && group.adminCount <= 1
                  const key = `revoke:${member.team_id}:${member.user_id}`
                  const isRevoking = !!pending[key]

                  return (
                    <div key={member.id} className="px-4 py-3 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {getDisplayName(member)}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{getEmail(member)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Joined {new Date(member.created_at).toLocaleString("en-GB")}
                        </p>
                      </div>

                      <div className="flex items-end sm:items-center gap-2 shrink-0 flex-col sm:flex-row">
                        <span
                          className={
                            member.role === "admin"
                              ? "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700"
                              : "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700"
                          }
                        >
                          {member.role}
                        </span>

                        {isSelf ? (
                          <span className="text-xs text-slate-400">You</span>
                        ) : (
                          <button
                            onClick={() => revokeAccess(member)}
                            disabled={isRevoking || isLastAdmin}
                            className="rounded-md px-3 py-1.5 text-xs font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title={isLastAdmin ? "Cannot revoke the last admin" : "Revoke access"}
                          >
                            {isRevoking ? "Revoking..." : "Revoke access"}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
