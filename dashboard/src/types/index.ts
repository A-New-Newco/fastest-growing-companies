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

export interface Annotation {
  companyId: string; // Supabase UUID
  contactLeft: boolean;
  lowQuality: boolean;
  note: string;
}

export interface Company {
  id: string; // Supabase UUID
  rank: number;
  azienda: string;
  tassoCrescita: number; // CAGR percentage (e.g. 503.37)
  ricavi2021: number; // thousands EUR
  ricavi2024: number; // thousands EUR
  settore: string;
  regione: string;
  presenze: number; // 0–7 (times appeared in ranking)
  sitoWeb: string;
  country: string; // ISO-3166 alpha-2 (e.g. IT, DE)
  sourceName: string | null;
  cfoNome: string | null;
  cfoRuolo: string | null; // original raw value
  cfoRuoloCategory: RuoloCategory;
  cfoLinkedin: string | null;
  confidenza: Confidenza;
  cfoFound: boolean; // true if any contact found
  hasRealCfo: boolean; // true if CFO/DAF or Finance Manager + medium/high confidence
  annotation?: Annotation;
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
  country: string; // ISO-3166 alpha-2 or "all"
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

// ── Campaign types ─────────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";

export type ContactStatus =
  | "pending"
  | "contacted"
  | "replied"
  | "meeting_scheduled"
  | "converted"
  | "not_interested"
  | "no_reply";

export interface Campaign {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Computed stats (aggregated by API)
  totalContacts?: number;
  contactedCount?: number;
  repliedCount?: number;
  convertedCount?: number;
}

export interface CampaignContact {
  id: string;
  campaignId: string;
  companyId: string;
  // Company snapshot (joined)
  companyName?: string;
  companySector?: string;
  companyRegion?: string;
  companyLinkedin?: string;
  // Contact info (pre-filled from CFO data, editable)
  contactName: string | null;
  contactRole: string | null;
  contactLinkedin: string | null;
  status: ContactStatus;
  notes: string | null;
  contactedAt: string | null;
  repliedAt: string | null;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string;
}

export interface AddContactsToCampaignInput {
  companies: Array<{
    companyId: string;
    contactName: string | null;
    contactRole: string | null;
    contactLinkedin: string | null;
  }>;
}

export interface UpdateContactInput {
  status?: ContactStatus;
  notes?: string;
  contactName?: string;
  contactRole?: string;
  contactLinkedin?: string;
}

// ── Auth / Team types ─────────────────────────────────────────────────────────

export type MembershipRole = "admin" | "member";
export type RequestStatus = "pending" | "approved" | "rejected";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface TeamMembership {
  id: string;
  team_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface JoinRequest {
  id: string;
  team_id: string;
  user_id: string;
  status: RequestStatus;
  message: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
