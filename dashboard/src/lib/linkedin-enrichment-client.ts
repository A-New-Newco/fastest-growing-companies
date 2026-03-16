// Types and SSE client for the LinkedIn Enricher monitoring server (port 8766).

export interface ContactInput {
  id: string;
  nome: string;
  ruolo?: string | null;
  azienda: string;
  sito_web?: string | null;
  data_origin?: string;
}

export interface LinkedinStatus {
  status: "idle" | "running" | "completed" | "error";
  output_dir: string;
  total: number;
  completed: number;
  found: number;
  not_found: number;
  rate_limits: number;
  total_cost_usd: number;
  elapsed_s: number;
  error_message: string | null;
}

export interface ContactResult {
  id: string;
  nome: string;
  ruolo: string | null;
  azienda: string;
  sito_web: string | null;
  linkedin_url: string | null;
  confidenza: "high" | "medium" | "low" | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_calls: number;
  elapsed_s: number;
  had_rate_limit: boolean;
  is_reprocess?: boolean;
}

export interface LinkedinProgressEvent {
  completed: number;
  total: number;
  found: number;
  not_found: number;
  rate_limits: number;
  total_cost_usd: number;
  elapsed_s: number;
}

export interface LinkedinDoneEvent {
  cancelled?: boolean;
  total?: number;
  found?: number;
  pct?: number;
  total_cost_usd?: number;
  elapsed_s?: number;
  rate_limits?: number;
}

export interface LinkedinStartRequest {
  contacts: ContactInput[];
  max_concurrency: number;
  reset: boolean;
  run_id?: string;
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

// REST calls go through Next.js rewrite proxy
const API_BASE = "/api/linkedin-enrichment";

// SSE connects directly to the monitor server (Next.js proxy buffers SSE)
const SSE_DIRECT = "http://localhost:8766";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function fetchLinkedinStatus(): Promise<LinkedinStatus> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json();
}

export async function fetchLinkedinResults(): Promise<ContactResult[]> {
  const res = await fetch(`${API_BASE}/results`);
  if (!res.ok) throw new Error(`Failed to fetch results: ${res.status}`);
  return res.json();
}

export async function fetchLinkedinHistory(): Promise<ContactResult[]> {
  const res = await fetch(`${API_BASE}/history`);
  if (!res.ok) throw new Error(`Failed to fetch history: ${res.status}`);
  return res.json();
}

export async function startLinkedinRun(
  req: LinkedinStartRequest
): Promise<{ status: string; total: number }> {
  const res = await fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail ?? `Start failed: ${res.status}`
    );
  }
  return res.json();
}

export async function stopLinkedinRun(): Promise<void> {
  const res = await fetch(`${API_BASE}/stop`, { method: "POST" });
  if (!res.ok) throw new Error(`Stop failed: ${res.status}`);
}

export async function reprocessLinkedinContacts(
  contacts: ContactResult[]
): Promise<void> {
  const payload = contacts.map((c) => ({
    id: c.id,
    nome: c.nome,
    ruolo: c.ruolo,
    azienda: c.azienda,
    sito_web: c.sito_web,
  }));
  const res = await fetch(`${SSE_DIRECT}/api/linkedin/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contacts: payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail ?? `Reprocess failed: ${res.status}`
    );
  }
}

// ---------------------------------------------------------------------------
// SSE stream connection — connects directly to avoid Next.js proxy buffering
// ---------------------------------------------------------------------------

export interface LinkedinStreamHandlers {
  onProgress?: (data: LinkedinProgressEvent) => void;
  onContact?: (data: ContactResult) => void;
  onDone?: (data: LinkedinDoneEvent) => void;
  onError?: (message: string) => void;
}

export function connectToLinkedinStream(
  handlers: LinkedinStreamHandlers
): EventSource {
  const es = new EventSource(`${SSE_DIRECT}/api/linkedin/stream`);

  es.addEventListener("progress", (e) => {
    try {
      handlers.onProgress?.(JSON.parse((e as MessageEvent).data));
    } catch {}
  });

  es.addEventListener("contact", (e) => {
    try {
      handlers.onContact?.(JSON.parse((e as MessageEvent).data));
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
      handlers.onError?.(
        (data as { message?: string }).message ?? "Unknown error"
      );
    } catch {}
  });

  return es;
}
