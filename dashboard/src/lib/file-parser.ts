import Papa from "papaparse";
import type { ParseResult, ParsedField } from "@/types";

const MAX_SAMPLE_ROWS = 2;
const MAX_FIELDS = 60;
const MAX_FLATTEN_DEPTH = 4;

/** Infer a simple type label from a value */
function inferType(value: unknown): ParsedField["inferredType"] {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "string";
}

/** Flatten a nested object to dot-notation keys, depth-limited */
function flattenRecord(
  obj: Record<string, unknown>,
  prefix = "",
  depth = 0
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (
      depth < MAX_FLATTEN_DEPTH &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const nested = flattenRecord(
        value as Record<string, unknown>,
        fullKey,
        depth + 1
      );
      Object.assign(result, nested);
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Parse a file's text content and extract sample rows + field metadata.
 * Only reads the first MAX_SAMPLE_ROWS records for efficiency.
 */
export function parseFileSample(
  text: string,
  format: "json" | "jsonl" | "csv"
): ParseResult {
  const rawRecords = extractRawRecords(text, format);
  const sampleRecords = rawRecords.slice(0, MAX_SAMPLE_ROWS);

  // Flatten each sample record
  const flatSamples = sampleRecords.map((r) =>
    typeof r === "object" && r !== null && !Array.isArray(r)
      ? flattenRecord(r as Record<string, unknown>)
      : {}
  );

  // Union of all field names across sample records
  const fieldMap = new Map<string, unknown>();
  for (const flat of flatSamples) {
    for (const [k, v] of Object.entries(flat)) {
      if (!fieldMap.has(k)) fieldMap.set(k, v);
    }
  }

  // Cap at MAX_FIELDS
  const fields: ParsedField[] = Array.from(fieldMap.entries())
    .slice(0, MAX_FIELDS)
    .map(([name, sampleValue]) => ({
      name,
      sampleValue,
      inferredType: inferType(sampleValue),
    }));

  return {
    format,
    totalRows: rawRecords.length,
    fields,
  };
}

/**
 * Parse ALL records from a file for the import step.
 * Returns flattened records ready for mapping application.
 */
export function parseAllRecords(
  text: string,
  format: "json" | "jsonl" | "csv"
): Array<Record<string, unknown>> {
  const rawRecords = extractRawRecords(text, format);
  return rawRecords
    .filter((r) => r !== null && typeof r === "object" && !Array.isArray(r))
    .map((r) => flattenRecord(r as Record<string, unknown>));
}

/** Detect file format from filename extension */
export function detectFormat(fileName: string): "json" | "jsonl" | "csv" | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "json") return "json";
  if (ext === "jsonl") return "jsonl";
  if (ext === "csv") return "csv";
  return null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function extractRawRecords(text: string, format: "json" | "jsonl" | "csv"): unknown[] {
  if (format === "jsonl") return parseJsonl(text);
  if (format === "csv") return parseCsv(text);
  return parseJson(text);
}

function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r !== null);
}

function parseJson(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) return parsed;

  if (parsed !== null && typeof parsed === "object") {
    // Check for common wrapper shapes: { data: [...] }, { items: [...] }, { results: [...] }
    for (const key of ["data", "items", "results", "companies", "records"]) {
      const val = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val;
    }
    // Map of objects (e.g. { id1: {...}, id2: {...} })
    const values = Object.values(parsed as Record<string, unknown>);
    if (values.length > 0 && typeof values[0] === "object") return values;
    // Single object → wrap as array of 1
    return [parsed];
  }

  return [];
}

function parseCsv(text: string): unknown[] {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  return result.data as unknown[];
}
