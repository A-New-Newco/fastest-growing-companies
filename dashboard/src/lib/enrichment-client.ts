// Types and SSE client for the CFO Enricher monitoring server.

export interface Dataset {
  id: string;
  label: string;
  input_path: string;
  output_dir: string;
  country_code: string;
  year: number;
}

export interface EnrichmentStatus {
  status: "idle" | "running" | "completed" | "error";
  input_path: string;
  output_dir: string;
  dataset_id: string;
  country_code: string;
  year: number;
  total: number;
  completed: number;
  found: number;
  not_found: number;
  rate_limits: number;
  total_cost_usd: number;
  elapsed_s: number;
  error_message: string | null;
}

export interface CompanyResult {
  rank: number;
  azienda: string;
  website: string | null;
  country: string;
  cfo_nome: string | null;
  cfo_ruolo: string | null;
  cfo_linkedin: string | null;
  cfo_email: string | null;
  cfo_telefono: string | null;
  confidenza: "high" | "medium" | "low" | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_calls: number;
  elapsed_s: number;
  had_rate_limit: boolean;
  is_reprocess?: boolean;
}

export interface ProgressEvent {
  completed: number;
  total: number;
  found: number;
  not_found: number;
  rate_limits: number;
  total_cost_usd: number;
  elapsed_s: number;
}

export interface DoneEvent {
  cancelled?: boolean;
  total?: number;
  found?: number;
  pct?: number;
  total_cost_usd?: number;
  elapsed_s?: number;
  rate_limits?: number;
}

export interface StartRequest {
  dataset_id?: string;
  input_path?: string;
  output_dir?: string;
  max_concurrency: number;
  reset: boolean;
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

// REST calls go through Next.js proxy (avoids CORS on server-side)
const API_BASE = "/api/enrichment";

// SSE connects directly to the monitor server — Next.js dev proxy buffers
// SSE frames which breaks live streaming. Direct connection has no such issue.
const SSE_DIRECT = "http://localhost:8765";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function fetchDatasets(): Promise<Dataset[]> {
  const res = await fetch(`${API_BASE}/datasets`);
  if (!res.ok) throw new Error(`Failed to fetch datasets: ${res.status}`);
  return res.json();
}

export async function fetchStatus(): Promise<EnrichmentStatus> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json();
}

export async function fetchResults(): Promise<CompanyResult[]> {
  const res = await fetch(`${API_BASE}/results`);
  if (!res.ok) throw new Error(`Failed to fetch results: ${res.status}`);
  return res.json();
}

export async function startRun(req: StartRequest): Promise<{ status: string; total: number }> {
  const res = await fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `Start failed: ${res.status}`);
  }
  return res.json();
}

export async function stopRun(): Promise<void> {
  const res = await fetch(`${API_BASE}/stop`, { method: "POST" });
  if (!res.ok) throw new Error(`Stop failed: ${res.status}`);
}

export async function reprocessCompanies(companies: CompanyResult[]): Promise<void> {
  const payload = companies.map((c) => ({
    rank: c.rank,
    azienda: c.azienda,
    cfo_nome: c.cfo_nome,
    cfo_ruolo: c.cfo_ruolo,
    website: c.website,
    country: c.country,
  }));
  const res = await fetch(`${SSE_DIRECT}/api/enrichment/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companies: payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `Reprocess failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// SSE stream connection — connects directly to avoid Next.js proxy buffering
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  onProgress?: (data: ProgressEvent) => void;
  onCompany?: (data: CompanyResult) => void;
  onDone?: (data: DoneEvent) => void;
  onError?: (message: string) => void;
}

export function connectToEnrichmentStream(handlers: StreamHandlers): EventSource {
  const es = new EventSource(`${SSE_DIRECT}/api/enrichment/stream`);

  es.addEventListener("progress", (e) => {
    try {
      handlers.onProgress?.(JSON.parse((e as MessageEvent).data));
    } catch {}
  });

  es.addEventListener("company", (e) => {
    try {
      handlers.onCompany?.(JSON.parse((e as MessageEvent).data));
    } catch {}
  });

  es.addEventListener("done", (e) => {
    try {
      handlers.onDone?.(JSON.parse((e as MessageEvent).data));
    } catch {}
  });

  es.addEventListener("error", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data ?? "{}");
      handlers.onError?.((data as { message?: string }).message ?? "Unknown error");
    } catch {}
  });

  return es;
}
