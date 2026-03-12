const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "compound-beta-mini";

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

export async function findLinkedIn(
  companyName: string,
  contactName: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string | null> {
  const cleanCompanyName = stripLegalSuffix(companyName);
  const query = `${cleanCompanyName} ${contactName} site:linkedin.com`;

  const groqRes = await fetch(GROQ_API_URL, {
    method: "POST",
    signal,
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

  if (!groqRes.ok) return null;

  const groqJson = await groqRes.json();
  const rawText: string = groqJson.choices?.[0]?.message?.content ?? "";
  return extractLinkedInUrl(rawText);
}
