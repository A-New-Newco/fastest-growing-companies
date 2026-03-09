export type Confidenza = "high" | "medium" | "low" | null;

export type RuoloCategory =
  | "CFO / DAF"
  | "CEO / AD"
  | "Finance Manager"
  | "Founder / Owner"
  | "Presidente"
  | "General Manager"
  | "Mixed Role"
  | "Amministratore"
  | "Other"
  | "Not Found";

export interface Company {
  rank: number;
  azienda: string;
  tassoCrescita: number; // CAGR percentage (e.g. 503.37)
  ricavi2021: number; // thousands EUR
  ricavi2024: number; // thousands EUR
  settore: string;
  regione: string;
  presenze: number; // 0–7 (times appeared in ranking)
  sitoWeb: string;
  cfoNome: string | null;
  cfoRuolo: string | null; // original raw value
  cfoRuoloCategory: RuoloCategory;
  cfoLinkedin: string | null;
  confidenza: Confidenza;
  cfoFound: boolean; // true if any contact found
  hasRealCfo: boolean; // true if CFO/DAF or Finance Manager + medium/high confidence
}

export interface SectorStats {
  settore: string;
  count: number;
  avgGrowth: number;
  medianRevenue2024: number;
}

export interface RegionStats {
  regione: string;
  count: number;
  avgGrowth: number;
}

export interface FilterState {
  search: string;
  settori: string[];
  regioni: string[];
  confidenza: Confidenza[];
  minGrowth: number;
  maxGrowth: number;
  cfoFoundOnly: boolean;
  linkedinFilter: CfoPresenceFilter;
  hasRealCfoFilter: CfoPresenceFilter;
  minRevenue: number; // €M (0 = no filter)
  maxRevenue: number; // €M (0 = no filter)
}

export type SortField =
  | "rank"
  | "tassoCrescita"
  | "ricavi2024"
  | "azienda"
  | "settore"
  | "regione";
export type SortDir = "asc" | "desc";

export type CfoPresenceFilter = "all" | "has" | "no";

export interface ChartFilterState {
  settori: string[];
  regioni: string[];
  cfoPresence: CfoPresenceFilter;
  growthRange: [number, number];
}
