/**
 * Groq Enricher Service
 *
 * Runs the CFO-finding agentic loop using Groq models with model rolling.
 * Primary model: compound-beta (built-in web search, 30 rpm / 250 rpd / 70k tpm)
 * Fallback models: llama-3.3-70b-versatile, llama-3.1-8b-instant (text-only)
 *
 * Uses the same direct fetch() pattern as groq-mapper.ts.
 */

import {
  CFO_FINDER_SYSTEM_PROMPT,
  buildEnrichmentUserMessage,
  extractCfoResult,
  cleanCompanyName,
  type EnrichmentUserMessageInput,
  type CfoResult,
} from "./cfo-finder-prompt";
import type { SSELogEntry } from "@/types";

// ── Model definitions ─────────────────────────────────────────────────────────

export interface GroqModelDef {
  id: string;
  rpm: number;   // requests per minute
  rpd: number;   // requests per day
  tpm: number;   // tokens per minute
  hasSearch: boolean; // true for compound-beta which has built-in web search
}

export const GROQ_ENRICHMENT_MODELS: GroqModelDef[] = [
  { id: "compound-beta",           rpm: 30,  rpd: 250,   tpm: 70_000,  hasSearch: true },
  { id: "llama-3.3-70b-versatile", rpm: 30,  rpd: 14400, tpm: 131_072, hasSearch: false },
  { id: "llama-3.1-8b-instant",    rpm: 30,  rpd: 14400, tpm: 131_072, hasSearch: false },
];

// ── Model pool state ──────────────────────────────────────────────────────────

export interface ModelUsage {
  requestCount: number;
  tokensInput: number;
  tokensOutput: number;
  rateLimitHits: number;
  rateLimitedUntil: number | null; // Date.now() ms, null if not rate-limited
}

export interface ModelPoolState {
  models: string[];
  currentIndex: number;
  usage: Record<string, ModelUsage>;
}

export function createModelPool(models?: string[]): ModelPoolState {
  const ids = models ?? GROQ_ENRICHMENT_MODELS.map((m) => m.id);
  const usage: Record<string, ModelUsage> = {};
  for (const id of ids) {
    usage[id] = { requestCount: 0, tokensInput: 0, tokensOutput: 0, rateLimitHits: 0, rateLimitedUntil: null };
  }
  return { models: ids, currentIndex: 0, usage };
}

export function getCurrentModel(pool: ModelPoolState): string {
  return pool.models[pool.currentIndex % pool.models.length];
}

/** Rotate to the next available model (skip rate-limited ones). Returns null if all are limited. */
export function rotateModel(pool: ModelPoolState): ModelPoolState | null {
  const now = Date.now();
  const n = pool.models.length;
  for (let i = 1; i <= n; i++) {
    const idx = (pool.currentIndex + i) % n;
    const id = pool.models[idx];
    const u = pool.usage[id];
    if (!u.rateLimitedUntil || u.rateLimitedUntil <= now) {
      return { ...pool, currentIndex: idx };
    }
  }
  return null; // all models rate-limited
}

export function markRateLimited(pool: ModelPoolState, modelId: string, cooldownMs = 60_000): ModelPoolState {
  return {
    ...pool,
    usage: {
      ...pool.usage,
      [modelId]: {
        ...pool.usage[modelId],
        rateLimitHits: pool.usage[modelId].rateLimitHits + 1,
        rateLimitedUntil: Date.now() + cooldownMs,
      },
    },
  };
}

export function recordUsage(pool: ModelPoolState, modelId: string, tokensInput: number, tokensOutput: number): ModelPoolState {
  const prev = pool.usage[modelId] ?? { requestCount: 0, tokensInput: 0, tokensOutput: 0, rateLimitHits: 0, rateLimitedUntil: null };
  return {
    ...pool,
    usage: {
      ...pool.usage,
      [modelId]: {
        ...prev,
        requestCount: prev.requestCount + 1,
        tokensInput: prev.tokensInput + tokensInput,
        tokensOutput: prev.tokensOutput + tokensOutput,
      },
    },
  };
}

// ── Groq API types ────────────────────────────────────────────────────────────

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface GroqToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface GroqChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: GroqToolCall[];
  };
  finish_reason: string;
}

interface GroqResponse {
  choices: GroqChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Enrichment result ─────────────────────────────────────────────────────────

export interface EnrichmentInput {
  companyName: string;
  website: string | null;
  country: string;
  revenueK?: number | null;
}

export interface EnrichmentCallResult {
  result: CfoResult;
  modelUsed: string;
  tokensInput: number;
  tokensOutput: number;
  logs: SSELogEntry[];
}

// ── Core enrichment function ──────────────────────────────────────────────────

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ITERATIONS = 10;

/**
 * Find the CFO/head of finance for a company using Groq.
 *
 * For compound-beta: uses the model's built-in search (no external tools needed).
 * For other models: text-only reasoning (lower confidence expected).
 */
export async function enrichCompany(
  input: EnrichmentInput,
  modelId: string,
  apiKey: string,
  onLog: (entry: SSELogEntry) => void,
  signal?: AbortSignal
): Promise<EnrichmentCallResult> {
  const cleanName = cleanCompanyName(input.companyName);
  const msgInput: EnrichmentUserMessageInput = {
    companyName: cleanName,
    website: input.website,
    country: input.country,
    revenueK: input.revenueK,
  };

  const messages: GroqMessage[] = [
    { role: "system", content: CFO_FINDER_SYSTEM_PROMPT },
    { role: "user", content: buildEnrichmentUserMessage(msgInput) },
  ];

  const modelDef = GROQ_ENRICHMENT_MODELS.find((m) => m.id === modelId);
  const isCompound = modelDef?.hasSearch ?? false;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const logs: SSELogEntry[] = [];

  function logEntry(event: SSELogEntry["event"], data: SSELogEntry["data"]) {
    const entry: SSELogEntry = { ts: new Date().toISOString(), event, data };
    logs.push(entry);
    onLog(entry);
  }

  // Agentic loop
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal?.aborted) throw new Error("Aborted");

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: 0,
      max_tokens: iter === 0 ? 2000 : 800,
    };

    // compound-beta handles search natively; for other models we just do text completion
    if (!isCompound) {
      body.max_tokens = 1200;
    }

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw Object.assign(new Error(errText), { status: res.status });
    }

    const data: GroqResponse = await res.json();
    const choice = data.choices[0];
    const usage = data.usage;

    if (usage) {
      totalInputTokens += usage.prompt_tokens;
      totalOutputTokens += usage.completion_tokens;
    }

    const { message } = choice;

    // Log assistant text chunks (reasoning / thinking)
    if (message.content) {
      // Only log non-trivial content (more than whitespace)
      const trimmed = message.content.trim();
      if (trimmed && !trimmed.startsWith("##JSON##")) {
        logEntry("think", { text: trimmed.slice(0, 500) });
      }
    }

    // Handle tool calls (compound-beta exposes search/fetch as tool_calls)
    if (message.tool_calls?.length) {
      messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });

      const toolResults: GroqMessage[] = [];
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }

        if (tc.function.name === "web_search") {
          const query = String(args.query ?? "");
          logEntry("search", { query });
          // For compound-beta, tool results are returned by the model itself
          // We just echo back an acknowledgement so the loop continues
          toolResults.push({
            role: "tool",
            content: `Search executed: ${query}`,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        } else if (tc.function.name === "web_fetch" || tc.function.name === "fetch") {
          const url = String(args.url ?? args.href ?? "");
          logEntry("fetch", { url });
          toolResults.push({
            role: "tool",
            content: `Fetch executed: ${url}`,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        } else {
          toolResults.push({
            role: "tool",
            content: "Tool executed.",
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }
      }

      messages.push(...toolResults);
      continue; // continue loop to get model's response after tool execution
    }

    // No tool calls — model returned its final answer
    const text = message.content ?? "";

    // Try to parse the result
    const result = extractCfoResult(text);

    if (result.nome) {
      logEntry("result", { text: `Found: ${result.nome} (${result.ruolo ?? "?"}) — ${result.confidenza ?? "?"}` });
    } else {
      logEntry("result", { text: "Not found" });
    }

    return {
      result,
      modelUsed: modelId,
      tokensInput: totalInputTokens,
      tokensOutput: totalOutputTokens,
      logs,
    };
  }

  // Exhausted max iterations without a clean stop
  logEntry("result", { text: "Max iterations reached without result" });
  return {
    result: { nome: null },
    modelUsed: modelId,
    tokensInput: totalInputTokens,
    tokensOutput: totalOutputTokens,
    logs,
  };
}

// ── Rate-limit detection ──────────────────────────────────────────────────────

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("throttle")) {
      return true;
    }
    const status = (err as Error & { status?: number }).status;
    if (status === 429) return true;
  }
  return false;
}
