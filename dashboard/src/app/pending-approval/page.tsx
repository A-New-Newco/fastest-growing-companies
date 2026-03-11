"use client"

import { useAuth } from "@/lib/auth-context"

export default function PendingApprovalPage() {
  const { user, signOut } = useAuth()

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
        <div className="text-4xl">⏳</div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Request pending</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your access request has been submitted. A team admin will review it shortly.
          </p>
        </div>

        {user?.email && (
          <p className="text-xs text-slate-400">
            Account:{" "}
            <span className="font-medium text-slate-600">{user.email}</span>
          </p>
        )}

        <button
          onClick={() => signOut()}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors underline underline-offset-2"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
