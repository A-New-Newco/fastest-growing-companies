const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Models tried in order when rate limits are hit.
// Tier 1 – compound models: have built-in web search, best quality.
// Tier 2 – large LLMs: no live search, rely on training data; last resort.
const GROQ_MODEL_CHAIN = [
  "compound-beta-mini",       // tier 1 — fast compound
  "compound-beta",            // tier 1 — full compound
  "llama-3.3-70b-versatile",  // tier 2 — strong reasoning, no search
  "llama-3.1-8b-instant",     // tier 2 — fastest, no search
] as const;

const LINKEDIN_PROFILE_RE =
  /https?:\/\/(www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)\/?/i;

const LEGAL_SUFFIX_RE =
  /[\s,]+(?:s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?a\.?p\.?a\.?|s\.?r\.?l\.?s\.?|s\.?a\.?|s\.?l\.?|gmbh|ag|kg|gbr|ohg|ug|b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|inc\.?|corp\.?|plc\.?)\.?$/i;

export function stripLegalSuffix(name: string): string {
  return name.replace(LEGAL_SUFFIX_RE, "").trim();
}

export function extractLinkedInUrl(text: string): string | null {
  const match = text.match(LINKEDIN_PROFILE_RE);
  if (!match) return null;
  if (text.includes("/company/")) return null;
  const slug = match[2].replace(/\/$/, "");
  return `https://www.linkedin.com/in/${slug}`;
}

export interface LinkedInFinderResult {
  url: string | null;
  tokensInput: number;
  tokensOutput: number;
  modelUsed: string | null;
}

export async function findLinkedIn(
  companyName: string,
  contactName: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<LinkedInFinderResult> {
  const cleanCompanyName = stripLegalSuffix(companyName);
  const query = `${cleanCompanyName} ${contactName} site:linkedin.com`;

  const messages = [
    {
      role: "user",
      content: `Find the LinkedIn personal profile URL of ${contactName} who works at ${cleanCompanyName}. Use this search query: "${query}". Return ONLY the LinkedIn profile URL in the format https://www.linkedin.com/in/username, or the word "null" if not found. Do not include any explanation.`,
    },
  ];

  // Max seconds we're willing to wait on a retry-after before skipping to next model
  const MAX_WAIT_S = 30;

  for (const model of GROQ_MODEL_CHAIN) {
    let attempt = 0;
    while (attempt < 2) {
      const groqRes = await fetch(GROQ_API_URL, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 256, messages }),
      });

      if (groqRes.status === 429) {
        // Parse retry-after — Groq returns it in seconds (float or int)
        const retryAfterRaw =
          groqRes.headers.get("retry-after") ??
          groqRes.headers.get("x-ratelimit-reset-requests");
        const waitS = retryAfterRaw ? Math.ceil(parseFloat(retryAfterRaw)) : null;

        if (attempt === 0 && waitS !== null && waitS <= MAX_WAIT_S) {
          console.warn(
            `[linkedin-finder] rate limit on ${model}, waiting ${waitS}s then retrying`
          );
          await new Promise((resolve) => setTimeout(resolve, waitS * 1000));
          attempt++;
          continue;
        }

        // Wait too long or no header or already retried — skip to next model
        console.warn(`[linkedin-finder] rate limit on ${model}, skipping to next model`);
        break;
      }

      if (!groqRes.ok) return { url: null, tokensInput: 0, tokensOutput: 0, modelUsed: model };

      const groqJson = await groqRes.json();
      const rawText: string = groqJson.choices?.[0]?.message?.content ?? "";
      const usage = groqJson.usage;
      return {
        url: extractLinkedInUrl(rawText),
        tokensInput: usage?.prompt_tokens ?? 0,
        tokensOutput: usage?.completion_tokens ?? 0,
        modelUsed: model,
      };
    }
  }

  // All models exhausted
  console.warn("[linkedin-finder] all models exhausted, giving up");
  return { url: null, tokensInput: 0, tokensOutput: 0, modelUsed: null };
}
