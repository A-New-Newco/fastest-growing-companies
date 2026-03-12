import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "compound-beta-mini";

const LINKEDIN_PROFILE_RE =
  /https?:\/\/(www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)\/?/i;

// Legal suffixes to strip from company names before searching
const LEGAL_SUFFIX_RE =
  /[\s,]+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?a\.?p\.?a\.?|s\.?r\.?l\.?s\.?|s\.?a\.?|s\.?l\.?|gmbh|ag|kg|gbr|ohg|ug|b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|inc\.?|corp\.?|plc\.?)\.?$/i;

function stripLegalSuffix(name: string): string {
  return name.replace(LEGAL_SUFFIX_RE, "").trim();
}

function extractLinkedInUrl(text: string): string | null {
  const match = text.match(LINKEDIN_PROFILE_RE);
  if (!match) return null;
  // Reject company pages that might have slipped through
  if (text.includes("/company/")) return null;
  const slug = match[2].replace(/\/$/, "");
  return `https://www.linkedin.com/in/${slug}`;
}

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

  const cleanCompanyName = stripLegalSuffix(companyName);
  const query = `${cleanCompanyName} ${contactName} site:linkedin.com`;

  // Call Groq compound-beta-mini — it automatically uses web search
  const groqRes = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Find the LinkedIn personal profile URL of ${contactName} who works at ${cleanCompanyName}. Use this search query: "${query}". Return ONLY the LinkedIn profile URL in the format https://www.linkedin.com/in/username, or the word "null" if not found. Do not include any explanation.`,
        },
      ],
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    return NextResponse.json(
      { error: `Groq API error ${groqRes.status}: ${err}` },
      { status: 502 }
    );
  }

  const groqJson = await groqRes.json();
  const rawText: string = groqJson.choices?.[0]?.message?.content ?? "";

  const linkedinUrl = extractLinkedInUrl(rawText);

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
    query,
  });
}
