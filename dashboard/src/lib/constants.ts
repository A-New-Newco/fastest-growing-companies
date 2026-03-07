import type { RuoloCategory, Confidenza } from "@/types";

// ── CFO Role Category metadata ─────────────────────────────────────────────────
export const ROLE_CATEGORY_META: Record<
  RuoloCategory,
  { label: string; color: string; description: string }
> = {
  "CFO / DAF": {
    label: "CFO / DAF",
    color: "#2563eb", // blue-600
    description: "Chief Financial Officer, Direttore Finanziario",
  },
  "Finance Manager": {
    label: "Finance Manager",
    color: "#0891b2", // cyan-600
    description: "Responsabile Amministrativo, Controller, Accountant",
  },
  "CEO / AD": {
    label: "CEO / AD",
    color: "#7c3aed", // violet-600
    description: "CEO, Amministratore Delegato, Managing Director",
  },
  "Mixed Role": {
    label: "Mixed Role",
    color: "#9333ea", // purple-600
    description: "Combined C-suite titles (e.g. CEO & CFO)",
  },
  "Founder / Owner": {
    label: "Founder / Owner",
    color: "#ea580c", // orange-600
    description: "Founder, Fondatore, Titolare, Owner",
  },
  Presidente: {
    label: "Presidente",
    color: "#d97706", // amber-600
    description: "Presidente, President, Chairman",
  },
  "General Manager": {
    label: "General Manager",
    color: "#059669", // emerald-600
    description: "Direttore Generale, Managing Partner",
  },
  Amministratore: {
    label: "Amministratore",
    color: "#64748b", // slate-500
    description: "Amministratore Unico, Amministratore",
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
  "IT e software": "#2563eb",
  "Costruzione e ingegneria": "#7c3aed",
  "Macchinari e attrezzature": "#0891b2",
  "Energia e servizi pubblici": "#059669",
  "E-commerce": "#ea580c",
  "Servizi professionali, scientifici e tecnici": "#d97706",
  "Pubblicità e marketing": "#db2777",
  "Cibo e bevande": "#65a30d",
  "Produzione industriale": "#9333ea",
  "Consulenza manageriale": "#0369a1",
  "Ospitalità e viaggi": "#b45309",
  "Logistica e trasporto": "#1d4ed8",
  "Servizi sanitari": "#16a34a",
  "Commercio all'ingrosso": "#7e22ce",
  "Smaltimento rifiuti & riciclo": "#15803d",
  "Fintech, servizi finanziari e assicurazioni": "#1e40af",
  "MICE (Meetings, Incentives, Conferences, Exhibitions)": "#9f1239",
  "Abbigliamento e moda": "#ec4899",
  Formazione: "#f59e0b",
  "Prodotti farmaceutici, biotecnologie e scienze della vita": "#10b981",
  "Media e telecomunicazioni": "#6366f1",
  "Servizi per l'impiego": "#78716c",
  "Tempo libero e divertimento": "#f97316",
  "Vendita al dettaglio": "#ef4444",
  Immobiliare: "#8b5cf6",
  "Servizi ambientali": "#22c55e",
  "Sicurezza e investigazione": "#64748b",
  Sport: "#06b6d4",
  Automotive: "#84cc16",
  Altro: "#a8a29e",
};

// Default color for unknown sectors
export const DEFAULT_SECTOR_COLOR = "#94a3b8";

// ── Filter defaults ────────────────────────────────────────────────────────────
export const DEFAULT_FILTER_STATE = {
  search: "",
  settori: [] as string[],
  regioni: [] as string[],
  confidenza: [] as Confidenza[],
  minGrowth: 0,
  maxGrowth: 600,
  cfoFoundOnly: false,
};

// ── Categories considered "real CFO" for HAS_REAL_CFO logic ──────────────────
export const REAL_CFO_CATEGORIES: RuoloCategory[] = ["CFO / DAF", "Finance Manager"];
export const REAL_CFO_CONFIDENCES: Confidenza[] = ["high", "medium"];
