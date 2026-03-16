"use client";

import { useReducer, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X, Check, Cloud, Monitor } from "lucide-react";
import { ALL_COUNTRIES_VALUE, normalizeCountryCode } from "@/lib/constants";
import { useFilters } from "@/lib/filter-context";
import type { EnrichmentSession, EnrichmentMode } from "@/types";

// ── State ──────────────────────────────────────────────────────────────────────

interface CompanyRow {
  id: string;
  azienda: string;
  country: string;
  sitoWeb: string | null;
  selected: boolean;
}

const WORKER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const DEFAULT_WORKERS = 3;

interface State {
  step: 1 | 2;
  name: string;
  enrichmentMode: EnrichmentMode;
  numWorkers: number;
  searchQuery: string;
  results: CompanyRow[];
  selected: CompanyRow[];
  loadingSearch: boolean;
  saving: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_NAME"; value: string }
  | { type: "SET_MODE"; value: EnrichmentMode }
  | { type: "SET_WORKERS"; value: number }
  | { type: "SET_STEP"; step: 1 | 2 }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_RESULTS"; results: CompanyRow[] }
  | { type: "TOGGLE_RESULT"; id: string }
  | { type: "REMOVE_SELECTED"; id: string }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_SAVING"; value: boolean }
  | { type: "SET_ERROR"; value: string | null }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_NAME": return { ...state, name: action.value };
    case "SET_MODE": return { ...state, enrichmentMode: action.value };
    case "SET_WORKERS": return { ...state, numWorkers: action.value };
    case "SET_STEP": return { ...state, step: action.step };
    case "SET_SEARCH": return { ...state, searchQuery: action.value };
    case "SET_RESULTS": return { ...state, results: action.results, loadingSearch: false };
    case "TOGGLE_RESULT": {
      const inSelected = state.selected.some((c) => c.id === action.id);
      if (inSelected) {
        return { ...state, selected: state.selected.filter((c) => c.id !== action.id) };
      }
      const row = state.results.find((c) => c.id === action.id);
      if (!row) return state;
      return { ...state, selected: [...state.selected, row] };
    }
    case "REMOVE_SELECTED": return { ...state, selected: state.selected.filter((c) => c.id !== action.id) };
    case "SET_LOADING": return { ...state, loadingSearch: action.value };
    case "SET_SAVING": return { ...state, saving: action.value };
    case "SET_ERROR": return { ...state, error: action.value };
    case "RESET": return initialState;
  }
}

const initialState: State = {
  step: 1,
  name: "",
  enrichmentMode: "remote",
  numWorkers: DEFAULT_WORKERS,
  searchQuery: "",
  results: [],
  selected: [],
  loadingSearch: false,
  saving: false,
  error: null,
};

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (session: EnrichmentSession) => void;
}

export default function CreateSessionModal({ open, onClose, onCreated }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { filters } = useFilters();

  const fetchCompanies = useCallback(async (q: string) => {
    dispatch({ type: "SET_LOADING", value: true });
    try {
      const params = new URLSearchParams({ search: q, limit: "30" });
      if (filters.country !== ALL_COUNTRIES_VALUE) {
        params.set("country", normalizeCountryCode(filters.country));
      }
      const res = await fetch(`/api/companies/search?${params}`);
      if (!res.ok) throw new Error("Search failed");
      const data: Array<{
        id: string;
        azienda: string;
        country: string;
        sito_web: string | null;
      }> = await res.json();
      dispatch({
        type: "SET_RESULTS",
        results: data.map((c) => ({
          id: c.id,
          azienda: c.azienda,
          country: c.country ?? "IT",
          sitoWeb: c.sito_web ?? null,
          selected: false,
        })),
      });
    } catch {
      dispatch({ type: "SET_LOADING", value: false });
    }
  }, [filters.country]);

  useEffect(() => {
    if (state.step === 2) {
      const t = setTimeout(() => fetchCompanies(state.searchQuery), 300);
      return () => clearTimeout(t);
    }
  }, [state.searchQuery, state.step, fetchCompanies]);

  useEffect(() => {
    if (state.step === 2 && state.results.length === 0 && !state.loadingSearch) {
      fetchCompanies("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  async function handleCreate() {
    if (!state.name.trim() || state.selected.length === 0) return;
    dispatch({ type: "SET_SAVING", value: true });
    dispatch({ type: "SET_ERROR", value: null });
    try {
      const res = await fetch("/api/enrichment-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          companies: state.selected.map((c) => ({
            companyId: c.id,
            companyOrigin: "curated",
            companyName: c.azienda,
            companyWebsite: c.sitoWeb,
            companyCountry: c.country,
          })),
          modelConfig: {
            enrichmentMode: state.enrichmentMode,
            ...(state.enrichmentMode === "remote"
              ? {
                  models: ["compound-beta", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
                  current_model_index: 0,
                }
              : {
                  models: [],
                  current_model_index: 0,
                }),
            numWorkers: state.numWorkers,
          },
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create session");
      }
      const session: EnrichmentSession = await res.json();
      onCreated(session);
      handleClose();
    } catch (err) {
      dispatch({ type: "SET_ERROR", value: err instanceof Error ? err.message : "Unknown error" });
      dispatch({ type: "SET_SAVING", value: false });
    }
  }

  function handleClose() {
    dispatch({ type: "RESET" });
    onClose();
  }

  const selectedIds = new Set(state.selected.map((c) => c.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            New Enrichment Session
            {state.step === 2 && (
              <span className="ml-2 text-sm font-normal text-slate-400">— Add Companies</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: name + workers */}
        {state.step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Session Name
              </label>
              <Input
                placeholder="e.g. CFO Enrichment — DE 2026"
                value={state.name}
                onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && state.name.trim() && dispatch({ type: "SET_STEP", step: 2 })}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Enrichment Engine
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_MODE", value: "remote" })}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    state.enrichmentMode === "remote"
                      ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <Cloud className={`w-4 h-4 shrink-0 ${state.enrichmentMode === "remote" ? "text-indigo-600" : "text-slate-400"}`} />
                  <div>
                    <p className={`text-sm font-medium ${state.enrichmentMode === "remote" ? "text-indigo-700" : "text-slate-700"}`}>
                      Cloud
                    </p>
                    <p className="text-xs text-slate-400">Groq API</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "SET_MODE", value: "local" })}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    state.enrichmentMode === "local"
                      ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <Monitor className={`w-4 h-4 shrink-0 ${state.enrichmentMode === "local" ? "text-indigo-600" : "text-slate-400"}`} />
                  <div>
                    <p className={`text-sm font-medium ${state.enrichmentMode === "local" ? "text-indigo-700" : "text-slate-700"}`}>
                      Local
                    </p>
                    <p className="text-xs text-slate-400">Claude Agent</p>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                  Parallel Workers
                </label>
                <span className="text-xs text-slate-400">
                  {state.numWorkers === 1 ? "sequential" : state.numWorkers <= 3 ? "safe" : state.numWorkers <= 5 ? "moderate" : "aggressive"}
                </span>
              </div>
              <div className="flex gap-1">
                {WORKER_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => dispatch({ type: "SET_WORKERS", value: n })}
                    className={`flex-1 rounded py-1.5 text-xs font-medium transition-colors ${
                      state.numWorkers === n
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                {state.enrichmentMode === "remote"
                  ? "compound-beta is limited to 30 req/min — keep \u2264 5 to avoid rate limits"
                  : "Claude agent concurrency — higher values process faster"}
              </p>
            </div>

            <p className="text-xs text-slate-500">
              You&apos;ll select companies in the next step.
            </p>
            {state.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
            )}
          </div>
        )}

        {/* Step 2: company selector */}
        {state.step === 2 && (
          <div className="space-y-3 py-2">
            {/* Selected chips */}
            {state.selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto p-2 bg-indigo-50 rounded-md border border-indigo-100">
                {state.selected.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-white border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700"
                  >
                    {c.azienda}
                    <button
                      onClick={() => dispatch({ type: "REMOVE_SELECTED", id: c.id })}
                      className="text-indigo-400 hover:text-indigo-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <Input
                className="pl-8 text-sm"
                placeholder="Search companies…"
                value={state.searchQuery}
                onChange={(e) => dispatch({ type: "SET_SEARCH", value: e.target.value })}
                autoFocus
              />
            </div>

            {/* Results list */}
            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
              {state.loadingSearch && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                </div>
              )}
              {!state.loadingSearch && state.results.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">No companies found</p>
              )}
              {!state.loadingSearch && state.results.map((c) => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => dispatch({ type: "TOGGLE_RESULT", id: c.id })}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50 transition-colors ${
                      isSelected ? "bg-indigo-50" : ""
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.azienda}</p>
                      <p className="text-xs text-slate-400">{c.country}</p>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-slate-500">
              {state.selected.length} compan{state.selected.length === 1 ? "y" : "ies"} selected
            </p>

            {state.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {state.step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => dispatch({ type: "SET_STEP", step: 2 })}
                disabled={!state.name.trim()}
              >
                Next: Add Companies
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => dispatch({ type: "SET_STEP", step: 1 })} disabled={state.saving}>
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={state.selected.length === 0 || state.saving}
              >
                {state.saving ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creating…</>
                ) : (
                  `Create Session (${state.selected.length})`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
