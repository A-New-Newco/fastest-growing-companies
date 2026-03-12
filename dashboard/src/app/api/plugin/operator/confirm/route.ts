import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePluginSession } from "@/lib/plugin/auth";

// POST /api/plugin/operator/confirm
export async function POST(req: NextRequest) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const fullName = String(body?.fullName ?? "").trim();
  const headline = String(body?.headline ?? "").trim();
  const linkedinUrl = String(body?.linkedinUrl ?? "").trim();
  const confidence = Math.max(0, Math.min(1, Number(body?.confidence ?? 0)));
  const htmlHash = String(body?.htmlHash ?? "").trim();

  if (!fullName || !linkedinUrl || !htmlHash) {
    return NextResponse.json(
      { error: "fullName, linkedinUrl and htmlHash are required" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabaseClient();
  const nowIso = new Date().toISOString();
  const payload = {
    user_id: auth.context.userId,
    team_id: auth.context.teamId,
    linkedin_url: linkedinUrl,
    full_name: fullName,
    headline: headline || null,
    confidence,
    source: "groq",
    html_hash: htmlHash,
    verified_at: nowIso,
  };

  const { data, error } = await admin
    .from("plugin_operator_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, team_id, linkedin_url, full_name, headline, confidence, source, html_hash, verified_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Unable to save profile" }, { status: 500 });
  }

  return NextResponse.json({
    userId: data.user_id,
    teamId: data.team_id,
    linkedinUrl: data.linkedin_url,
    fullName: data.full_name,
    headline: data.headline,
    confidence: data.confidence,
    source: data.source,
    htmlHash: data.html_hash,
    verifiedAt: data.verified_at,
  });
}
