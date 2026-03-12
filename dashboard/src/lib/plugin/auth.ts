import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface PluginSessionContext {
  sessionId: string;
  userId: string;
  teamId: string;
  tokenHash: string;
  tokenExpiresAt: string;
}

export function buildPairCode(length = 6): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const raw = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[raw[i] % alphabet.length];
  }
  return code;
}

export function buildSecret(size = 24): string {
  return randomBytes(size).toString("base64url");
}

export function buildPluginToken(): string {
  return `ptk_${randomBytes(24).toString("hex")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function requirePluginSession(
  req: NextRequest
): Promise<{ context: PluginSessionContext } | { error: NextResponse }> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      error: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }),
    };
  }

  const admin = createAdminSupabaseClient();
  const tokenHash = sha256(token);

  const { data: session, error } = await admin
    .from("plugin_device_sessions")
    .select("id, user_id, team_id, status, plugin_token_hash, plugin_token_expires_at")
    .eq("plugin_token_hash", tokenHash)
    .eq("status", "paired")
    .maybeSingle();

  if (error || !session) {
    return {
      error: NextResponse.json({ error: "Invalid plugin token" }, { status: 401 }),
    };
  }

  if (!session.user_id || !session.team_id || !session.plugin_token_expires_at) {
    return {
      error: NextResponse.json({ error: "Plugin session is incomplete" }, { status: 401 }),
    };
  }

  if (new Date(session.plugin_token_expires_at).getTime() <= Date.now()) {
    await admin
      .from("plugin_device_sessions")
      .update({ status: "expired" })
      .eq("id", session.id);

    return {
      error: NextResponse.json({ error: "Plugin token expired" }, { status: 401 }),
    };
  }

  return {
    context: {
      sessionId: session.id,
      userId: session.user_id,
      teamId: session.team_id,
      tokenHash,
      tokenExpiresAt: session.plugin_token_expires_at,
    },
  };
}

export async function requireDashboardUserTeam(): Promise<
  { userId: string; teamId: string } | null
> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.team_id) return null;

  return { userId: user.id, teamId: membership.team_id };
}
