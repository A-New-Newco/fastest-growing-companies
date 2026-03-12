import type { ParseResult, FieldMappingResult } from "@/types";

export const GROQ_MODEL = "llama-3.3-70b-versatile";
export const PROMPT_VERSION = "v1";

const SYSTEM_PROMPT = `You are a data field mapping assistant. Your task is to map fields from an external data source to an internal company data model.

INTERNAL DATA MODEL (map TO these fields — use exact field names):
{
  "name": "string — company name (required)",
  "website": "string | null — company website URL",
  "growth_rate": "number | null — CAGR percentage points, e.g. 4.26 means 4.26% (NOT 0.0426)",
  "sector": "string | null — industry sector or category",
  "region": "string | null — geographic region within the country",
  "city": "string | null — city where the company is headquartered",
  "national_rank": "number | null — company rank in the national list",
  "source_key": "string — unique identifier from the source (ID, key, etc.)",
  "revenue_a": "number | null — revenue in thousands EUR at start of measurement period",
  "revenue_b": "number | null — revenue in thousands EUR at end of measurement period",
  "year": "number — ranking publication year, e.g. 2026",
  "description": "string | null — short company description or bio",
  "foundation_year": "number | null — year the company was founded",
  "employees_start": "number | null — employee count at start of measurement period",
  "employees_end": "number | null — employee count at end of measurement period",
  "is_listed": "boolean | null — whether the company is publicly traded on a stock exchange"
}

SPECIAL TARGET "extra_data":
Fields that don't fit the model above but are worth keeping should be mapped to "extra_data.<key>" where <key> is a descriptive name. Example: "extra_data.street_address", "extra_data.toplist_labels".

RULES:
1. Return ONLY valid JSON, no prose, no markdown code fences, no explanation outside the JSON.
2. Every source field must appear either in "mappings" (with a target) or implicitly via extra_fields guidance.
3. "target_field" must be one of the exact field names listed above, "extra_data.<key>", or null to skip entirely.
4. "transform" is an optional human-readable hint for data coercion needed (e.g., "parse as integer", "extract year from ISO date string", "divide by 100"). Set to null if the value can be used as-is.
5. "confidence" is a float 0.0–1.0 reflecting mapping certainty.
6. Fields that are internal metadata (system IDs, source page URLs, raw score arrays) with no equivalent in the model go to extra_data unless clearly useless (internal DB IDs, nested score objects) — skip those with target_field: null.
7. If the same target field is the best match for multiple source fields, map all of them but lower confidence on the secondary matches and add a note.
8. The "source_name_suggestion" should be a lowercase slug identifying this dataset, e.g. "wachstumschampions_2026", "fast50_fr_2025".
9. For target field "growth_rate": if source values are already percentages (field names like pct/percent/%), keep as-is (transform: null). Use "divide by 100" only when source is clearly in basis points or another 0-100x scaled unit.`;

export function buildUserMessage(parseResult: ParseResult, fileName: string): string {
  const lines: string[] = [
    `SOURCE FILE: ${fileName}`,
    `FORMAT: ${parseResult.format.toUpperCase()}`,
    `ESTIMATED TOTAL RECORDS: ${parseResult.totalRows}`,
    "",
    "FIELDS WITH SAMPLE VALUES (dot-notation paths, complete values from first available record):",
  ];

  for (const field of parseResult.fields) {
    const valueStr = JSON.stringify(field.sampleValue);
    lines.push(`- "${field.name}": ${valueStr}  [type: ${field.inferredType}]`);
  }

  lines.push(
    "",
    "Map these source fields to the internal data model. Return JSON matching this schema exactly:",
    JSON.stringify(
      {
        mappings: [
          {
            source_field: "<exact dot-notation field name from above>",
            target_field: "<internal field name, extra_data.<key>, or null>",
            transform: "<description of needed transform or null>",
            confidence: "<0.0–1.0>",
          },
        ],
        source_name_suggestion: "<lowercase slug identifying this dataset>",
        notes: "<optional brief note about ambiguous mappings or null>",
      },
      null,
      2
    )
  );

  return lines.join("\n");
}

export async function callGroqMapper(
  parseResult: ParseResult,
  fileName: string,
  apiKey: string
): Promise<FieldMappingResult> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(parseResult, fileName) },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq API error ${response.status}: ${body}`);
  }

  const json = await response.json();
  const content: string = json.choices?.[0]?.message?.content ?? "{}";

  let parsed: FieldMappingResult;
  try {
    parsed = JSON.parse(content) as FieldMappingResult;
  } catch {
    throw new Error("Groq returned invalid JSON");
  }

  // Normalise: ensure required fields exist
  if (!Array.isArray(parsed.mappings)) parsed.mappings = [];
  if (!Array.isArray(parsed.extra_fields)) parsed.extra_fields = [];
  if (typeof parsed.source_name_suggestion !== "string") parsed.source_name_suggestion = "";

  return parsed;
}

/**
 * Apply a transform hint to a raw value.
 * Uses keyword matching — no eval.
 */
export function applyTransformHint(value: unknown, hint: string | null): unknown {
  if (!hint) return value;
  const h = hint.toLowerCase();

  if (h.includes("parse as integer") || h.includes("parse integer")) {
    return parseInt(String(value), 10);
  }
  if (h.includes("parse as float") || h.includes("parse float")) {
    return parseFloat(String(value));
  }
  if (h.includes("divide by 100")) {
    return typeof value === "number" ? value / 100 : parseFloat(String(value)) / 100;
  }
  if (h.includes("multiply by 100")) {
    return typeof value === "number" ? value * 100 : parseFloat(String(value)) * 100;
  }
  if (h.includes("extract year")) {
    const d = new Date(String(value));
    return isNaN(d.getFullYear()) ? value : d.getFullYear();
  }
  if (h.includes("lowercase")) {
    return String(value).toLowerCase();
  }
  if (h.includes("uppercase")) {
    return String(value).toUpperCase();
  }

  return value;
}

function shouldSkipTransformForGrowthRate(
  sourceField: string,
  target: string,
  transform: string | null
): boolean {
  if (target !== "growth_rate" || !transform) return false;
  const hint = transform.toLowerCase();
  if (!hint.includes("divide by 100")) return false;

  // If the source field explicitly denotes percentage values, keep them as-is.
  const source = sourceField.toLowerCase();
  return source.includes("pct") || source.includes("percent") || source.includes("%");
}

/** Known internal column names (everything except extra_data) */
const KNOWN_COLUMNS = new Set([
  "name", "website", "growth_rate", "sector", "region", "city",
  "national_rank", "source_key", "revenue_a", "revenue_b", "year",
  "description", "foundation_year", "employees_start", "employees_end", "is_listed",
]);

/**
 * Apply the confirmed field mapping to a single flat record,
 * returning a row ready for upsert into imported_companies.
 */
export function applyMapping(
  flatRecord: Record<string, unknown>,
  mapping: Record<string, { target: string | null; transform: string | null }>,
  defaults: {
    teamId: string;
    batchId: string;
    sourceName: string;
    countryCode: string;
    year: number;
    importedBy: string;
  }
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    team_id: defaults.teamId,
    batch_id: defaults.batchId,
    source_name: defaults.sourceName,
    country_code: defaults.countryCode,
    year: defaults.year,
    imported_by: defaults.importedBy,
    extra_data: {} as Record<string, unknown>,
    raw_data: flatRecord,
  };

  for (const [sourceField, entry] of Object.entries(mapping)) {
    const { target, transform } = entry;
    if (!target) continue; // skip

    const effectiveTransform = shouldSkipTransformForGrowthRate(sourceField, target, transform)
      ? null
      : transform;
    const value = applyTransformHint(flatRecord[sourceField], effectiveTransform);

    if (target.startsWith("extra_data.")) {
      const key = target.slice("extra_data.".length);
      (result.extra_data as Record<string, unknown>)[key] = value;
    } else if (KNOWN_COLUMNS.has(target)) {
      // First mapping wins on duplicate targets
      if (result[target] === undefined) {
        result[target] = value;
      }
    }
  }

  // Fallback for source_key: try common ID field names
  if (!result.source_key) {
    result.source_key =
      flatRecord["company_key"] ??
      flatRecord["id"] ??
      flatRecord["company_id"] ??
      result["name"] ??
      String(Math.random());
  }

  // Ensure name is present
  if (!result.name) result.name = String(result.source_key ?? "Unknown");

  return result;
}
