"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  type ContactInput,
  type ContactResult,
  type LinkedinDoneEvent,
  type LinkedinMonitorMode,
  type LinkedinProgressEvent,
  type LinkedinStatus,
  connectToCloudLinkedinStream,
  connectToLinkedinStream,
  fetchLinkedinHistory,
  fetchLinkedinResults,
  fetchLinkedinStatus,
  reprocessLinkedinContacts,
  startLinkedinRun,
  stopLinkedinRun,
} from "@/lib/linkedin-enrichment-client";
import { loadCompanies } from "@/lib/data";
import { useFilters } from "@/lib/filter-context";
import type { Company } from "@/types";

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

const CONF_CLASS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-500 border-slate-200",
};

function ConfBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-300">&mdash;</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${CONF_CLASS[value] ?? ""}`}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card
      className={`transition-shadow hover:shadow-md ${
        accent
          ? "border-indigo-200 bg-indigo-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500 mb-1">
          {label}
        </p>
        <p
          className={`text-2xl font-bold tracking-tight tabular-nums ${
            accent ? "text-indigo-700" : "text-slate-900"
          }`}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pie colours
// ---------------------------------------------------------------------------

const PIE_COLORS: Record<string, string> = {
  high: "#10b981",
  medium: "#f59e0b",
  low: "#94a3b8",
  not_found: "#ef4444",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LinkedinMonitorPage() {
  // Config
  const { filters } = useFilters();
  const [mode, setMode] = useState<LinkedinMonitorMode>("cloud");
  const [concurrency, setConcurrency] = useState<number>(8);
  const [doReset, setDoReset] = useState(false);
  const cloudAbortRef = useRef<AbortController | null>(null);

  // Contact selection from DB
  const [dbCompanies, setDbCompanies] = useState<Company[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Runtime state
  const [status, setStatus] = useState<LinkedinStatus | null>(null);
  const [progress, setProgress] = useState<LinkedinProgressEvent | null>(null);
  const [liveResults, setLiveResults] = useState<ContactResult[]>([]);
  const [historyResults, setHistoryResults] = useState<ContactResult[]>([]);
  const [activeTab, setActiveTab] = useState<"live" | "history" | "select">(
    "select"
  );
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Import state
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // ------------------------------------------------------------------
  // Load companies without LinkedIn from DB
  // ------------------------------------------------------------------
  const loadContactsWithoutLinkedin = useCallback(async () => {
    setDbLoading(true);
    try {
      const companies = await loadCompanies(2026, filters.country);
      // Filter: has CFO name but no LinkedIn
      const withoutLinkedin = companies.filter(
        (c) => c.cfoNome && !c.cfoLinkedin
      );
      setDbCompanies(withoutLinkedin);
      setSelectedIds(new Set());
    } catch {
      setDbCompanies([]);
    } finally {
      setDbLoading(false);
    }
  }, [filters.country]);

  // ------------------------------------------------------------------
  // Boot: check server + load companies
  // ------------------------------------------------------------------
  useEffect(() => {
    if (mode === "local") {
      fetchLinkedinStatus()
        .then((s) => {
          setStatus(s);
          setServerOnline(true);
          if (s.completed > 0) {
            fetchLinkedinResults()
              .then((rs) => {
                if (rs.length > 0) {
                  setLiveResults(rs);
                  setActiveTab("live");
                }
              })
              .catch(() => {});
          }
          if (s.status === "running") attachStream();

          // Load history
          fetchLinkedinHistory()
            .then((h) => {
              if (h.length > 0) setHistoryResults(h);
            })
            .catch(() => {});
        })
        .catch(() => setServerOnline(false));
    } else {
      // Cloud mode — no Python server needed
      setServerOnline(null);
    }

    loadContactsWithoutLinkedin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadContactsWithoutLinkedin, mode]);

  // ------------------------------------------------------------------
  // SSE stream
  // ------------------------------------------------------------------
  const attachStream = useCallback(() => {
    esRef.current?.close();
    const es = connectToLinkedinStream({
      onProgress: (data: LinkedinProgressEvent) => {
        setProgress(data);
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                completed: data.completed,
                found: data.found,
                not_found: data.not_found,
                total_cost_usd: data.total_cost_usd,
                elapsed_s: data.elapsed_s,
                rate_limits: data.rate_limits,
              }
            : prev
        );
      },
      onContact: (data: ContactResult) => {
        setLiveResults((prev) => {
          const existingIdx = prev.findIndex((r) => r.id === data.id);
          if (existingIdx !== -1) {
            const next = [...prev];
            next[existingIdx] = data;
            return next;
          }
          return [data, ...prev];
        });
      },
      onDone: (data: LinkedinDoneEvent) => {
        setStatus((prev) =>
          prev
            ? { ...prev, status: data.cancelled ? "idle" : "completed" }
            : prev
        );
        esRef.current?.close();
        esRef.current = null;
        // Refresh history
        fetchLinkedinHistory()
          .then((h) => {
            if (h.length > 0) setHistoryResults(h);
          })
          .catch(() => {});
      },
      onError: (msg: string) => setErrorMsg(msg),
    });
    esRef.current = es;
  }, []);

  useEffect(() => () => {
    esRef.current?.close();
    cloudAbortRef.current?.abort();
  }, []);

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------
  const handleStart = async () => {
    setErrorMsg(null);
    setLiveResults([]);
    setActiveTab("live");

    const contacts: ContactInput[] = filteredDbCompanies
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({
        id: c.id,
        nome: c.cfoNome!,
        ruolo: c.cfoRuolo ?? undefined,
        azienda: c.azienda,
        sito_web: c.sitoWeb ?? undefined,
        data_origin: c.dataOrigin ?? "curated",
      }));

    if (contacts.length === 0) {
      setErrorMsg("No contacts selected");
      return;
    }

    if (mode === "local") {
      try {
        await startLinkedinRun({
          contacts,
          max_concurrency: concurrency,
          reset: doReset,
        });
        setStatus((prev) => (prev ? { ...prev, status: "running", total: contacts.length } : prev));
        attachStream();
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to start");
      }
    } else {
      // Cloud mode
      setStatus({
        status: "running",
        output_dir: "",
        total: contacts.length,
        completed: 0,
        found: 0,
        not_found: 0,
        rate_limits: 0,
        total_cost_usd: 0,
        elapsed_s: 0,
        error_message: null,
      });
      setProgress(null);

      const abort = new AbortController();
      cloudAbortRef.current = abort;

      connectToCloudLinkedinStream(
        { contacts, max_concurrency: concurrency },
        {
          onProgress: (data: LinkedinProgressEvent) => {
            setProgress(data);
            setStatus((prev) =>
              prev
                ? {
                    ...prev,
                    completed: data.completed,
                    found: data.found,
                    not_found: data.not_found,
                    total_cost_usd: data.total_cost_usd,
                    elapsed_s: data.elapsed_s,
                    rate_limits: data.rate_limits,
                  }
                : prev
            );
          },
          onContact: (data: ContactResult) => {
            setLiveResults((prev) => {
              const existingIdx = prev.findIndex((r) => r.id === data.id);
              if (existingIdx !== -1) {
                const next = [...prev];
                next[existingIdx] = data;
                return next;
              }
              return [data, ...prev];
            });
          },
          onDone: (data: LinkedinDoneEvent) => {
            setStatus((prev) =>
              prev
                ? { ...prev, status: data.cancelled ? "idle" : "completed" }
                : prev
            );
            cloudAbortRef.current = null;
          },
          onError: (msg: string) => setErrorMsg(msg),
        },
        abort.signal,
      );
    }
  };

  const handleStop = async () => {
    if (mode === "local") {
      try {
        await stopLinkedinRun();
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : "Failed to stop");
      }
    } else {
      cloudAbortRef.current?.abort();
      cloudAbortRef.current = null;
      setStatus((prev) => (prev ? { ...prev, status: "idle" } : prev));
    }
  };

  // ------------------------------------------------------------------
  // Import LinkedIn results to DB
  // ------------------------------------------------------------------
  const handleImport = async (targets: ContactResult[]) => {
    const withUrl = targets.filter((r) => r.linkedin_url);
    if (withUrl.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/linkedin-monitor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: withUrl.map((r) => ({ id: r.id, linkedin_url: r.linkedin_url })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Import failed: ${res.status}`);
      }
      const data = (await res.json()) as { updated: number };
      setImportMsg(`Saved ${data.updated} LinkedIn URLs to DB`);
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // ------------------------------------------------------------------
  // Result selection helpers
  // ------------------------------------------------------------------
  const toggleResultSelect = (id: string) => {
    setSelectedResultIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAllResults = () => {
    const withUrl = displayedResults.filter((r) => r.linkedin_url);
    if (selectedResultIds.size === withUrl.length) {
      setSelectedResultIds(new Set());
    } else {
      setSelectedResultIds(new Set(withUrl.map((r) => r.id)));
    }
  };

  // ------------------------------------------------------------------
  // Selection helpers
  // ------------------------------------------------------------------
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredDbCompanies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDbCompanies.map((c) => c.id)));
    }
  };

  // ------------------------------------------------------------------
  // Derived values
  // ------------------------------------------------------------------
  const isRunning = status?.status === "running";
  const completed = progress?.completed ?? status?.completed ?? 0;
  const total = status?.total ?? 0;
  const found = progress?.found ?? status?.found ?? 0;
  const notFound = progress?.not_found ?? status?.not_found ?? 0;
  const elapsed = progress?.elapsed_s ?? status?.elapsed_s ?? 0;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const foundPct = completed > 0 ? Math.round((found / completed) * 100) : 0;
  const eta =
    isRunning && completed > 0 && elapsed > 0
      ? Math.round(((total - completed) * elapsed) / completed)
      : null;

  // Exclude contacts already processed (in history or live) without a LinkedIn URL found
  const alreadySearchedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of historyResults) {
      if (!r.linkedin_url) ids.add(r.id);
    }
    for (const r of liveResults) {
      if (!r.linkedin_url) ids.add(r.id);
    }
    return ids;
  }, [historyResults, liveResults]);

  const filteredDbCompanies = useMemo(
    () => dbCompanies.filter((c) => !alreadySearchedIds.has(c.id)),
    [dbCompanies, alreadySearchedIds]
  );

  const displayedResults = activeTab === "live" ? liveResults : historyResults;
  const importableResults = displayedResults.filter((r) => r.linkedin_url);
  const selectedImportResults = importableResults.filter((r) => selectedResultIds.has(r.id));
  const allResultsSelected = importableResults.length > 0 && selectedResultIds.size === importableResults.length;
  const someResultsSelected = selectedResultIds.size > 0 && !allResultsSelected;

  const pieData = useMemo(
    () =>
      [
        {
          name: "High",
          value: displayedResults.filter((r) => r.confidenza === "high").length,
          key: "high",
        },
        {
          name: "Medium",
          value: displayedResults.filter((r) => r.confidenza === "medium")
            .length,
          key: "medium",
        },
        {
          name: "Low",
          value: displayedResults.filter((r) => r.confidenza === "low").length,
          key: "low",
        },
        {
          name: "Not found",
          value: displayedResults.filter((r) => !r.linkedin_url).length,
          key: "not_found",
        },
      ].filter((d) => d.value > 0),
    [displayedResults]
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">
          LinkedIn Enricher Monitor
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Find LinkedIn profiles for contacts missing LinkedIn URLs &mdash;
          {mode === "cloud" ? " powered by Groq" : " powered by Claude Agent"}
        </p>
      </div>

      {/* Server offline banner (local mode only) */}
      {mode === "local" && serverOnline === false && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Monitor server is offline. Run{" "}
          <code className="font-mono bg-red-100 rounded px-1 py-0.5">
            ./start.sh
          </code>{" "}
          inside{" "}
          <code className="font-mono bg-red-100 rounded px-1 py-0.5">
            linkedin-enricher/
          </code>
          , then reload this page.
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Run Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Mode toggle */}
            <div className="w-48">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Mode
              </label>
              <div className="flex rounded-md border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setMode("cloud")}
                  disabled={isRunning}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    mode === "cloud"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  Cloud (Groq)
                </button>
                <button
                  onClick={() => setMode("local")}
                  disabled={isRunning}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    mode === "local"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  Local (Claude)
                </button>
              </div>
            </div>

            {/* Contacts count */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Contacts to process
              </label>
              <div className="h-9 flex items-center px-3 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-700">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `${filteredDbCompanies.length} available without LinkedIn`}
              </div>
            </div>

            {/* Concurrency slider */}
            <div className="w-44">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Concurrency:{" "}
                <span className="text-slate-900 font-semibold">
                  {concurrency}
                </span>
              </label>
              <Slider
                min={1}
                max={16}
                step={1}
                value={[concurrency]}
                onValueChange={([v]) => setConcurrency(v)}
                disabled={isRunning}
              />
            </div>

            {/* Reset checkbox (local mode only — cloud has no checkpoint) */}
            {mode === "local" && (
              <div className="flex items-center gap-2 pb-1">
                <input
                  id="reset-chk"
                  type="checkbox"
                  checked={doReset}
                  onChange={(e) => setDoReset(e.target.checked)}
                  disabled={isRunning}
                  className="rounded border-slate-300 accent-indigo-600"
                />
                <label
                  htmlFor="reset-chk"
                  className="text-xs text-slate-500 cursor-pointer select-none"
                >
                  Reset checkpoint
                </label>
              </div>
            )}

            {/* Start / Stop */}
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={
                  selectedIds.size === 0 ||
                  (mode === "local" && serverOnline === false)
                }
                className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Start Run ({selectedIds.size})
              </Button>
            ) : (
              <Button
                onClick={handleStop}
                variant="destructive"
                className="h-9"
              >
                Stop
              </Button>
            )}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>
                  {completed} / {total} contacts
                </span>
                <span>
                  {pct}%{eta != null && ` — ETA ~${eta}s`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {status?.status === "completed" && (
                <p className="text-xs text-emerald-600 font-medium">
                  Run completed successfully.
                </p>
              )}
              {status?.status === "error" && (
                <p className="text-xs text-red-600">{status.error_message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI cards */}
      {completed > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Processed"
            value={`${completed}/${total}`}
            sub={`${pct}% complete`}
          />
          <KpiCard
            label="LinkedIn Found"
            value={`${foundPct}%`}
            sub={`${found} found · ${notFound} not found`}
            accent
          />
          <KpiCard
            label="Cost"
            value={`$${(progress?.total_cost_usd ?? status?.total_cost_usd ?? 0).toFixed(4)}`}
            sub={
              completed > 0
                ? `$${((progress?.total_cost_usd ?? status?.total_cost_usd ?? 0) / completed).toFixed(4)}/contact`
                : undefined
            }
          />
          <KpiCard
            label="Elapsed"
            value={`${elapsed.toFixed(0)}s`}
            sub={isRunning ? "running…" : (status?.status ?? "")}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tabs: Select / Live / History                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <Card className="border-slate-200 bg-white">
            {/* Tab bar */}
            <div className="flex items-center border-b border-slate-200 px-4">
              {(["select", "live", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-3 px-3 text-xs font-medium border-b-2 transition-colors capitalize flex items-center gap-1.5 ${
                    activeTab === tab
                      ? "border-indigo-500 text-indigo-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab === "live" && isRunning && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  {tab === "select"
                    ? "Select Contacts"
                    : tab === "history"
                      ? "History"
                      : "Live"}
                  <span className="tabular-nums opacity-60">
                    {tab === "select"
                      ? filteredDbCompanies.length
                      : tab === "history"
                        ? historyResults.length
                        : liveResults.length}
                  </span>
                </button>
              ))}

              <div className="ml-auto flex items-center gap-2">
                {activeTab === "select" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadContactsWithoutLinkedin}
                    disabled={dbLoading}
                    className="text-xs h-7"
                  >
                    {dbLoading ? "Loading…" : "Refresh"}
                  </Button>
                )}
                {activeTab !== "select" && importableResults.length > 0 && (
                  <>
                    {selectedImportResults.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                        disabled={importing}
                        onClick={() => handleImport(selectedImportResults)}
                      >
                        {importing ? "Saving…" : `Save Selected (${selectedImportResults.length})`}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
                      disabled={importing}
                      onClick={() => handleImport(importableResults)}
                    >
                      {importing ? "Saving…" : `Save All (${importableResults.length})`}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {importMsg && (
              <p className={`text-xs px-4 pt-2 ${importMsg.includes("failed") || importMsg.includes("Failed") ? "text-red-600" : "text-emerald-600"}`}>
                {importMsg}
              </p>
            )}

            {/* Tab content */}
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              {activeTab === "select" ? (
                /* Select contacts table */
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            filteredDbCompanies.length > 0 &&
                            selectedIds.size === filteredDbCompanies.length
                          }
                          onChange={selectAll}
                          className="rounded border-slate-300 accent-indigo-600"
                        />
                      </th>
                      <th className="px-4 py-2">Contact</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Company</th>
                      <th className="px-4 py-2">Website</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDbCompanies.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleSelect(c.id)}
                            className="rounded border-slate-300 accent-indigo-600"
                          />
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-800">
                          {c.cfoNome}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {c.cfoRuolo || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {c.azienda}
                        </td>
                        <td className="px-4 py-2 text-slate-400 text-xs truncate max-w-[200px]">
                          {c.sitoWeb || "—"}
                        </td>
                      </tr>
                    ))}
                    {filteredDbCompanies.length === 0 && !dbLoading && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-slate-400 text-sm"
                        >
                          No contacts without LinkedIn found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                /* Live / History results table */
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={allResultsSelected}
                          ref={(el) => { if (el) el.indeterminate = someResultsSelected; }}
                          onChange={toggleSelectAllResults}
                          className="rounded border-slate-300 accent-indigo-600"
                        />
                      </th>
                      <th className="px-4 py-2">Contact</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Company</th>
                      <th className="px-4 py-2">LinkedIn</th>
                      <th className="px-4 py-2">Confidence</th>
                      <th className="px-4 py-2 text-right">Tokens</th>
                      <th className="px-4 py-2 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedResults.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedResultIds.has(r.id)}
                            onChange={() => toggleResultSelect(r.id)}
                            disabled={!r.linkedin_url}
                            className="rounded border-slate-300 accent-indigo-600"
                          />
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-800">
                          {r.nome}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {r.ruolo || "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-700">
                          {r.azienda}
                        </td>
                        <td className="px-4 py-2">
                          {r.linkedin_url ? (
                            <a
                              href={r.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 text-xs truncate block max-w-[200px]"
                            >
                              {r.linkedin_url
                                .replace("https://www.linkedin.com/in/", "")
                                .replace(/\/$/, "")}
                            </a>
                          ) : (
                            <span className="text-slate-300">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <ConfBadge value={r.confidenza} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">
                          {r.input_tokens != null
                            ? `${((r.input_tokens + (r.output_tokens ?? 0)) / 1000).toFixed(1)}k`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">
                          {r.elapsed_s > 0 ? `${r.elapsed_s.toFixed(1)}s` : "—"}
                        </td>
                      </tr>
                    ))}
                    {displayedResults.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-slate-400 text-sm"
                        >
                          {activeTab === "live"
                            ? "No results yet. Start a run to see live results."
                            : "No history available."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>

        {/* Side panel: pie chart */}
        {displayedResults.length > 0 && activeTab !== "select" && (
          <div className="space-y-4">
            <Card className="border-slate-200 bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Confidence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {pieData.map((d) => (
                        <Cell
                          key={d.key}
                          fill={PIE_COLORS[d.key] ?? "#e2e8f0"}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 mt-2 justify-center text-xs text-slate-600">
                  {pieData.map((d) => (
                    <div key={d.key} className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[d.key] }}
                      />
                      {d.name}: {d.value}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
