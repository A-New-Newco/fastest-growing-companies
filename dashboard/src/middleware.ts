import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

const PUBLIC_ROUTES = ["/login", "/signup", "/auth/callback"]
const LIMBO_ROUTES = ["/join-team", "/pending-approval"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r))
  const isLimboRoute = LIMBO_ROUTES.some((r) => pathname.startsWith(r))
  const isAdminRoute = pathname.startsWith("/admin")

  // IMPORTANT: supabaseResponse must be `let` so setAll can reassign it on token refresh
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Update the request cookies so the refreshed token is available for
          // subsequent DB queries in the same middleware invocation
          // Note: request.cookies.set() only accepts name + value (no options)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Recreate the base response so the refreshed token is sent to the browser
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: call getUser() immediately — no logic between createServerClient and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Helper: redirect while preserving refreshed session cookies
  function redirect(url: string | URL) {
    const dest = typeof url === "string" ? new URL(url, request.url) : url
    const res = NextResponse.redirect(dest)
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c.name, c.value))
    return res
  }

  // --- Not authenticated ---
  if (!user) {
    if (!isPublicRoute) {
      const dest = new URL("/login", request.url)
      if (!isLimboRoute) dest.searchParams.set("redirectTo", pathname)
      return redirect(dest)
    }
    return supabaseResponse
  }

  // --- Authenticated: check membership ---
  if (!isPublicRoute) {
    const { data: membership, error: membershipError } = await supabase
      .from("team_memberships")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) {
      // DB query failed (likely auth issue) — force re-login
      console.error("[middleware] membership query error:", membershipError.message)
      return redirect("/login")
    }

    if (!membership) {
      // No membership — check join request status
      const { data: joinRequest } = await supabase
        .from("join_requests")
        .select("status")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!joinRequest || joinRequest.status === "rejected") {
        if (!isLimboRoute || pathname === "/pending-approval") {
          const dest = new URL("/join-team", request.url)
          if (joinRequest?.status === "rejected") dest.searchParams.set("rejected", "true")
          return redirect(dest)
        }
      } else if (joinRequest.status === "pending") {
        if (pathname !== "/pending-approval") {
          return redirect("/pending-approval")
        }
      }

      return supabaseResponse
    }

    // Has membership — kick out of limbo pages
    if (isLimboRoute) {
      return redirect("/")
    }

    // Admin-only routes
    if (isAdminRoute && membership.role !== "admin") {
      return redirect("/")
    }
  }

  // IMPORTANT: always return supabaseResponse so the browser receives
  // any refreshed session cookies
  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
