/**
 * CFO Finder Prompt Module
 *
 * Optimized prompt system for finding the CFO / head of finance at companies.
 * Supports multi-country/language via per-company user message injection.
 * Designed for Groq compound-beta (built-in web search) with text-only fallback.
 *
 * Total input tokens per call: ~280-320 (vs ~700 in original Python — ~60% reduction)
 */

// ── System prompt (universal, language-agnostic) ──────────────────────────────

export const CFO_FINDER_SYSTEM_PROMPT = `You are a research agent. Find the person responsible for finance at a company.

CONFIDENCE TIERS (use these exact labels):
HIGH: CFO, Chief Financial Officer, Finance Director, DAF, Direttore Finanziario, Finanzvorstand, Directeur Financier, Director Financiero, Financieel Directeur, CFO/Finance Director
MEDIUM: Financial Controller, Head of Finance, Finance Manager, VP Finance, Treasurer, Responsabile Finanziario, Kaufmännischer Leiter, Responsable Financier, Leiter Finanzen
LOW: CEO, Founder, Owner, Amministratore Delegato, Geschäftsführer, Directeur Général (only if no dedicated finance role exists)

SEARCH STEPS — run in order, stop early per EXIT RULES:
1. Web search: "<name>" CFO OR "Chief Financial Officer" OR "Finance Director" OR <local_finance_terms>
2. Web search: "<name>" CFO OR "Finance Director" linkedin
3. Fetch company website; try /team /about /management /leadership <local_slugs>
4. Web search: "<name>" site:linkedin.com/company
5. Web search: "<name>" CEO OR founder OR <local_leadership_terms>

EXIT RULES (follow strictly to minimize unnecessary searches):
- Size SMALL (<5M€): run steps 1+5 only; owner/CEO at LOW confidence is acceptable
- Size MID (5–20M€): run steps 1–3; stop at first MEDIUM or HIGH result
- Size LARGE (>20M€): run all 5 steps; prefer HIGH or MEDIUM
- Size UNKNOWN: treat as MID
- EARLY EXIT: if step 1 or 2 yields HIGH confidence AND a LinkedIn URL → stop immediately, return result
- MEDIUM found → run 1 more confirmatory search, then stop regardless
- Run at least 3 searches before concluding "not found" (except SMALL size)

IMPORTANT:
- Use the company name without legal suffixes (S.r.l., GmbH, Ltd., SAS, etc.) for searches
- Do NOT scrape LinkedIn profile pages directly; infer from search result snippets only
- Return a plausible person name: 2–5 words, letters/hyphens/apostrophes only

OUTPUT: End your response with this exact block (nothing after ##END##):
##JSON##
{"nome":"First Last","ruolo":"Exact title as found","linkedin_url":"https://...or null","confidenza":"high|medium|low"}
##END##
If not found: ##JSON##{"nome":null}##END##`;

// ── Local language terms by country ──────────────────────────────────────────

interface CountryTerms {
  finance: string[];     // finance role search terms
  leadership: string[];  // fallback leadership terms
  aboutSlugs: string[];  // website about/team page slugs
}

const COUNTRY_TERMS: Record<string, CountryTerms> = {
  IT: {
    finance: ['"direttore finanziario"', '"responsabile finanziario"', '"DAF"', '"responsabile amministrativo"', '"direttore amministrativo"'],
    leadership: ['"amministratore delegato"', '"amministratore unico"', '"presidente"'],
    aboutSlugs: ['/chi-siamo', '/la-societa', '/organigramma', '/il-team'],
  },
  DE: {
    finance: ['"Finanzvorstand"', '"Finanzleiter"', '"Kaufmännischer Leiter"', '"CFO"', '"Leiter Finanzen"'],
    leadership: ['"Geschäftsführer"', '"Vorstandsvorsitzender"', '"Inhaber"'],
    aboutSlugs: ['/uber-uns', '/team', '/management', '/unternehmen'],
  },
  FR: {
    finance: ['"Directeur Financier"', '"DAF"', '"Responsable Financier"', '"Directeur Administratif"'],
    leadership: ['"Directeur Général"', '"Président"', '"Fondateur"'],
    aboutSlugs: ['/equipe', '/a-propos', '/qui-sommes-nous', '/direction'],
  },
  ES: {
    finance: ['"Director Financiero"', '"CFO"', '"Director de Finanzas"', '"Responsable Financiero"'],
    leadership: ['"Director General"', '"Consejero Delegado"', '"Fundador"'],
    aboutSlugs: ['/equipo', '/sobre-nosotros', '/quienes-somos', '/direccion'],
  },
  NL: {
    finance: ['"Financieel Directeur"', '"CFO"', '"Financieel Manager"', '"Hoofd Financiën"'],
    leadership: ['"Directeur"', '"Algemeen Directeur"', '"Eigenaar"'],
    aboutSlugs: ['/over-ons', '/team', '/management', '/wie-zijn-wij'],
  },
  PL: {
    finance: ['"Dyrektor Finansowy"', '"CFO"', '"Kierownik Finansowy"'],
    leadership: ['"Prezes"', '"Dyrektor Generalny"', '"Założyciel"'],
    aboutSlugs: ['/o-nas', '/zespol', '/zarzad', '/kierownictwo'],
  },
  SE: {
    finance: ['"Ekonomichef"', '"CFO"', '"Finanschef"'],
    leadership: ['"VD"', '"Verkställande direktör"', '"Grundare"'],
    aboutSlugs: ['/om-oss', '/team', '/ledning', '/foretaget'],
  },
  CH: {
    finance: ['"CFO"', '"Finanzleiter"', '"Directeur Financier"', '"Responsabile Finanziario"'],
    leadership: ['"Geschäftsführer"', '"Directeur Général"', '"Fondateur"'],
    aboutSlugs: ['/uber-uns', '/a-propos', '/chi-siamo', '/team'],
  },
  BE: {
    finance: ['"Directeur Financier"', '"Financieel Directeur"', '"CFO"'],
    leadership: ['"Directeur Général"', '"Algemeen Directeur"', '"Fondateur"'],
    aboutSlugs: ['/a-propos', '/over-ons', '/equipe', '/team'],
  },
  GB: {
    finance: ['"Finance Director"', '"CFO"', '"Head of Finance"', '"VP Finance"'],
    leadership: ['"Managing Director"', '"Chief Executive"', '"Founder"'],
    aboutSlugs: ['/about', '/team', '/leadership', '/management'],
  },
};

type RevenueTier = "small" | "mid" | "large" | "unknown";

function getRevenueTier(revenueK: number | null | undefined): RevenueTier {
  if (revenueK == null) return "unknown";
  if (revenueK < 5_000) return "small";
  if (revenueK < 20_000) return "mid";
  return "large";
}

const TIER_HINTS: Record<RevenueTier, string> = {
  small: "SMALL (<5M€ revenue — owner/CEO likely handles finance; 1–2 searches max)",
  mid: "MID (5–20M€ revenue — may have a dedicated finance role)",
  large: "LARGE (>20M€ revenue — expect a dedicated CFO/Finance Director)",
  unknown: "UNKNOWN (treat as MID)",
};

// ── User message builder ──────────────────────────────────────────────────────

export interface EnrichmentUserMessageInput {
  /** Company name already cleaned of legal suffixes */
  companyName: string;
  website: string | null;
  /** ISO-3166 alpha-2 country code (e.g. "IT", "DE") */
  country: string;
  /** Latest revenue in thousands EUR; null if unknown */
  revenueK?: number | null;
}

export function buildEnrichmentUserMessage(input: EnrichmentUserMessageInput): string {
  const { companyName, website, country, revenueK } = input;
  const tier = getRevenueTier(revenueK);
  const terms = COUNTRY_TERMS[country.toUpperCase()] ?? null;

  const lines: string[] = [
    `Company: ${companyName}`,
    `Website: ${website ?? "N/A"}`,
    `Country: ${country.toUpperCase()}`,
    `Size: ${TIER_HINTS[tier]}`,
  ];

  if (terms) {
    lines.push(`Local finance search terms: ${terms.finance.join(", ")}`);
    lines.push(`Local leadership fallback terms: ${terms.leadership.join(", ")}`);
    lines.push(`Local about-page slugs: ${terms.aboutSlugs.join(" ")}`);
  }

  return lines.join("\n");
}

// ── Result extraction ─────────────────────────────────────────────────────────

export interface CfoResult {
  nome: string | null;
  ruolo?: string | null;
  linkedin_url?: string | null;
  confidenza?: "high" | "medium" | "low" | null;
}

/**
 * Extract and validate the CFO JSON block from the model's response text.
 *
 * Strategy:
 * 1. Primary: look for ##JSON## ... ##END## fence (most reliable)
 * 2. Fallback: last well-formed {...} object in the text
 * 3. Validate name: 2–5 words, letters/apostrophes/hyphens only, max 60 chars
 */
export function extractCfoResult(responseText: string): CfoResult {
  // 1. Fenced extraction
  const fenced = responseText.match(/##JSON##\s*(\{[\s\S]*?\})\s*##END##/);
  const raw = fenced
    ? fenced[1]
    : responseText.match(/\{[^{}]{10,400}\}/g)?.slice(-1)[0] ?? null;

  if (!raw) return { nome: null };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { nome: null };
  }

  const nome = typeof parsed.nome === "string" ? parsed.nome.trim() : null;
  if (!nome) return { nome: null };

  // Validate: 2–5 words, only letters (including accented) / apostrophe / hyphen, max 60 chars
  const words = nome.split(/\s+/);
  const validName =
    words.length >= 2 &&
    words.length <= 5 &&
    nome.length <= 60 &&
    // Allow ASCII + Latin-extended + common accented letters (covers IT/FR/DE/ES/PL/SE etc.)
    words.every((w) => /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F'\u2010-]+$/.test(w));

  if (!validName) return { nome: null };

  const confidenza = (["high", "medium", "low"] as const).find(
    (v) => v === parsed.confidenza
  ) ?? null;

  return {
    nome,
    ruolo: typeof parsed.ruolo === "string" ? parsed.ruolo.trim() || null : null,
    linkedin_url:
      typeof parsed.linkedin_url === "string" && parsed.linkedin_url.startsWith("http")
        ? parsed.linkedin_url
        : null,
    confidenza,
  };
}

// ── Legal suffix cleaner (ported from Python agent_enricher.py) ───────────────

const LEGAL_SUFFIX_RE =
  /\s+(?:S\.?r\.?l\.?s?\.?|S\.?p\.?A\.?|S\.?a\.?s\.?|S\.?n\.?c\.?|S\.?S\.?|GmbH|Ltd\.?|LLC|Inc\.?|Corp\.?|S\.?A\.?S\.?|SARL|SAS|BV|NV|AG|OHG|KG|AB|AS|ApS|Oy|Sp\.?\s?z\.?\s?o\.?\s?o\.?|s\.?r\.?o\.?)\.?\s*$/i;

export function cleanCompanyName(name: string): string {
  return name.replace(LEGAL_SUFFIX_RE, "").trim();
}
