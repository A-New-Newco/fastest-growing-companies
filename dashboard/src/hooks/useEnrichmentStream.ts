"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  EnrichmentSession,
  EnrichmentSessionCompany,
  SSELog,
  SSECompanyDone,
  SSESessionProgress,
  SSESessionStart,
  SSECompanyStart,
} from "@/types";

// ── State ──────────────────────────────────────────────────────────────────────

export interface StreamState {
  session: EnrichmentSession | null;
  companies: EnrichmentSessionCompany[];
  isConnected: boolean;
  isComplete: boolean;
  progress: {
    completed: number;
    total: number;
    found: number;
    failed: number;
    tokensTotal: number;
  } | null;
  error: string | null;
}

type StreamAction =
  | { type: "SET_SESSION"; session: EnrichmentSession }
  | { type: "SET_COMPANIES"; companies: EnrichmentSessionCompany[] }
  | { type: "SET_CONNECTED"; value: boolean }
  | { type: "SET_COMPLETE" }
  | { type: "COMPANY_START"; data: SSECompanyStart }
  | { type: "COMPANY_LOG"; data: SSELog }
  | { type: "COMPANY_DONE"; data: SSECompanyDone }
  | { type: "SESSION_PROGRESS"; data: SSESessionProgress }
  | { type: "SET_ERROR"; message: string }
  | { type: "CLEAR_ERROR" };

function reducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "SET_SESSION":
      return { ...state, session: action.session };
    case "SET_COMPANIES":
      return { ...state, companies: action.companies };
    case "SET_CONNECTED":
      return { ...state, isConnected: action.value };
    case "SET_COMPLETE":
      return { ...state, isConnected: false, isComplete: true };
    case "COMPANY_START":
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.id === action.data.companyRowId
            ? { ...c, status: "running", modelUsed: action.data.model }
            : c
        ),
      };
    case "COMPANY_LOG":
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.id === action.data.companyRowId
            ? { ...c, logs: [...c.logs, action.data.entry].slice(-200) }
            : c
        ),
      };
    case "COMPANY_DONE": {
      const d = action.data;
      return {
        ...state,
        companies: state.companies.map((c) =>
          c.id === d.companyRowId
            ? {
                ...c,
                status: d.status,
                resultNome: d.result?.nome ?? null,
                resultRuolo: d.result?.ruolo ?? null,
                resultLinkedin: d.result?.linkedin ?? null,
                resultConfidenza: d.result?.confidenza ?? null,
                tokensInput: d.tokensInput,
                tokensOutput: d.tokensOutput,
                modelUsed: d.modelUsed,
                errorMessage: d.errorMessage ?? null,
              }
            : c
        ),
      };
    }
    case "SESSION_PROGRESS": {
      const p = action.data;
      return {
        ...state,
        progress: {
          completed: p.completed,
          total: p.total,
          found: p.found,
          failed: p.failed,
          tokensTotal: p.tokensTotal,
        },
        session: state.session
          ? {
              ...state.session,
              completedCount: p.completed,
              foundCount: p.found,
              failedCount: p.failed,
              tokensTotal: p.tokensTotal,
            }
          : state.session,
      };
    }
    case "SET_ERROR":
      return { ...state, error: action.message };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

const initialState: StreamState = {
  session: null,
  companies: [],
  isConnected: false,
  isComplete: false,
  progress: null,
  error: null,
};

// ── Hook ───────────────────────────────────────────────────────────────────────

interface UseEnrichmentStreamOptions {
  sessionId: string;
  initialSession: EnrichmentSession;
  initialCompanies: EnrichmentSessionCompany[];
}

export function useEnrichmentStream({
  sessionId,
  initialSession,
  initialCompanies,
}: UseEnrichmentStreamOptions) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    session: initialSession,
    companies: initialCompanies,
    isComplete: initialSession.status === "completed",
  });

  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT = 3;

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    dispatch({ type: "SET_CONNECTED", value: true });
    dispatch({ type: "CLEAR_ERROR" });

    const es = new EventSource(`/api/enrichment-sessions/${sessionId}/stream`);
    esRef.current = es;

    es.addEventListener("session_start", (e) => {
      const data: SSESessionStart = JSON.parse(e.data);
      dispatch({ type: "SESSION_PROGRESS", data: {
        completed: data.resumedAt,
        total: data.totalCompanies,
        found: state.session?.foundCount ?? 0,
        failed: state.session?.failedCount ?? 0,
        tokensTotal: state.session?.tokensTotal ?? 0,
      }});
    });

    es.addEventListener("company_start", (e) => {
      const data: SSECompanyStart = JSON.parse(e.data);
      dispatch({ type: "COMPANY_START", data });
    });

    es.addEventListener("log", (e) => {
      const data: SSELog = JSON.parse(e.data);
      dispatch({ type: "COMPANY_LOG", data });
    });

    es.addEventListener("company_done", (e) => {
      const data: SSECompanyDone = JSON.parse(e.data);
      dispatch({ type: "COMPANY_DONE", data });
    });

    es.addEventListener("session_progress", (e) => {
      const data: SSESessionProgress = JSON.parse(e.data);
      dispatch({ type: "SESSION_PROGRESS", data });
    });

    es.addEventListener("session_complete", () => {
      es.close();
      esRef.current = null;
      reconnectAttemptsRef.current = 0;
      dispatch({ type: "SET_COMPLETE" });
    });

    es.addEventListener("session_paused", () => {
      es.close();
      esRef.current = null;
      dispatch({ type: "SET_CONNECTED", value: false });
    });

    es.addEventListener("error", (e) => {
      dispatch({ type: "SET_ERROR", message: "Stream error: " + JSON.stringify(e) });
      es.close();
      esRef.current = null;
      dispatch({ type: "SET_CONNECTED", value: false });

      // Auto-reconnect with exponential backoff (max 3 attempts)
      if (reconnectAttemptsRef.current < MAX_RECONNECT) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(2000 * 2 ** (reconnectAttemptsRef.current - 1), 30_000);
        setTimeout(() => connect(), delay);
      }
    });
  }, [sessionId, state.session?.foundCount, state.session?.failedCount, state.session?.tokensTotal]);

  const start = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  const pause = useCallback(async () => {
    // Close the SSE connection — server detects disconnect and marks session paused
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    dispatch({ type: "SET_CONNECTED", value: false });

    // Also explicitly PATCH to ensure DB state is correct
    try {
      await fetch(`/api/enrichment-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (state.session) {
        dispatch({ type: "SET_SESSION", session: { ...state.session, status: "paused" } });
      }
    } catch { /* ignore */ }
  }, [sessionId, state.session]);

  return { state, start, pause };
}
