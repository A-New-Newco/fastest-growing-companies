"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClientSupabaseClient } from "@/lib/supabase/client"

export default function SignupPage() {
  const router = useRouter()

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClientSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    if (data.session) {
      router.push("/join-team")
      router.refresh()
    } else {
      setEmailSent(true)
    }
    setLoading(false)
  }

  if (emailSent) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
          <div className="text-4xl">📬</div>
          <h1 className="text-lg font-semibold text-slate-900">Check your email</h1>
          <p className="text-sm text-slate-500">
            We sent a confirmation link to{" "}
            <span className="font-medium text-slate-700">{email}</span>.
            Click the link to complete your sign-up.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Sign up</h1>
          <p className="mt-1 text-sm text-slate-500">Leaders of Growth Dashboard</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="fullName" className="block text-xs font-medium text-slate-600 uppercase tracking-wider">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="email" className="block text-xs font-medium text-slate-600 uppercase tracking-wider">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="name@example.com"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="block text-xs font-medium text-slate-600 uppercase tracking-wider">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md bg-white border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Minimum 8 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-600 hover:text-indigo-500 font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
