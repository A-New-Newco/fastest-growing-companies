"use client";

import Papa from "papaparse";
import type {
  Company,
  FilterState,
  SectorStats,
  RegionStats,
  RuoloCategory,
  Confidenza,
} from "@/types";

// ── Singleton cache ────────────────────────────────────────────────────────────
let _companies: Company[] | null = null;

function parseBoolean(val: string): boolean {
  return val?.toLowerCase() === "true";
}

function parseNumber(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function parseConfidenza(val: string): Confidenza {
  if (val === "high" || val === "medium" || val === "low") return val;
  return null;
}

function parseRuoloCategory(val: string): RuoloCategory {
  const valid: RuoloCategory[] = [
    "CFO / DAF",
    "CEO / AD",
    "Finance Manager",
    "Founder / Owner",
    "Presidente",
    "General Manager",
    "Mixed Role",
    "Amministratore",
    "Other",
    "Not Found",
  ];
  return valid.includes(val as RuoloCategory)
    ? (val as RuoloCategory)
    : "Not Found";
}

function mapRow(raw: Record<string, string>): Company {
  return {
    rank: parseNumber(raw["RANK"]),
    azienda: raw["AZIENDA"] ?? "",
    tassoCrescita: parseNumber(raw["TASSO DI CRESCITA"]),
    ricavi2021: parseNumber(raw["RICAVI 2021"]),
    ricavi2024: parseNumber(raw["RICAVI 2024"]),
    settore: raw["SETTORE"] ?? "",
    regione: raw["REGIONE"] ?? "",
    presenze: parseNumber(raw["PRESENZE"]),
    sitoWeb: raw["SITO WEB"] ?? "",
    cfoNome: raw["CFO_NOME"] || null,
    cfoRuolo: raw["CFO_RUOLO"] || null,
    cfoRuoloCategory: parseRuoloCategory(raw["CFO_RUOLO_CATEGORY"]),
    cfoLinkedin: raw["CFO_LINKEDIN"] || null,
    confidenza: parseConfidenza(raw["CONFIDENZA"]),
    cfoFound: parseBoolean(raw["CFO_FOUND"]),
    hasRealCfo: parseBoolean(raw["HAS_REAL_CFO"]),
  };
}

export async function loadCompanies(): Promise<Company[]> {
  if (_companies) return _companies;

  const res = await fetch("/data/2026_cleaned.csv");
  const text = await res.text();

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  _companies = result.data.map(mapRow);
  return _companies;
}

// ── Filtering ──────────────────────────────────────────────────────────────────
export function filterCompanies(
  companies: Company[],
  filters: FilterState
): Company[] {
  return companies.filter((c) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (
        !c.azienda.toLowerCase().includes(q) &&
        !(c.cfoNome?.toLowerCase().includes(q) ?? false)
      )
        return false;
    }

    if (filters.settori.length > 0 && !filters.settori.includes(c.settore))
      return false;

    if (filters.regioni.length > 0 && !filters.regioni.includes(c.regione))
      return false;

    if (filters.confidenza.length > 0) {
      if (!filters.confidenza.includes(c.confidenza)) return false;
    }

    if (c.tassoCrescita < filters.minGrowth || c.tassoCrescita > filters.maxGrowth)
      return false;

    if (filters.cfoFoundOnly && !c.cfoFound) return false;

    return true;
  });
}

// ── Aggregations ───────────────────────────────────────────────────────────────
export function computeSectorStats(companies: Company[]): SectorStats[] {
  const map = new Map<string, number[]>();

  for (const c of companies) {
    if (!map.has(c.settore)) map.set(c.settore, []);
    map.get(c.settore)!.push(c.tassoCrescita);
  }

  return Array.from(map.entries())
    .map(([settore, rates]) => {
      const sorted = [...rates].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianRevenue2024 = 0; // computed separately if needed
      return {
        settore,
        count: rates.length,
        avgGrowth: rates.reduce((a, b) => a + b, 0) / rates.length,
        medianRevenue2024,
      };
    })
    .sort((a, b) => b.avgGrowth - a.avgGrowth);
}

export function computeRegionStats(companies: Company[]): RegionStats[] {
  const map = new Map<string, number[]>();

  for (const c of companies) {
    if (!map.has(c.regione)) map.set(c.regione, []);
    map.get(c.regione)!.push(c.tassoCrescita);
  }

  return Array.from(map.entries())
    .map(([regione, rates]) => ({
      regione,
      count: rates.length,
      avgGrowth: rates.reduce((a, b) => a + b, 0) / rates.length,
    }))
    .sort((a, b) => b.count - a.count);
}

export function computeRoleCategoryStats(
  companies: Company[]
): { category: RuoloCategory; count: number }[] {
  const map = new Map<RuoloCategory, number>();
  for (const c of companies) {
    map.set(c.cfoRuoloCategory, (map.get(c.cfoRuoloCategory) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeConfidenceStats(
  companies: Company[]
): { confidenza: string; count: number }[] {
  const map: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
    "Not Found": 0,
  };
  for (const c of companies) {
    if (c.confidenza) map[c.confidenza] = (map[c.confidenza] ?? 0) + 1;
    else map["Not Found"]++;
  }
  return Object.entries(map).map(([confidenza, count]) => ({
    confidenza,
    count,
  }));
}

export function getUniqueSettori(companies: Company[]): string[] {
  return [...new Set(companies.map((c) => c.settore))].sort();
}

export function getUniqueRegioni(companies: Company[]): string[] {
  return [...new Set(companies.map((c) => c.regione))].sort();
}

export function formatRevenue(thousands: number): string {
  if (thousands >= 1_000_000) return `€${(thousands / 1_000_000).toFixed(1)}B`;
  if (thousands >= 1_000) return `€${(thousands / 1_000).toFixed(1)}M`;
  return `€${thousands.toFixed(0)}K`;
}

export function formatGrowth(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
