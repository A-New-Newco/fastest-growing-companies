import { NextRequest, NextResponse } from "next/server";
import { requirePluginSession, sha256 } from "@/lib/plugin/auth";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_HTML_SIZE = 750_000;

function cleanHtmlInput(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function fallbackParse(html: string, profileUrl: string | null) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  const titleText = titleMatch ? stripTags(titleMatch[1]) : "";
  const h1Text = h1Match ? stripTags(h1Match[1]) : "";

  const fullName = h1Text || titleText.split("|")[0]?.trim() || "";
  return {
    fullName,
    headline: "",
    linkedinUrl: profileUrl ?? "",
    confidence: fullName ? 0.35 : 0.1,
    parser: "fallback" as const,
  };
}

async function callGroq(html: string, profileUrl: string | null): Promise<{
  fullName: string;
  headline: string;
  linkedinUrl: string;
  confidence: number;
}> {
  const apiKey = process.env.GROQ_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("GROQ_API_KEY missing");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract LinkedIn operator profile metadata from HTML. Return only JSON with keys: fullName, headline, linkedinUrl, confidence. confidence must be 0..1.",
        },
        {
          role: "user",
          content: [
            `profileUrlHint: ${profileUrl ?? ""}`,
            "html:",
            html,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq API error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const content: string = payload?.choices?.[0]?.message?.content ?? "{}";

  const parsed = JSON.parse(content) as {
    fullName?: string;
    headline?: string;
    linkedinUrl?: string;
    confidence?: number;
  };

  return {
    fullName: String(parsed.fullName ?? "").trim(),
    headline: String(parsed.headline ?? "").trim(),
    linkedinUrl: String(parsed.linkedinUrl ?? profileUrl ?? "").trim(),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
  };
}

// POST /api/plugin/operator/parse-profile
export async function POST(req: NextRequest) {
  const auth = await requirePluginSession(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const htmlRaw = String(body?.html ?? "");
  const profileUrl = body?.profileUrl ? String(body.profileUrl) : null;

  if (!htmlRaw) {
    return NextResponse.json({ error: "html is required" }, { status: 400 });
  }

  if (htmlRaw.length > MAX_HTML_SIZE) {
    return NextResponse.json(
      { error: `html too large (max ${MAX_HTML_SIZE} chars)` },
      { status: 413 }
    );
  }

  const html = cleanHtmlInput(htmlRaw);
  const htmlHash = sha256(html);

  try {
    const parsed = await callGroq(html, profileUrl);
    const fallback = fallbackParse(html, profileUrl);

    return NextResponse.json({
      parser: parsed.fullName ? "groq" : "fallback",
      fullName: parsed.fullName || fallback.fullName,
      headline: parsed.headline || fallback.headline,
      linkedinUrl: parsed.linkedinUrl || fallback.linkedinUrl,
      confidence: parsed.fullName ? parsed.confidence : fallback.confidence,
      htmlHash,
      userId: auth.context.userId,
      teamId: auth.context.teamId,
    });
  } catch {
    const fallback = fallbackParse(html, profileUrl);
    return NextResponse.json({
      ...fallback,
      htmlHash,
      userId: auth.context.userId,
      teamId: auth.context.teamId,
    });
  }
}
