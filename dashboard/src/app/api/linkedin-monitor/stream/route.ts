import { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { findLinkedIn } from "@/lib/linkedin-finder";

export const dynamic = "force-dynamic";

interface ContactInput {
  id: string;
  nome: string;
  ruolo?: string | null;
  azienda: string;
  sito_web?: string | null;
}

interface StreamBody {
  contacts: ContactInput[];
  max_concurrency?: number;
}

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

// ── POST /api/linkedin-monitor/stream ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }

  let body: StreamBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { contacts, max_concurrency = 3 } = body;

  if (!contacts?.length) {
    return new Response("contacts must not be empty", { status: 400 });
  }

  const numWorkers = Math.min(8, Math.max(1, max_concurrency));
  const { signal } = req;
  const key: string = apiKey;

  // Aggregate counters
  let completed = 0;
  let found = 0;
  let notFound = 0;
  const total = contacts.length;
  const startTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(event: string, data: unknown) {
        try {
          controller.enqueue(new TextEncoder().encode(sseEvent(event, data)));
        } catch { /* closed */ }
      }

      // Heartbeat
      const heartbeatInterval = setInterval(() => {
        enqueue("ping", {});
      }, 15_000);

      async function processContact(contact: ContactInput) {
        if (signal.aborted) return;

        const t0 = Date.now();
        let linkedinUrl: string | null = null;

        try {
          linkedinUrl = await findLinkedIn(contact.azienda, contact.nome, key, signal);
        } catch {
          // Non-fatal — treat as not found
        }

        if (signal.aborted) return;

        const elapsedS = (Date.now() - t0) / 1000;
        completed++;
        if (linkedinUrl) found++;
        else notFound++;

        // Emit contact result (same shape as Python server)
        enqueue("contact", {
          id: contact.id,
          nome: contact.nome,
          ruolo: contact.ruolo ?? null,
          azienda: contact.azienda,
          sito_web: contact.sito_web ?? null,
          linkedin_url: linkedinUrl,
          confidenza: linkedinUrl ? "medium" : null,
          cost_usd: null,
          input_tokens: null,
          output_tokens: null,
          tool_calls: 0,
          elapsed_s: Math.round(elapsedS * 100) / 100,
          had_rate_limit: false,
        });

        // Emit progress
        enqueue("progress", {
          completed,
          total,
          found,
          not_found: notFound,
          rate_limits: 0,
          total_cost_usd: 0,
          elapsed_s: Math.round((Date.now() - startTime) / 100) / 10,
        });
      }

      try {
        const queue = [...contacts];

        async function runWorker() {
          while (!signal.aborted) {
            const contact = queue.shift();
            if (!contact) break;
            await processContact(contact);
          }
        }

        const workerCount = Math.min(numWorkers, contacts.length);
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        clearInterval(heartbeatInterval);

        if (signal.aborted) {
          enqueue("done", { cancelled: true });
        } else {
          enqueue("done", {
            total,
            found,
            pct: total > 0 ? Math.round((found / total) * 100) : 0,
            total_cost_usd: 0,
            elapsed_s: Math.round((Date.now() - startTime) / 100) / 10,
            rate_limits: 0,
          });
        }
      } catch (err) {
        clearInterval(heartbeatInterval);
        enqueue("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
