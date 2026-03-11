import type { RuoloCategory, Confidenza, CampaignStatus, ContactStatus } from "@/types";

// ── CFO Role Category metadata ─────────────────────────────────────────────────
export const ROLE_CATEGORY_META: Record<
  RuoloCategory,
  { label: string; color: string; description: string }
> = {
  "CFO / DAF": {
    label: "CFO / DAF",
    color: "#2563eb", // blue-600
    description: "Chief Financial Officer, Finance Director",
  },
  "Finance Manager": {
    label: "Finance Manager",
    color: "#0891b2", // cyan-600
    description: "Finance Manager, Controller, Accountant",
  },
  "CEO / AD": {
    label: "CEO / AD",
    color: "#7c3aed", // violet-600
    description: "Chief Executive Officer, Managing Director",
  },
  "Mixed Role": {
    label: "Mixed Role",
    color: "#9333ea", // purple-600
    description: "Combined C-suite titles (e.g. CEO & CFO)",
  },
  "Founder / Owner": {
    label: "Founder / Owner",
    color: "#ea580c", // orange-600
    description: "Founder, Owner, Proprietor",
  },
  Presidente: {
    label: "President",
    color: "#d97706", // amber-600
    description: "President, Chairman",
  },
  "General Manager": {
    label: "General Manager",
    color: "#059669", // emerald-600
    description: "General Manager, Managing Partner",
  },
  Amministratore: {
    label: "Administrator",
    color: "#64748b", // slate-500
    description: "Administrator, Sole Director",
  },
  Other: {
    label: "Other",
    color: "#94a3b8", // slate-400
    description: "Unclassified roles",
  },
  "Not Found": {
    label: "Not Found",
    color: "#e2e8f0", // slate-200
    description: "No contact identified",
  },
};

// ── Confidence badge colors ────────────────────────────────────────────────────
export const CONFIDENCE_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  high: { label: "High", color: "#166534", bg: "#dcfce7" },
  medium: { label: "Medium", color: "#92400e", bg: "#fef3c7" },
  low: { label: "Low", color: "#9a3412", bg: "#ffedd5" },
  "": { label: "—", color: "#475569", bg: "#f1f5f9" },
};

// ── Chart colors for sectors (30 sectors → grouped palette) ──────────────────
export const SECTOR_COLORS: Record<string, string> = {
  "IT and Software": "#2563eb",
  "Construction and Engineering": "#7c3aed",
  "Machinery and Equipment": "#0891b2",
  "Energy and Utilities": "#059669",
  "E-commerce": "#ea580c",
  "Professional, Scientific and Technical Services": "#d97706",
  "Advertising and Marketing": "#db2777",
  "Food and Beverages": "#65a30d",
  "Industrial Manufacturing": "#9333ea",
  "Management Consulting": "#0369a1",
  "Hospitality and Travel": "#b45309",
  "Logistics and Transportation": "#1d4ed8",
  "Health and Social Services": "#16a34a",
  "Wholesale Trade": "#7e22ce",
  "Waste Management & Recycling": "#15803d",
  "Fintech, Financial Services and Insurance": "#1e40af",
  "MICE (Meetings, Incentives, Conferences, Exhibitions)": "#9f1239",
  "Apparel and Fashion": "#ec4899",
  "Education and Training": "#f59e0b",
  "Pharmaceuticals, Biotechnology and Life Sciences": "#10b981",
  "Media and Telecommunications": "#6366f1",
  "Employment Services": "#78716c",
  "Leisure and Entertainment": "#f97316",
  "Retail": "#ef4444",
  "Real Estate": "#8b5cf6",
  "Environmental Services": "#22c55e",
  "Security and Investigations": "#64748b",
  Sport: "#06b6d4",
  Automotive: "#84cc16",
  "Aerospace and Defense": "#4f46e5",
  "Agriculture, Forestry and Fishing": "#65a30d",
  Furniture: "#f97316",
  "Chemical Products": "#06b6d4",
  Other: "#a8a29e",
};

// Default color for unknown sectors
export const DEFAULT_SECTOR_COLOR = "#94a3b8";

// ── Country metadata ──────────────────────────────────────────────────────────
export const DEFAULT_COUNTRY = "IT";
export const ALL_COUNTRIES_VALUE = "all";

const COUNTRY_LABELS: Record<string, string> = {
  IT: "Italy",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  PT: "Portugal",
  UK: "United Kingdom",
  GB: "United Kingdom",
  US: "United States",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
};

export function normalizeCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_COUNTRY;
}

export function getCountryLabel(code: string): string {
  if (code === ALL_COUNTRIES_VALUE) return "All countries";
  const normalized = normalizeCountryCode(code);
  return COUNTRY_LABELS[normalized] ?? normalized;
}

// ── Filter defaults ────────────────────────────────────────────────────────────
export const DEFAULT_FILTER_STATE = {
  country: DEFAULT_COUNTRY,
  search: "",
  settori: [] as string[],
  regioni: [] as string[],
  confidenza: [] as Confidenza[],
  minGrowth: 0,
  maxGrowth: 600,
  cfoFoundOnly: false,
  linkedinFilter: "all" as const,
  hasRealCfoFilter: "all" as const,
  minRevenue: 0,
  maxRevenue: 0,
};

// ── Categories considered "real CFO" for HAS_REAL_CFO logic ──────────────────
export const REAL_CFO_CATEGORIES: RuoloCategory[] = ["CFO / DAF", "Finance Manager"];
export const REAL_CFO_CONFIDENCES: Confidenza[] = ["high", "medium"];

// ── Campaign status metadata ───────────────────────────────────────────────────
export const CAMPAIGN_STATUS_META: Record<
  CampaignStatus,
  { label: string; color: string; bg: string }
> = {
  draft:     { label: "Draft",     color: "#475569", bg: "#f1f5f9" },
  active:    { label: "Active",    color: "#166534", bg: "#dcfce7" },
  paused:    { label: "Paused",    color: "#92400e", bg: "#fef3c7" },
  completed: { label: "Completed", color: "#3730a3", bg: "#e0e7ff" },
  archived:  { label: "Archived",  color: "#64748b", bg: "#f8fafc" },
};

// ── Contact status metadata ────────────────────────────────────────────────────
export const CONTACT_STATUS_META: Record<
  ContactStatus,
  { label: string; color: string; bg: string }
> = {
  pending:           { label: "Pending",           color: "#475569", bg: "#f1f5f9" },
  contacted:         { label: "Contacted",          color: "#1d4ed8", bg: "#dbeafe" },
  replied:           { label: "Replied",            color: "#92400e", bg: "#fef3c7" },
  meeting_scheduled: { label: "Meeting Scheduled",  color: "#6d28d9", bg: "#ede9fe" },
  converted:         { label: "Converted",          color: "#166534", bg: "#dcfce7" },
  not_interested:    { label: "Not Interested",     color: "#991b1b", bg: "#fee2e2" },
  no_reply:          { label: "No Reply",           color: "#334155", bg: "#e2e8f0" },
};
