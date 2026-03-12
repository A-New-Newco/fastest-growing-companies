import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { buildPairCode, buildSecret, sha256 } from "@/lib/plugin/auth";

const DEFAULT_EXPIRY_MINUTES = 15;

// POST /api/plugin/device/start
export async function POST(req: NextRequest) {
  const admin = createAdminSupabaseClient();

  const body = await req.json().catch(() => ({}));
  const requestedMinutes = Number(body?.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES);
  const expiryMinutes = Number.isFinite(requestedMinutes)
    ? Math.min(Math.max(requestedMinutes, 5), 60)
    : DEFAULT_EXPIRY_MINUTES;

  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pairCode = buildPairCode(6);
    const pairSecret = buildSecret(24);

    const { data, error } = await admin
      .from("plugin_device_sessions")
      .insert({
        pair_code: pairCode,
        pair_secret: pairSecret,
        pair_secret_hash: sha256(pairSecret),
        expires_at: expiresAt,
      })
      .select("id, pair_code, expires_at")
      .single();

    if (!error && data) {
      return NextResponse.json({
        deviceSessionId: data.id,
        pairCode: data.pair_code,
        pairSecret,
        expiresAt: data.expires_at,
      });
    }

    if (error && !error.message.toLowerCase().includes("duplicate")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "Unable to create device session, retry." },
    { status: 503 }
  );
}
