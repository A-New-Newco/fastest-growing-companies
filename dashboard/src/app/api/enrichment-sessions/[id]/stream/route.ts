import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  enrichCompany,
  isRateLimitError,
  createModelPool,
  getCurrentModel,
  rotateModel,
  markRateLimited,
  recordUsage,
  type ModelPoolState,
} from "@/lib/groq-enricher";
import { findLinkedIn } from "@/lib/linkedin-finder";
import type { SSELogEntry } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

// ── CFO-Enricher local server ────────────────────────────────────────────────

const LOCAL_ENRICHER_BASE = process.env.CFO_ENRICHER_URL ?? "http://localhost:8765";
const LINKEDIN_ENRICHER_BASE = process.env.LINKEDIN_ENRICHER_URL ?? "http://localhost:8766";

// ── GET /api/enrichment-sessions/[id]/stream ──────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Verify session belongs to user's team
  const { data: session } = await supabase
    .from("enrichment_sessions")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  if (session.status === "completed" || session.status === "failed") {
    // Check if there are pending companies (e.g. after a retry reset)
    const admin = createAdminSupabaseClient();
    const { count } = await admin
      .from("enrichment_session_companies")
      .select("id", { count: "exact", head: true })
      .eq("session_id", params.id)
      .eq("status", "pending");

    if (!count || count === 0) {
      return new Response(
        session.status === "completed"
          ? "Session already completed"
          : "Session failed — retry failed companies or create a new session",
        { status: 409 }
      );
    }
  }

  const modelConfig = session.model_config as {
    enrichmentMode?: "remote" | "local";
    models?: string[];
    current_model_index?: number;
    numWorkers?: number;
  } | null;

  const enrichmentMode = modelConfig?.enrichmentMode ?? "remote";
  const enrichmentCategory = (session.enrichment_category as string) ?? "cfo";

  if (enrichmentCategory === "linkedin") {
    if (enrichmentMode === "local") {
      return handleLinkedInLocalStream(req, session, params);
    }
    return handleLinkedInRemoteStream(req, session, params, modelConfig);
  }

  if (enrichmentMode === "local") {
    return handleLocalStream(req, session, params);
  }

  return handleRemoteStream(req, session, params, modelConfig);
}

// ── LOCAL mode: proxy SSE from cfo-enricher Python server ────────────────────

async function handleLocalStream(
  req: NextRequest,
  session: Record<string, unknown>,
  params: Params["params"],
) {
  const admin = createAdminSupabaseClient();
  const sessionId = params.id;

  // Reset stuck 'running' companies back to 'pending'
  await admin
    .from("enrichment_session_companies")
    .update({ status: "pending" })
    .eq("session_id", sessionId)
    .eq("status", "running");

  // Fetch pending companies in order
  const { data: pendingRows } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("position", { ascending: true });

  const pending = pendingRows ?? [];
  if (pending.length === 0) {
    return new Response("No pending companies", { status: 409 });
  }

  // Build position → row mapping for translating events
  const positionToRow = new Map<number, { id: string; company_name: string }>();
  for (const row of pending) {
    positionToRow.set(row.position as number, {
      id: row.id as string,
      company_name: row.company_name as string,
    });
  }

  const modelConfig = session.model_config as { numWorkers?: number } | null;
  const numWorkers = Math.min(8, Math.max(1, modelConfig?.numWorkers ?? 8));
  const totalCompanies = Number(session.total_companies ?? 0);

  // Mark session as running
  await admin.from("enrichment_sessions").update({
    status: "running",
    started_at: session.started_at ?? new Date().toISOString(),
  }).eq("id", sessionId);

  // Start enrichment on local server
  const inlineCompanies = pending.map((row) => ({
    rank: row.position as number,
    company_name: row.company_name as string,
    website: (row.company_website as string | null) ?? undefined,
    country: (row.company_country as string | null) ?? "IT",
  }));

  let startOk = false;
  try {
    const startRes = await fetch(`${LOCAL_ENRICHER_BASE}/api/enrichment/start-inline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        companies: inlineCompanies,
        max_concurrency: numWorkers,
      }),
    });
    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      const detail = (err as { detail?: string }).detail ?? `Local server error: ${startRes.status}`;
      await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
      return new Response(detail, { status: 502 });
    }
    startOk = true;
  } catch {
    await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
    return new Response("Cannot reach local enrichment server. Is cfo-enricher running?", { status: 502 });
  }

  if (!startOk) {
    return new Response("Failed to start local enrichment", { status: 502 });
  }

  const { signal } = req;

  // Aggregate counters
  let completedCount = Number(session.completed_count ?? 0);
  let foundCount = Number(session.found_count ?? 0);
  let failedCount = Number(session.failed_count ?? 0);

  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
        } catch { /* closed */ }
      }

      // Heartbeat
      const heartbeatInterval = setInterval(() => {
        enqueue("heartbeat", { ts: new Date().toISOString() });
        admin.from("enrichment_sessions")
          .update({ last_heartbeat: new Date().toISOString() })
          .eq("id", sessionId)
          .then(() => {});
      }, 15_000);

      // Serialize counter DB writes
      let counterLock = Promise.resolve();
      function flushCounters() {
        counterLock = counterLock.then(async () => {
          await admin.from("enrichment_sessions").update({
            completed_count: completedCount,
            found_count: foundCount,
            failed_count: failedCount,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", sessionId);
        });
      }

      enqueue("session_start", {
        sessionId,
        totalCompanies,
        resumedAt: totalCompanies - pending.length,
        numWorkers,
      });

      try {
        // Connect to local server SSE stream
        const sseRes = await fetch(`${LOCAL_ENRICHER_BASE}/api/enrichment/stream`, {
          signal,
        });

        if (!sseRes.ok || !sseRes.body) {
          throw new Error(`SSE connection failed: ${sseRes.status}`);
        }

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? ""; // keep incomplete line in buffer

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "") {
              // End of SSE frame — process it
              if (currentEvent && currentData) {
                await processLocalEvent(
                  currentEvent,
                  currentData,
                  positionToRow,
                  admin,
                  sessionId,
                  enqueue,
                  flushCounters,
                  totalCompanies,
                  () => completedCount,
                  () => foundCount,
                  () => failedCount,
                  (fn) => {
                    const result = fn(completedCount, foundCount, failedCount);
                    completedCount = result.completedCount;
                    foundCount = result.foundCount;
                    failedCount = result.failedCount;
                  },
                );
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }

        await counterLock;
        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          // Client disconnected — stop the local server and pause session
          try {
            await fetch(`${LOCAL_ENRICHER_BASE}/api/enrichment/stop`, { method: "POST" });
          } catch { /* best effort */ }
          await admin.from("enrichment_sessions").update({ status: "paused" }).eq("id", sessionId);
          enqueue("session_paused", {
            sessionId,
            completedSoFar: completedCount,
            reason: "client_disconnect",
          });
        } else {
          await admin.from("enrichment_sessions").update({
            status: "completed",
            completed_at: new Date().toISOString(),
          }).eq("id", sessionId);

          enqueue("session_complete", {
            sessionId,
            found: foundCount,
            failed: failedCount,
            total: totalCompanies,
            tokensTotal: 0,
          });
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        if (!signal.aborted) {
          await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
          enqueue("error", { message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// Process a single SSE event from the local cfo-enricher server
async function processLocalEvent(
  eventType: string,
  rawData: string,
  positionToRow: Map<number, { id: string; company_name: string }>,
  admin: ReturnType<typeof createAdminSupabaseClient>,
  sessionId: string,
  enqueue: (event: string, data: unknown) => void,
  flushCounters: () => void,
  totalCompanies: number,
  getCompleted: () => number,
  getFound: () => number,
  getFailed: () => number,
  updateCounters: (fn: (c: number, f: number, fl: number) => { completedCount: number; foundCount: number; failedCount: number }) => void,
) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawData);
  } catch {
    return;
  }

  if (eventType === "company") {
    // Map rank (= position) to enrichment_session_companies row
    const rank = data.rank as number;
    const row = positionToRow.get(rank);
    if (!row) return;

    const cfoNome = (data.cfo_nome as string | null) ?? null;
    const cfoRuolo = (data.cfo_ruolo as string | null) ?? null;
    const cfoLinkedin = (data.cfo_linkedin as string | null) ?? null;
    const confidenza = (data.confidenza as string | null) ?? null;
    const succeeded = cfoNome !== null;

    // Update DB row
    await admin.from("enrichment_session_companies").update({
      status: "done",
      result_nome: cfoNome,
      result_ruolo: cfoRuolo,
      result_linkedin: cfoLinkedin,
      result_confidenza: confidenza,
      model_used: "claude-haiku-4.5 (local)",
      tokens_input: (data.input_tokens as number) ?? 0,
      tokens_output: (data.output_tokens as number) ?? 0,
      logs: [],
      error_message: null,
    }).eq("id", row.id);

    // Update counters
    updateCounters((c, f, fl) => ({
      completedCount: c + 1,
      foundCount: succeeded ? f + 1 : f,
      failedCount: succeeded ? fl : fl + 1,
    }));

    // Emit company_done to frontend
    enqueue("company_done", {
      companyRowId: row.id,
      status: "done",
      result: {
        nome: cfoNome,
        ruolo: cfoRuolo,
        linkedin: cfoLinkedin,
        confidenza,
      },
      tokensInput: (data.input_tokens as number) ?? 0,
      tokensOutput: (data.output_tokens as number) ?? 0,
      modelUsed: "claude-haiku-4.5 (local)",
    });

    flushCounters();

    enqueue("session_progress", {
      completed: getCompleted(),
      total: totalCompanies,
      found: getFound(),
      failed: getFailed(),
      tokensTotal: 0,
    });
  } else if (eventType === "done") {
    // Enrichment complete — session_complete is emitted by the outer loop
  } else if (eventType === "error") {
    enqueue("error", { message: (data.message as string) ?? "Local enricher error" });
  }
  // Ignore 'progress' and 'ping' events — we compute our own progress
}

// ── REMOTE mode: Groq-based enrichment (original logic) ─────────────────────

async function handleRemoteStream(
  req: NextRequest,
  session: Record<string, unknown>,
  params: Params["params"],
  modelConfig: {
    enrichmentMode?: "remote" | "local";
    models?: string[];
    current_model_index?: number;
    numWorkers?: number;
  } | null,
) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }
  const key: string = apiKey;

  const admin = createAdminSupabaseClient();

  // On crash recovery: reset any stuck 'running' companies back to 'pending'
  await admin
    .from("enrichment_session_companies")
    .update({ status: "pending" })
    .eq("session_id", params.id)
    .eq("status", "running");

  // Fetch pending companies in order
  const { data: pendingRows } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("session_id", params.id)
    .eq("status", "pending")
    .order("position", { ascending: true });

  const pending = pendingRows ?? [];

  // Initialize model pool from session config
  let modelPool: ModelPoolState = createModelPool(modelConfig?.models ?? undefined);
  if (modelConfig?.current_model_index) {
    modelPool = { ...modelPool, currentIndex: modelConfig.current_model_index };
  }

  // compound-beta: 30 rpm. With multi-iteration calls (~3-5 per company), safe limit is ~5 workers.
  // Max 8 as a hard cap (user-configurable via numWorkers in model_config).
  const numWorkers = Math.min(8, Math.max(1, modelConfig?.numWorkers ?? 3));

  // Mark session as running
  await admin.from("enrichment_sessions").update({
    status: "running",
    started_at: session.started_at ?? new Date().toISOString(),
  }).eq("id", params.id);

  const { signal } = req;

  // Aggregate counters (updated atomically — JS is single-threaded between awaits)
  let sessionTokensInput = Number(session.tokens_input ?? 0);
  let sessionTokensOutput = Number(session.tokens_output ?? 0);
  let completedCount = Number(session.completed_count ?? 0);
  let foundCount = Number(session.found_count ?? 0);
  let failedCount = Number(session.failed_count ?? 0);
  const totalCompanies = Number(session.total_companies ?? 0);

  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
        } catch {
          // Controller already closed
        }
      }

      // Heartbeat interval (every 15s)
      const heartbeatInterval = setInterval(() => {
        enqueue("heartbeat", { ts: new Date().toISOString() });
        admin.from("enrichment_sessions")
          .update({ last_heartbeat: new Date().toISOString() })
          .eq("id", params.id)
          .then(() => {});
      }, 15_000);

      // Serialize session-counter DB writes to avoid last-write-wins races between workers
      let counterLock = Promise.resolve();
      function flushCounters() {
        counterLock = counterLock.then(async () => {
          await admin.from("enrichment_sessions").update({
            tokens_input: sessionTokensInput,
            tokens_output: sessionTokensOutput,
            tokens_total: sessionTokensInput + sessionTokensOutput,
            completed_count: completedCount,
            found_count: foundCount,
            failed_count: failedCount,
            last_heartbeat: new Date().toISOString(),
            model_config: { ...modelConfig, models: modelPool.models, current_model_index: modelPool.currentIndex },
          }).eq("id", params.id);
        });
      }

      // ── Per-company processing ─────────────────────────────────────────────

      type PendingRow = NonNullable<typeof pendingRows>[number];

      async function processCompany(row: PendingRow) {
        if (signal.aborted) return;

        const currentModel = getCurrentModel(modelPool);

        enqueue("company_start", {
          companyRowId: row.id,
          position: row.position,
          companyName: row.company_name,
          model: currentModel,
        });

        // Mark as running
        await admin.from("enrichment_session_companies")
          .update({ status: "running", model_used: currentModel })
          .eq("id", row.id);

        const logs: SSELogEntry[] = [];
        let callResult;
        let usedModel = currentModel;
        let lastError: unknown;

        // Try enrichment with model rolling on rate-limit
        for (let attempt = 0; attempt < 3; attempt++) {
          if (signal.aborted) break;

          const modelToUse = getCurrentModel(modelPool);
          usedModel = modelToUse;

          try {
            callResult = await enrichCompany(
              {
                companyName: row.company_name,
                website: row.company_website ?? null,
                country: row.company_country ?? "IT",
                revenueK: null,
              },
              modelToUse,
              key,
              (entry) => {
                logs.push(entry);
                enqueue("log", { companyRowId: row.id, entry });
              },
              signal
            );
            break; // success
          } catch (err) {
            lastError = err;
            if (signal.aborted) break;

            if (isRateLimitError(err)) {
              modelPool = markRateLimited(modelPool, modelToUse);
              const rotated = rotateModel(modelPool);
              if (!rotated) {
                // All models rate-limited — wait 60s then retry current
                await new Promise((r) => setTimeout(r, 60_000));
              } else {
                modelPool = rotated;
              }
            } else {
              break;
            }
          }
        }

        if (signal.aborted) {
          await admin.from("enrichment_session_companies")
            .update({ status: "pending" })
            .eq("id", row.id);
          return;
        }

        // Persist result
        const capped = logs.slice(-200);

        if (callResult) {
          modelPool = recordUsage(modelPool, usedModel, callResult.tokensInput, callResult.tokensOutput);
          sessionTokensInput += callResult.tokensInput;
          sessionTokensOutput += callResult.tokensOutput;

          const succeeded = callResult.result.nome !== null;
          completedCount++;
          if (succeeded) foundCount++;
          else failedCount++;

          // LinkedIn fallback: if name found but no LinkedIn, run a dedicated search
          let resolvedLinkedin = callResult.result.linkedin_url ?? null;
          if (callResult.result.nome && !resolvedLinkedin && !signal.aborted) {
            enqueue("log", {
              companyRowId: row.id,
              entry: { ts: new Date().toISOString(), event: "think", data: { text: "LinkedIn not found in enrichment — running fallback search..." } },
            });
            try {
              const liResult = await findLinkedIn(row.company_name, callResult.result.nome, key, signal);
              resolvedLinkedin = liResult.url;
            } catch {
              // Non-critical — continue without LinkedIn
            }
            if (resolvedLinkedin) {
              enqueue("log", {
                companyRowId: row.id,
                entry: { ts: new Date().toISOString(), event: "result", data: { text: `LinkedIn found: ${resolvedLinkedin}` } },
              });
            }
          }

          await admin.from("enrichment_session_companies").update({
            status: "done",
            result_nome: callResult.result.nome ?? null,
            result_ruolo: callResult.result.ruolo ?? null,
            result_linkedin: resolvedLinkedin,
            result_confidenza: callResult.result.confidenza ?? null,
            model_used: usedModel,
            tokens_input: callResult.tokensInput,
            tokens_output: callResult.tokensOutput,
            logs: capped,
            error_message: null,
          }).eq("id", row.id);

          enqueue("company_done", {
            companyRowId: row.id,
            status: "done",
            result: {
              nome: callResult.result.nome,
              ruolo: callResult.result.ruolo ?? null,
              linkedin: resolvedLinkedin,
              confidenza: callResult.result.confidenza ?? null,
            },
            tokensInput: callResult.tokensInput,
            tokensOutput: callResult.tokensOutput,
            modelUsed: usedModel,
          });
        } else {
          // Failed
          const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? "Unknown error");
          completedCount++;
          failedCount++;

          await admin.from("enrichment_session_companies").update({
            status: "failed",
            model_used: usedModel,
            tokens_input: 0,
            tokens_output: 0,
            logs: capped,
            error_message: errMsg.slice(0, 500),
          }).eq("id", row.id);

          enqueue("company_done", {
            companyRowId: row.id,
            status: "failed",
            tokensInput: 0,
            tokensOutput: 0,
            modelUsed: usedModel,
            errorMessage: errMsg.slice(0, 200),
          });
        }

        // Update session counters (serialized to avoid out-of-order DB writes)
        flushCounters();

        enqueue("session_progress", {
          completed: completedCount,
          total: totalCompanies,
          found: foundCount,
          failed: failedCount,
          tokensTotal: sessionTokensInput + sessionTokensOutput,
        });
      }

      // ── Worker pool ────────────────────────────────────────────────────────

      try {
        enqueue("session_start", {
          sessionId: params.id,
          totalCompanies,
          resumedAt: totalCompanies - pending.length,
          numWorkers,
        });

        const queue = [...pending];

        async function runWorker() {
          while (!signal.aborted) {
            const row = queue.shift();
            if (!row) break;
            await processCompany(row);
          }
        }

        const workerCount = Math.min(numWorkers, pending.length);
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        // Wait for any in-flight counter flush before final status update
        await counterLock;

        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          await admin.from("enrichment_sessions").update({ status: "paused" }).eq("id", params.id);
          enqueue("session_paused", {
            sessionId: params.id,
            completedSoFar: completedCount,
            reason: "client_disconnect",
          });
        } else {
          await admin.from("enrichment_sessions").update({
            status: "completed",
            completed_at: new Date().toISOString(),
          }).eq("id", params.id);

          enqueue("session_complete", {
            sessionId: params.id,
            found: foundCount,
            failed: failedCount,
            total: totalCompanies,
            tokensTotal: sessionTokensInput + sessionTokensOutput,
          });
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", params.id);
        enqueue("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// ── LINKEDIN REMOTE mode: Groq-based LinkedIn search ─────────────────────────

async function handleLinkedInRemoteStream(
  req: NextRequest,
  session: Record<string, unknown>,
  params: Params["params"],
  modelConfig: {
    enrichmentMode?: "remote" | "local";
    models?: string[];
    current_model_index?: number;
    numWorkers?: number;
  } | null,
) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }
  const key: string = apiKey;

  const admin = createAdminSupabaseClient();

  await admin
    .from("enrichment_session_companies")
    .update({ status: "pending" })
    .eq("session_id", params.id)
    .eq("status", "running");

  const { data: pendingRows } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("session_id", params.id)
    .eq("status", "pending")
    .order("position", { ascending: true });

  const pending = pendingRows ?? [];
  const numWorkers = Math.min(8, Math.max(1, modelConfig?.numWorkers ?? 3));

  await admin.from("enrichment_sessions").update({
    status: "running",
    started_at: session.started_at ?? new Date().toISOString(),
  }).eq("id", params.id);

  const { signal } = req;

  let sessionTokensInput = Number(session.tokens_input ?? 0);
  let sessionTokensOutput = Number(session.tokens_output ?? 0);
  let completedCount = Number(session.completed_count ?? 0);
  let foundCount = Number(session.found_count ?? 0);
  let failedCount = Number(session.failed_count ?? 0);
  const totalCompanies = Number(session.total_companies ?? 0);

  const linkedInStream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
        } catch { /* closed */ }
      }

      const heartbeatInterval = setInterval(() => {
        enqueue("heartbeat", { ts: new Date().toISOString() });
        admin.from("enrichment_sessions")
          .update({ last_heartbeat: new Date().toISOString() })
          .eq("id", params.id)
          .then(() => {});
      }, 15_000);

      let counterLock = Promise.resolve();
      function flushCounters() {
        counterLock = counterLock.then(async () => {
          await admin.from("enrichment_sessions").update({
            tokens_input: sessionTokensInput,
            tokens_output: sessionTokensOutput,
            tokens_total: sessionTokensInput + sessionTokensOutput,
            completed_count: completedCount,
            found_count: foundCount,
            failed_count: failedCount,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", params.id);
        });
      }

      type PendingRow = NonNullable<typeof pendingRows>[number];

      async function processContact(row: PendingRow) {
        if (signal.aborted) return;

        const contactNome = (row.contact_nome as string | null) ?? "";
        const contactRuolo = (row.contact_ruolo as string | null) ?? null;

        if (!contactNome) {
          completedCount++;
          failedCount++;
          await admin.from("enrichment_session_companies").update({
            status: "failed",
            error_message: "No contact name provided",
          }).eq("id", row.id);
          enqueue("company_done", {
            companyRowId: row.id,
            status: "failed",
            errorMessage: "No contact name provided",
            tokensInput: 0, tokensOutput: 0, modelUsed: null,
          });
          flushCounters();
          enqueue("session_progress", {
            completed: completedCount, total: totalCompanies,
            found: foundCount, failed: failedCount,
            tokensTotal: sessionTokensInput + sessionTokensOutput,
          });
          return;
        }

        enqueue("company_start", {
          companyRowId: row.id,
          position: row.position,
          companyName: row.company_name,
          model: "linkedin-finder",
        });

        await admin.from("enrichment_session_companies")
          .update({ status: "running" })
          .eq("id", row.id);

        let liResult;
        try {
          liResult = await findLinkedIn(row.company_name as string, contactNome, key, signal);
        } catch (err) {
          if (signal.aborted) {
            await admin.from("enrichment_session_companies").update({ status: "pending" }).eq("id", row.id);
            return;
          }
          completedCount++;
          failedCount++;
          const errMsg = err instanceof Error ? err.message : String(err);
          await admin.from("enrichment_session_companies").update({
            status: "failed", error_message: errMsg.slice(0, 500),
          }).eq("id", row.id);
          enqueue("company_done", {
            companyRowId: row.id, status: "failed",
            errorMessage: errMsg.slice(0, 200),
            tokensInput: 0, tokensOutput: 0, modelUsed: null,
          });
          flushCounters();
          enqueue("session_progress", {
            completed: completedCount, total: totalCompanies,
            found: foundCount, failed: failedCount,
            tokensTotal: sessionTokensInput + sessionTokensOutput,
          });
          return;
        }

        if (signal.aborted) {
          await admin.from("enrichment_session_companies").update({ status: "pending" }).eq("id", row.id);
          return;
        }

        sessionTokensInput += liResult.tokensInput;
        sessionTokensOutput += liResult.tokensOutput;
        completedCount++;
        if (liResult.url) foundCount++;
        else failedCount++;

        await admin.from("enrichment_session_companies").update({
          status: "done",
          result_nome: contactNome,
          result_ruolo: contactRuolo,
          result_linkedin: liResult.url,
          result_confidenza: liResult.url ? "medium" : null,
          model_used: liResult.modelUsed ?? "linkedin-finder",
          tokens_input: liResult.tokensInput,
          tokens_output: liResult.tokensOutput,
          logs: [],
          error_message: null,
        }).eq("id", row.id);

        enqueue("company_done", {
          companyRowId: row.id,
          status: "done",
          result: {
            nome: contactNome,
            ruolo: contactRuolo,
            linkedin: liResult.url,
            confidenza: liResult.url ? "medium" : null,
          },
          tokensInput: liResult.tokensInput,
          tokensOutput: liResult.tokensOutput,
          modelUsed: liResult.modelUsed ?? "linkedin-finder",
        });

        flushCounters();
        enqueue("session_progress", {
          completed: completedCount, total: totalCompanies,
          found: foundCount, failed: failedCount,
          tokensTotal: sessionTokensInput + sessionTokensOutput,
        });
      }

      try {
        enqueue("session_start", {
          sessionId: params.id, totalCompanies,
          resumedAt: totalCompanies - pending.length, numWorkers,
        });

        const queue = [...pending];
        async function runWorker() {
          while (!signal.aborted) {
            const row = queue.shift();
            if (!row) break;
            await processContact(row);
          }
        }

        const workerCount = Math.min(numWorkers, pending.length);
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
        await counterLock;
        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          await admin.from("enrichment_sessions").update({ status: "paused" }).eq("id", params.id);
          enqueue("session_paused", { sessionId: params.id, completedSoFar: completedCount, reason: "client_disconnect" });
        } else {
          await admin.from("enrichment_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", params.id);
          enqueue("session_complete", { sessionId: params.id, found: foundCount, failed: failedCount, total: totalCompanies, tokensTotal: sessionTokensInput + sessionTokensOutput });
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", params.id);
        enqueue("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(linkedInStream, { headers: SSE_HEADERS });
}

// ── LINKEDIN LOCAL mode: proxy SSE from linkedin-enricher Python server ──────

async function handleLinkedInLocalStream(
  req: NextRequest,
  session: Record<string, unknown>,
  params: Params["params"],
) {
  const admin = createAdminSupabaseClient();
  const sessionId = params.id;

  await admin
    .from("enrichment_session_companies")
    .update({ status: "pending" })
    .eq("session_id", sessionId)
    .eq("status", "running");

  const { data: pendingRows } = await admin
    .from("enrichment_session_companies")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("position", { ascending: true });

  const pending = pendingRows ?? [];
  if (pending.length === 0) {
    return new Response("No pending companies", { status: 409 });
  }

  // Build id → row mapping for translating events
  const idToRow = new Map<string, { rowId: string; contact_nome: string | null; contact_ruolo: string | null }>();
  for (const row of pending) {
    idToRow.set(row.id as string, {
      rowId: row.id as string,
      contact_nome: (row.contact_nome as string | null) ?? null,
      contact_ruolo: (row.contact_ruolo as string | null) ?? null,
    });
  }

  const modelConfig = session.model_config as { numWorkers?: number } | null;
  const numWorkers = Math.min(8, Math.max(1, modelConfig?.numWorkers ?? 8));
  const totalCompanies = Number(session.total_companies ?? 0);

  await admin.from("enrichment_sessions").update({
    status: "running",
    started_at: session.started_at ?? new Date().toISOString(),
  }).eq("id", sessionId);

  // Build contacts payload for linkedin-enricher
  const contacts = pending.map((row) => ({
    id: row.id as string,
    nome: (row.contact_nome as string | null) ?? "",
    ruolo: (row.contact_ruolo as string | null) ?? undefined,
    azienda: row.company_name as string,
    sito_web: (row.company_website as string | null) ?? undefined,
  }));

  let startOk = false;
  try {
    const startRes = await fetch(`${LINKEDIN_ENRICHER_BASE}/api/linkedin/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts, max_concurrency: numWorkers, reset: true }),
    });
    if (!startRes.ok) {
      const err = await startRes.json().catch(() => ({}));
      const detail = (err as { detail?: string }).detail ?? `LinkedIn server error: ${startRes.status}`;
      await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
      return new Response(detail, { status: 502 });
    }
    startOk = true;
  } catch {
    await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
    return new Response("Cannot reach LinkedIn enrichment server. Is linkedin-enricher running?", { status: 502 });
  }

  if (!startOk) {
    return new Response("Failed to start LinkedIn enrichment", { status: 502 });
  }

  const { signal } = req;
  let completedCount = Number(session.completed_count ?? 0);
  let foundCount = Number(session.found_count ?? 0);
  let failedCount = Number(session.failed_count ?? 0);

  const linkedInLocalStream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        try { controller.enqueue(new TextEncoder().encode(sseEvent(event, data))); } catch { /* closed */ }
      }

      const heartbeatInterval = setInterval(() => {
        enqueue("heartbeat", { ts: new Date().toISOString() });
        admin.from("enrichment_sessions").update({ last_heartbeat: new Date().toISOString() }).eq("id", sessionId).then(() => {});
      }, 15_000);

      let counterLock = Promise.resolve();
      function flushCounters() {
        counterLock = counterLock.then(async () => {
          await admin.from("enrichment_sessions").update({
            completed_count: completedCount, found_count: foundCount, failed_count: failedCount,
            last_heartbeat: new Date().toISOString(),
          }).eq("id", sessionId);
        });
      }

      enqueue("session_start", { sessionId, totalCompanies, resumedAt: totalCompanies - pending.length, numWorkers });

      try {
        const sseRes = await fetch(`${LINKEDIN_ENRICHER_BASE}/api/linkedin/stream`, { signal });
        if (!sseRes.ok || !sseRes.body) throw new Error(`LinkedIn SSE connection failed: ${sseRes.status}`);

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "") {
              if (currentEvent && currentData) {
                try {
                  const evData = JSON.parse(currentData) as Record<string, unknown>;

                  if (currentEvent === "contact") {
                    const contactId = evData.id as string;
                    const rowInfo = idToRow.get(contactId);
                    if (rowInfo) {
                      const linkedinUrl = (evData.linkedin_url as string | null) ?? null;
                      const confidenza = (evData.confidenza as string | null) ?? null;
                      const succeeded = linkedinUrl !== null;

                      await admin.from("enrichment_session_companies").update({
                        status: "done",
                        result_nome: rowInfo.contact_nome,
                        result_ruolo: rowInfo.contact_ruolo,
                        result_linkedin: linkedinUrl,
                        result_confidenza: confidenza,
                        model_used: "claude-haiku-4.5 (local)",
                        tokens_input: (evData.input_tokens as number) ?? 0,
                        tokens_output: (evData.output_tokens as number) ?? 0,
                        logs: [], error_message: null,
                      }).eq("id", rowInfo.rowId);

                      completedCount++;
                      if (succeeded) foundCount++;
                      else failedCount++;

                      enqueue("company_done", {
                        companyRowId: rowInfo.rowId, status: "done",
                        result: { nome: rowInfo.contact_nome, ruolo: rowInfo.contact_ruolo, linkedin: linkedinUrl, confidenza },
                        tokensInput: (evData.input_tokens as number) ?? 0,
                        tokensOutput: (evData.output_tokens as number) ?? 0,
                        modelUsed: "claude-haiku-4.5 (local)",
                      });

                      flushCounters();
                      enqueue("session_progress", {
                        completed: completedCount, total: totalCompanies,
                        found: foundCount, failed: failedCount, tokensTotal: 0,
                      });
                    }
                  } else if (currentEvent === "error") {
                    enqueue("error", { message: (evData.message as string) ?? "LinkedIn enricher error" });
                  }
                  // Ignore 'progress', 'done', 'ping' — we compute our own
                } catch { /* parse error, skip */ }
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }

        await counterLock;
        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          try { await fetch(`${LINKEDIN_ENRICHER_BASE}/api/linkedin/stop`, { method: "POST" }); } catch { /* best effort */ }
          await admin.from("enrichment_sessions").update({ status: "paused" }).eq("id", sessionId);
          enqueue("session_paused", { sessionId, completedSoFar: completedCount, reason: "client_disconnect" });
        } else {
          await admin.from("enrichment_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", sessionId);
          enqueue("session_complete", { sessionId, found: foundCount, failed: failedCount, total: totalCompanies, tokensTotal: 0 });
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        if (!signal.aborted) {
          await admin.from("enrichment_sessions").update({ status: "failed" }).eq("id", sessionId);
          enqueue("error", { message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(linkedInLocalStream, { headers: SSE_HEADERS });
}
