import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { findLinkedIn } from "@/lib/linkedin-finder";

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { companyId, companyName, contactName, dataOrigin } = body as {
    companyId?: string;          // optional — omit to skip DB save (e.g. CFO monitor)
    companyName: string;
    contactName: string;
    dataOrigin?: "curated" | "imported";
  };

  if (!companyName || !contactName) {
    return NextResponse.json(
      { error: "companyName and contactName are required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const { url: linkedinUrl } = await findLinkedIn(companyName, contactName, apiKey);

  // Save to DB if found and companyId provided
  if (linkedinUrl && companyId) {
    const admin = createAdminSupabaseClient();

    if (dataOrigin === "imported") {
      await admin
        .from("imported_companies")
        .update({ cfo_linkedin: linkedinUrl })
        .eq("id", companyId);
    } else {
      // Curated: update contacts.linkedin where company_id matches
      const { data: updated, error: updateErr } = await admin
        .from("contacts")
        .update({ linkedin: linkedinUrl })
        .eq("company_id", companyId)
        .select("id");

      if (updateErr) {
        console.error("contacts update error:", updateErr);
      } else if (!updated || updated.length === 0) {
        // No contacts row yet — insert a minimal one
        await admin.from("contacts").insert({
          company_id: companyId,
          name: contactName,
          linkedin: linkedinUrl,
        });
      }
    }
  }

  return NextResponse.json({
    linkedinUrl,
    found: !!linkedinUrl,
  });
}
