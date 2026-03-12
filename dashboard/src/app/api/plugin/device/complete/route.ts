import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  buildPluginToken,
  requireDashboardUserTeam,
  sha256,
} from "@/lib/plugin/auth";

const TOKEN_TTL_DAYS = 30;

// POST /api/plugin/device/complete
export async function POST(req: NextRequest) {
  const identity = await requireDashboardUserTeam();
  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const pairCode = String(body?.pairCode ?? "").trim().toUpperCase();
  const pairSecret = String(body?.pairSecret ?? "").trim();

  if (!pairCode || !pairSecret) {
    return NextResponse.json(
      { error: "pairCode and pairSecret are required" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: session, error } = await admin
    .from("plugin_device_sessions")
    .select("id, pair_secret_hash, expires_at, status")
    .eq("pair_code", pairCode)
    .maybeSingle();

  if (error || !session) {
    return NextResponse.json({ error: "Pairing session not found" }, { status: 404 });
  }

  if (session.status !== "pending") {
    return NextResponse.json({ error: "Pairing session is not pending" }, { status: 409 });
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await admin
      .from("plugin_device_sessions")
      .update({ status: "expired" })
      .eq("id", session.id);

    return NextResponse.json({ error: "Pairing session expired" }, { status: 410 });
  }

  if (sha256(pairSecret) !== session.pair_secret_hash) {
    return NextResponse.json({ error: "Invalid pairSecret" }, { status: 401 });
  }

  const pluginToken = buildPluginToken();
  const pluginTokenExpiresAt = new Date(
    Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: updated, error: updateError } = await admin
    .from("plugin_device_sessions")
    .update({
      status: "paired",
      user_id: identity.userId,
      team_id: identity.teamId,
      paired_at: new Date().toISOString(),
      plugin_token_hash: sha256(pluginToken),
      plugin_token_expires_at: pluginTokenExpiresAt,
    })
    .eq("id", session.id)
    .select("id, user_id, team_id, plugin_token_expires_at")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Pairing failed" }, { status: 500 });
  }

  return NextResponse.json({
    deviceSessionId: updated.id,
    userId: updated.user_id,
    teamId: updated.team_id,
    pluginToken,
    pluginTokenExpiresAt: updated.plugin_token_expires_at,
  });
}
