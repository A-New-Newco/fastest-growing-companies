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
import type { SSELogEntry } from "@/types";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

  if (session.status === "completed") {
    return new Response("Session already completed", { status: 409 });
  }

  if (session.status === "failed") {
    return new Response("Session failed — create a new session", { status: 409 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }

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
  const modelConfig = session.model_config as { models?: string[]; current_model_index?: number } | null;
  let modelPool: ModelPoolState = createModelPool(modelConfig?.models ?? undefined);
  if (modelConfig?.current_model_index) {
    modelPool = { ...modelPool, currentIndex: modelConfig.current_model_index };
  }

  // Mark session as running
  await admin.from("enrichment_sessions").update({
    status: "running",
    started_at: session.started_at ?? new Date().toISOString(),
  }).eq("id", params.id);

  const { signal } = req;

  // Aggregate counters (to update session after each company)
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
        // Update last_heartbeat in DB
        admin.from("enrichment_sessions")
          .update({ last_heartbeat: new Date().toISOString() })
          .eq("id", params.id)
          .then(() => {});
      }, 15_000);

      try {
        enqueue("session_start", {
          sessionId: params.id,
          totalCompanies,
          resumedAt: totalCompanies - pending.length,
        });

        for (const row of pending) {
          if (signal.aborted) break;

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
          let rateLimited = false;

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
                apiKey,
                (entry) => {
                  logs.push(entry);
                  enqueue("log", { companyRowId: row.id, entry });
                },
                signal
              );
              rateLimited = false;
              break; // success
            } catch (err) {
              lastError = err;
              if (signal.aborted) break;

              if (isRateLimitError(err)) {
                rateLimited = true;
                modelPool = markRateLimited(modelPool, modelToUse);
                const rotated = rotateModel(modelPool);
                if (!rotated) {
                  // All models rate-limited — wait 60s then retry current
                  await new Promise((r) => setTimeout(r, 60_000));
                } else {
                  modelPool = rotated;
                }
              } else {
                // Non-rate-limit error — don't retry with different model
                break;
              }
            }
          }

          if (signal.aborted) {
            // Revert to pending
            await admin.from("enrichment_session_companies")
              .update({ status: "pending" })
              .eq("id", row.id);
            break;
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

            await admin.from("enrichment_session_companies").update({
              status: "done",
              result_nome: callResult.result.nome ?? null,
              result_ruolo: callResult.result.ruolo ?? null,
              result_linkedin: callResult.result.linkedin_url ?? null,
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
                linkedin: callResult.result.linkedin_url ?? null,
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

          // Update session counters + model pool state
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

          enqueue("session_progress", {
            completed: completedCount,
            total: totalCompanies,
            found: foundCount,
            failed: failedCount,
            tokensTotal: sessionTokensInput + sessionTokensOutput,
          });
        }

        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          // Paused by disconnect
          await admin.from("enrichment_sessions").update({ status: "paused" }).eq("id", params.id);
          enqueue("session_paused", {
            sessionId: params.id,
            completedSoFar: completedCount,
            reason: "client_disconnect",
          });
        } else {
          // All done
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
