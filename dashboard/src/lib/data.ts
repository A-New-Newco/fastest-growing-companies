"use client";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import {
  ALL_COUNTRIES_VALUE,
  DEFAULT_COUNTRY,
  normalizeCountryCode,
} from "@/lib/constants";
import type {
  Annotation,
  Company,
  FilterState,
  SectorStats,
  RegionStats,
  RuoloCategory,
  Confidenza,
} from "@/types";

// ── Type for the companies_full view row ──────────────────────────────────────
interface CompanyFullRow {
  id: string;
  rank: number;
  name: string;
  website: string | null;
  growth_rate: number | null;
  sector: string | null;
  region: string | null;
  appearances: number | null;
  financials: { revenue_start: number | null; revenue_end: number | null } | null;
  year: number;
  country: string | null;
  source_name: string | null;
  contact_id: string | null;
  cfo_nome: string | null;
  cfo_ruolo: string | null;
  cfo_ruolo_category: string | null;
  cfo_linkedin: string | null;
  confidenza: string | null;
  enrichment_source: string | null;
  contact_left: boolean | null;
  low_quality: boolean | null;
  annotation_note: string | null;
  data_origin: string | null;
}

const SECTOR_TRANSLATIONS: Record<string, string> = {
  "Abbigliamento e moda": "Apparel and Fashion",
  "Aerospaziale e difesa": "Aerospace and Defense",
  "Agricoltura, silvicoltura e pesca": "Agriculture, Forestry and Fishing",
  Arredamento: "Furniture",
  "Auto e servizi associati": "Automotive and Related Services",
  "Beni immobili": "Real Estate",
  "Cibo e bevande": "Food and Beverages",
  "Commercio all'ingrosso": "Wholesale Trade",
  "Consulenza manageriale": "Management Consulting",
  "Costruzione e ingegneria": "Construction and Engineering",
  "Energia e servizi pubblici": "Energy and Utilities",
  "Fintech, servizi finanziari e assicurazioni":
    "Fintech, Financial Services and Insurance",
  Formazione: "Education and Training",
  "IT e software": "IT and Software",
  "Logistica e trasporto": "Logistics and Transportation",
  "Macchinari e attrezzature": "Machinery and Equipment",
  "Media e telecomunicazioni": "Media and Telecommunications",
  "Ospitalità e viaggi": "Hospitality and Travel",
  "Prodotti chimici": "Chemical Products",
  "Prodotti farmaceutici, biotecnologie e scienze della vita":
    "Pharmaceuticals, Biotechnology and Life Sciences",
  "Produzione industriale": "Industrial Manufacturing",
  "Pubblicità e marketing": "Advertising and Marketing",
  "Servizi per l'impiego": "Employment Services",
  "Servizi professionali, scientifici e tecnici":
    "Professional, Scientific and Technical Services",
  "Servizi sanitari e sociali": "Health and Social Services",
  "Smaltimento rifiuti & riciclo": "Waste Management & Recycling",
  "Tempo libero e divertimento": "Leisure and Entertainment",
  "Vendita al dettaglio": "Retail",
};

const REGION_TRANSLATIONS: Record<string, string> = {
  Lombardia: "Lombardy",
  Piemonte: "Piedmont",
  Puglia: "Apulia",
  Sardegna: "Sardinia",
  Sicilia: "Sicily",
  Toscana: "Tuscany",
  "Trentino-Alto Adige": "Trentino-South Tyrol",
  "Valle d'Aosta": "Aosta Valley",
};

function translateSector(value: string | null): string {
  if (!value) return "";
  return SECTOR_TRANSLATIONS[value] ?? value;
}

function translateRegion(value: string | null): string {
  if (!value) return "";
  return REGION_TRANSLATIONS[value] ?? value;
}

function parseConfidenza(val: string | null): Confidenza {
  if (val === "high" || val === "medium" || val === "low") return val;
  return null;
}

function parseRuoloCategory(val: string | null): RuoloCategory {
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
  return valid.includes(val as RuoloCategory) ? (val as RuoloCategory) : "Not Found";
}

function mapRow(row: CompanyFullRow): Company {
  const ruoloCategory = parseRuoloCategory(row.cfo_ruolo_category);
  const confidenza = parseConfidenza(row.confidenza);
  const cfoFound = !!row.cfo_nome;
  const hasRealCfo =
    (ruoloCategory === "CFO / DAF" || ruoloCategory === "Finance Manager") &&
    (confidenza === "high" || confidenza === "medium");

  const annotation: Annotation | undefined =
    row.contact_left !== null || row.low_quality !== null || row.annotation_note
      ? {
          companyId: row.id,
          contactLeft: row.contact_left ?? false,
          lowQuality: row.low_quality ?? false,
          note: row.annotation_note ?? "",
        }
      : undefined;

  return {
    id: row.id,
    rank: row.rank,
    azienda: row.name,
    tassoCrescita: row.growth_rate ?? 0,
    ricavi2021: row.financials?.revenue_start ?? 0,
    ricavi2024: row.financials?.revenue_end ?? 0,
    settore: translateSector(row.sector),
    regione: translateRegion(row.region),
    presenze: row.appearances ?? 0,
    sitoWeb: row.website ?? "",
    country: normalizeCountryCode(row.country),
    sourceName: row.source_name,
    cfoNome: row.cfo_nome,
    cfoRuolo: row.cfo_ruolo,
    cfoRuoloCategory: ruoloCategory,
    cfoLinkedin: row.cfo_linkedin,
    confidenza,
    cfoFound,
    hasRealCfo,
    contactId: row.contact_id,
    dataOrigin: row.data_origin === "imported" ? "imported" : "curated",
    annotation,
  };
}

export async function loadCompanies(
  year = 2026,
  country: string = DEFAULT_COUNTRY
): Promise<Company[]> {
  const supabase = createClientSupabaseClient();

  // Query the unified view which includes both curated and imported companies.
  // Imported companies are team-scoped via RLS enforced in the view definition.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("all_companies")
    .select("*")
    .eq("year", year)
    .order("rank", { ascending: true, nullsFirst: false });

  if (country !== ALL_COUNTRIES_VALUE) {
    query = query.eq("country", normalizeCountryCode(country));
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to load companies: ${error.message}`);
  return (data as CompanyFullRow[]).map(mapRow);
}

export async function loadAvailableCountries(year = 2026): Promise<string[]> {
  const supabase = createClientSupabaseClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("all_companies")
    .select("country")
    .eq("year", year);

  if (error) throw new Error(`Failed to load countries: ${error.message}`);

  return [...new Set((data as Array<{ country: string | null }> ?? []).map((r) => normalizeCountryCode(r.country)))].sort();
}

// ── Annotation mutations ───────────────────────────────────────────────────────

export async function upsertAnnotation(
  companyId: string,
  annotation: Omit<Annotation, "companyId">
): Promise<void> {
  const res = await fetch("/api/annotations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: companyId,
      contact_left: annotation.contactLeft,
      low_quality: annotation.lowQuality,
      note: annotation.note,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Failed to save annotation");
  }
}

// ── Filtering ──────────────────────────────────────────────────────────────────
export function filterCompanies(
  companies: Company[],
  filters: FilterState
): Company[] {
  return companies.filter((c) => {
    if (
      filters.country !== ALL_COUNTRIES_VALUE &&
      c.country !== normalizeCountryCode(filters.country)
    ) {
      return false;
    }

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

    if (filters.hasRealCfoFilter === "has" && !c.hasRealCfo) return false;
    if (filters.hasRealCfoFilter === "no" && c.hasRealCfo) return false;

    if (filters.linkedinFilter === "has" && !c.cfoLinkedin) return false;
    if (filters.linkedinFilter === "no" && c.cfoLinkedin) return false;

    if (filters.hasContactFilter === "has" && !c.cfoNome) return false;
    if (filters.hasContactFilter === "no" && c.cfoNome) return false;

    if (filters.minRevenue > 0 && c.ricavi2024 < filters.minRevenue * 1_000)
      return false;
    if (filters.maxRevenue > 0 && c.ricavi2024 > filters.maxRevenue * 1_000)
      return false;

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
    .map(([settore, rates]) => ({
      settore,
      count: rates.length,
      avgGrowth: rates.reduce((a, b) => a + b, 0) / rates.length,
      medianRevenue2024: 0,
    }))
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
