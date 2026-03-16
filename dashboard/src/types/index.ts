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
  rank: number | null;
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
  cfoEmail: string | null;
  cfoTelefono: string | null;
  confidenza: Confidenza;
  cfoFound: boolean; // true if any contact found
  hasRealCfo: boolean; // true if CFO/DAF or Finance Manager + medium/high confidence
  contactId: string | null; // campaign contact id, non-null if added to a campaign
  dataOrigin: "curated" | "imported";
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
  sourceNames: string[]; // filter by import source name
  confidenza: Confidenza[];
  minGrowth: number;
  maxGrowth: number;
  cfoFoundOnly: boolean;
  linkedinFilter: CfoPresenceFilter;
  hasRealCfoFilter: CfoPresenceFilter;
  hasContactFilter: CfoPresenceFilter;
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
export type QuotaPolicy = "conservative" | "balanced" | "aggressive";
export type IntegrationMode = "dashboard" | "legacy";

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
  connectionNoteTemplate?: string | null;
  quotaPolicy?: QuotaPolicy;
  pauseReason?: string | null;
  integrationMode?: IntegrationMode;
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
  claimedBy?: string | null;
  claimExpiresAt?: string | null;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export type OutreachRunStatus = "running" | "paused" | "stopped" | "completed";

export interface OutreachRun {
  id: string;
  campaignId: string;
  teamId: string;
  startedBy: string;
  status: OutreachRunStatus;
  pauseReason: string | null;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
}

export interface OperatorProfile {
  userId: string;
  teamId: string;
  linkedinUrl: string;
  fullName: string;
  headline: string | null;
  confidence: number;
  source: string;
  htmlHash: string;
  verifiedAt: string;
}

export interface OutreachEvent {
  id: string;
  campaignId: string;
  campaignContactId: string;
  runId: string | null;
  actorUserId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ClaimLease {
  contactId: string;
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactRole: string | null;
  contactLinkedin: string | null;
  message: string;
  leaseExpiresAt: string;
  runId: string | null;
}

export type PluginFailureCode =
  | "captcha"
  | "checkpoint"
  | "rate_warning"
  | "ui_unknown"
  | "account_restricted"
  | "network_error"
  | "manual_abort";

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

// ── Import types ──────────────────────────────────────────────────────────────

export type ImportBatchStatus = "pending" | "mapping" | "importing" | "done" | "failed";
export type FieldMappingStatus = "pending_review" | "approved" | "rejected";

export interface ImportBatch {
  id: string;
  teamId: string;
  sourceName: string;
  countryCode: string;
  year: number;
  fileName: string;
  fileFormat: "json" | "jsonl" | "csv";
  totalRecords: number | null;
  importedCount: number;
  skippedCount: number;
  status: ImportBatchStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Single entry in the LLM-generated field mapping */
export interface FieldMappingEntry {
  /** Internal field name, 'extra_data.<key>', or null (skip) */
  target: string | null;
  /** Human-readable transform hint, e.g. "parse as integer", or null */
  transform: string | null;
  /** LLM confidence 0.0–1.0 */
  confidence: number;
}

export interface FieldMapping {
  id: string;
  batchId: string;
  teamId: string;
  /** Array of dot-notation field paths observed in the source file */
  sourceSchema: string[];
  /** Map: source_field_path → FieldMappingEntry */
  mapping: Record<string, FieldMappingEntry>;
  status: FieldMappingStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  llmModel: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportedCompany {
  id: string;
  teamId: string;
  batchId: string;
  sourceName: string;
  sourceKey: string;
  name: string;
  website: string | null;
  countryCode: string;
  region: string | null;
  city: string | null;
  sector: string | null;
  growthRate: number | null;
  revenueA: number | null;
  revenueB: number | null;
  year: number;
  nationalRank: number | null;
  foundationYear: number | null;
  description: string | null;
  employeesStart: number | null;
  employeesEnd: number | null;
  isListed: boolean | null;
  cfoNome: string | null;
  cfoRuolo: string | null;
  cfoLinkedin: string | null;
  cfoConfidenza: string | null;
  extraData: Record<string, unknown>;
  importedBy: string;
  importedAt: string;
  updatedAt: string;
}

/** Shape of a single field extracted from the uploaded file for LLM analysis */
export interface ParsedField {
  name: string;
  sampleValue: unknown;
  inferredType: "string" | "number" | "boolean" | "array" | "object" | "null";
}

/** Result of parsing the uploaded file (sample only) */
export interface ParseResult {
  format: "json" | "jsonl" | "csv";
  totalRows: number;
  fields: ParsedField[];
}

/** Raw LLM output from Groq for field mapping */
export interface FieldMappingResult {
  mappings: Array<{
    source_field: string;
    target_field: string | null;
    transform: string | null;
    confidence: number;
  }>;
  extra_fields: string[];
  source_name_suggestion: string;
  notes: string | null;
}

// ── Enrichment Session types ──────────────────────────────────────────────────

export type EnrichmentSessionStatus = "pending" | "running" | "paused" | "completed" | "failed";
export type EnrichmentCompanyStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type EnrichmentMode = "remote" | "local";

export interface EnrichmentModelConfig {
  enrichmentMode?: EnrichmentMode; // default "remote"
  models: string[];
  current_model_index: number;
  numWorkers?: number;
}

export interface EnrichmentSession {
  id: string;
  teamId: string;
  name: string;
  status: EnrichmentSessionStatus;
  modelConfig: EnrichmentModelConfig;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  totalCompanies: number;
  completedCount: number;
  foundCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeat: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSELogEntry {
  ts: string; // ISO timestamp
  event: "search" | "fetch" | "think" | "result";
  data: {
    text?: string;
    query?: string;
    url?: string;
  };
}

export interface EnrichmentSessionCompany {
  id: string;
  sessionId: string;
  companyId: string;
  companyOrigin: "curated" | "imported";
  companyName: string;
  companyWebsite: string | null;
  companyCountry: string | null;
  status: EnrichmentCompanyStatus;
  resultNome: string | null;
  resultRuolo: string | null;
  resultLinkedin: string | null;
  resultConfidenza: "high" | "medium" | "low" | null;
  logs: SSELogEntry[];
  tokensInput: number;
  tokensOutput: number;
  modelUsed: string | null;
  errorMessage: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnrichmentSessionInput {
  name: string;
  companies: Array<{
    companyId: string;
    companyOrigin: "curated" | "imported";
    companyName: string;
    companyWebsite: string | null;
    companyCountry: string | null;
  }>;
  modelConfig?: EnrichmentModelConfig;
}

// SSE event payloads (streamed from /api/enrichment-sessions/[id]/stream)
export interface SSESessionStart {
  sessionId: string;
  totalCompanies: number;
  resumedAt: number; // position index where we resumed from
}

export interface SSECompanyStart {
  companyRowId: string;
  position: number;
  companyName: string;
  model: string;
}

export interface SSELog {
  companyRowId: string;
  entry: SSELogEntry;
}

export interface SSECompanyDone {
  companyRowId: string;
  status: "done" | "failed";
  result?: {
    nome: string | null;
    ruolo: string | null;
    linkedin: string | null;
    confidenza: "high" | "medium" | "low" | null;
  };
  tokensInput: number;
  tokensOutput: number;
  modelUsed: string | null;
  errorMessage?: string;
}

export interface SSESessionProgress {
  completed: number;
  total: number;
  found: number;
  failed: number;
  tokensTotal: number;
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
