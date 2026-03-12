"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import CompanyDetailModal from "./CompanyDetailModal";
import {
  type CompanyResult,
  type Dataset,
  type DoneEvent,
  type EnrichmentStatus,
  type ProgressEvent,
  connectToEnrichmentStream,
  fetchDatasets,
  fetchResults,
  fetchStatus,
  reprocessCompanies,
  startRun,
  stopRun,
} from "@/lib/enrichment-client";
import LinkedInSearchModal from "@/components/linkedin/LinkedInSearchModal";

// ---------------------------------------------------------------------------
// localStorage helpers (SSR-safe)
// ---------------------------------------------------------------------------

function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

function lsSet(key: string, val: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, val);
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

const CONF_CLASS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-500 border-slate-200",
};

function ConfBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>;
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

export default function CfoMonitorPage() {
  // Config — persisted in localStorage
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [concurrency, setConcurrency] = useState<number>(8);
  const [doReset, setDoReset] = useState(false);

  // Runtime state
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [tokenHistory, setTokenHistory] = useState<{ n: number; tokens: number }[]>([]);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Action states
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [reprocessingRanks, setReprocessingRanks] = useState<Set<number>>(new Set());
  const reprocessingBulk = reprocessingRanks.size > 0;

  // LinkedIn fast-search state
  const [liSearchingRanks, setLiSearchingRanks] = useState<Set<number>>(new Set());
  const [liRowResult, setLiRowResult] = useState<Record<number, "found" | "not_found">>({});
  const [liSearchModalOpen, setLiSearchModalOpen] = useState(false);

  // Detail modal
  const [detailCompany, setDetailCompany] = useState<CompanyResult | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // ------------------------------------------------------------------
  // Persist config changes
  // ------------------------------------------------------------------
  const handleDatasetChange = (val: string) => {
    setSelectedDataset(val);
    lsSet("cfo-monitor:dataset", val);
  };
  const handleConcurrencyChange = ([v]: number[]) => {
    setConcurrency(v);
    lsSet("cfo-monitor:concurrency", String(v));
  };

  // ------------------------------------------------------------------
  // Boot: load datasets + current status + existing results
  // ------------------------------------------------------------------
  useEffect(() => {
    // Restore persisted config (client-only, safe after hydration)
    const savedDs = lsGet("cfo-monitor:dataset");
    const savedConc = lsGet("cfo-monitor:concurrency");
    if (savedDs) setSelectedDataset(savedDs);
    if (savedConc) setConcurrency(Number(savedConc) || 8);

    fetchDatasets()
      .then((ds) => {
        setDatasets(ds);
        // Pre-select first dataset if nothing is saved yet
        if (!lsGet("cfo-monitor:dataset") && ds.length > 0) {
          setSelectedDataset(ds[0].id);
          lsSet("cfo-monitor:dataset", ds[0].id);
        }
        setServerOnline(true);
      })
      .catch(() => setServerOnline(false));

    fetchStatus()
      .then((s) => {
        setStatus(s);
        if (s.completed > 0) {
          // Restore results from in-memory server state
          fetchResults()
            .then((rs) => {
              setResults(rs.slice().reverse()); // newest first
              // Rebuild token history
              let runningTok = 0;
              const history: { n: number; tokens: number }[] = [];
              [...rs].forEach((r, i) => {
                const tok = (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
                if (tok > 0) {
                  runningTok += tok;
                  history.push({ n: i + 1, tokens: runningTok });
                }
              });
              setTokenHistory(history);
            })
            .catch(() => {});
        }
        if (s.status === "running") attachStream();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // SSE — direct connection to bypass Next.js proxy buffering
  // ------------------------------------------------------------------
  const attachStream = useCallback(() => {
    esRef.current?.close();
    const es = connectToEnrichmentStream({
      onProgress: (data: ProgressEvent) => {
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
      onCompany: (data: CompanyResult) => {
        setResults((prev) => {
          // For reprocess events: update existing row in-place
          if (data.is_reprocess) {
            return prev.map((r) => (r.rank === data.rank ? { ...r, cfo_linkedin: data.cfo_linkedin } : r));
          }
          return [data, ...prev];
        });
        if (!data.is_reprocess) {
          const tok = (data.input_tokens ?? 0) + (data.output_tokens ?? 0);
          if (tok > 0) {
            setTokenHistory((prev) => {
              const running = (prev[prev.length - 1]?.tokens ?? 0) + tok;
              return [...prev, { n: prev.length + 1, tokens: running }];
            });
          }
        }
      },
      onDone: (data: DoneEvent) => {
        setStatus((prev) =>
          prev ? { ...prev, status: data.cancelled ? "idle" : "completed" } : prev
        );
        esRef.current?.close();
        esRef.current = null;
      },
      onError: (msg: string) => setErrorMsg(msg),
    });
    esRef.current = es;
  }, []);

  // Cleanup on unmount
  useEffect(() => () => esRef.current?.close(), []);

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------
  const handleStart = async () => {
    setErrorMsg(null);
    setImportMsg(null);
    setResults([]);
    setTokenHistory([]);
    setSelected(new Set());
    try {
      await startRun({
        dataset_id: selectedDataset || undefined,
        max_concurrency: concurrency,
        reset: doReset,
      });
      setStatus((prev) => (prev ? { ...prev, status: "running" } : prev));
      attachStream();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start");
    }
  };

  const handleStop = async () => {
    try {
      await stopRun();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to stop");
    }
  };

  // ------------------------------------------------------------------
  // Selection helpers
  // ------------------------------------------------------------------
  const toggleSelect = (rank: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(rank) ? next.delete(rank) : next.add(rank);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((r) => r.rank)));
    }
  };

  // ------------------------------------------------------------------
  // Import to DB
  // ------------------------------------------------------------------
  const handleImport = async (targets: CompanyResult[]) => {
    if (!targets.length || !status) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/cfo-monitor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: status.dataset_id,
          country_code: status.country_code,
          year: status.year,
          companies: targets,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Import failed: ${res.status}`);
      }
      const data = await res.json() as { updated: number };
      setImportMsg(`Updated ${data.updated} companies in DB`);
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // ------------------------------------------------------------------
  // Re-process LinkedIn
  // ------------------------------------------------------------------
  // Bulk reprocess (selected rows without LinkedIn)
  const handleReprocessBulk = async () => {
    const targets = results.filter(
      (r) => selected.has(r.rank) && r.cfo_nome && !r.cfo_linkedin
    );
    if (!targets.length) return;
    const ranks = new Set(targets.map((r) => r.rank));
    setReprocessingRanks((prev) => new Set([...prev, ...ranks]));
    setErrorMsg(null);
    try {
      await reprocessCompanies(targets);
      attachStream();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Reprocess failed");
    } finally {
      setReprocessingRanks((prev) => {
        const next = new Set(prev);
        ranks.forEach((r) => next.delete(r));
        return next;
      });
    }
  };

  // Per-row reprocess (single company)
  const handleReprocessOne = async (r: CompanyResult) => {
    if (!r.cfo_nome || reprocessingRanks.has(r.rank)) return;
    setReprocessingRanks((prev) => new Set([...prev, r.rank]));
    setErrorMsg(null);
    try {
      await reprocessCompanies([r]);
      attachStream();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Reprocess failed");
      setReprocessingRanks((prev) => { const next = new Set(prev); next.delete(r.rank); return next; });
    }
  };

  // ------------------------------------------------------------------
  // LinkedIn fast search (single row — no DB save, update in-memory only)
  // ------------------------------------------------------------------
  const handleLiSearchOne = async (r: CompanyResult) => {
    if (!r.cfo_nome || liSearchingRanks.has(r.rank)) return;
    setLiSearchingRanks((prev) => new Set([...prev, r.rank]));
    try {
      const res = await fetch("/api/linkedin-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: r.azienda,
          contactName: r.cfo_nome,
          // No companyId — skip DB save; the user will import results separately
        }),
      });
      const data = await res.json();
      if (res.ok && data.found) {
        setResults((prev) =>
          prev.map((row) => row.rank === r.rank ? { ...row, cfo_linkedin: data.linkedinUrl } : row)
        );
        setLiRowResult((prev) => ({ ...prev, [r.rank]: "found" }));
        setTimeout(() => setLiRowResult((prev) => { const n = { ...prev }; delete n[r.rank]; return n; }), 3000);
      } else {
        setLiRowResult((prev) => ({ ...prev, [r.rank]: "not_found" }));
        setTimeout(() => setLiRowResult((prev) => { const n = { ...prev }; delete n[r.rank]; return n; }), 3000);
      }
    } catch {
      setLiRowResult((prev) => ({ ...prev, [r.rank]: "not_found" }));
    } finally {
      setLiSearchingRanks((prev) => { const n = new Set(prev); n.delete(r.rank); return n; });
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
  const avgTokens =
    completed > 0 && results.length > 0
      ? Math.round(
          results.reduce((sum, r) => sum + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0) /
            results.length
        )
      : null;
  const eta =
    isRunning && completed > 0 && elapsed > 0
      ? Math.round(((total - completed) * elapsed) / completed)
      : null;

  // Toolbar selection state
  const selectedResults = results.filter((r) => selected.has(r.rank));
  const canReprocess = selectedResults.some((r) => r.cfo_nome && !r.cfo_linkedin);
  const canImport = selectedResults.length > 0 && !!status?.dataset_id;
  const liSearchCandidates = selectedResults.filter((r) => r.cfo_nome && !r.cfo_linkedin);
  const canLiSearch = liSearchCandidates.length > 0;
  const allSelected = results.length > 0 && selected.size === results.length;
  const someSelected = selected.size > 0 && selected.size < results.length;

  // Confidence pie data
  const pieData = [
    { name: "High", value: results.filter((r) => r.confidenza === "high").length, key: "high" },
    { name: "Medium", value: results.filter((r) => r.confidenza === "medium").length, key: "medium" },
    { name: "Low", value: results.filter((r) => r.confidenza === "low").length, key: "low" },
    { name: "Not found", value: results.filter((r) => !r.cfo_nome).length, key: "not_found" },
  ].filter((d) => d.value > 0);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">

      {/* Header */}
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">CFO Enricher Monitor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Real-time monitoring for the Claude Agent enrichment pipeline — local only
        </p>
      </div>

      {/* Server offline banner */}
      {serverOnline === false && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Monitor server is offline. Run{" "}
          <code className="font-mono bg-red-100 rounded px-1 py-0.5">./start.sh</code>{" "}
          inside <code className="font-mono bg-red-100 rounded px-1 py-0.5">cfo-enricher/</code>,
          then reload this page.
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {errorMsg}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Controls + Progress                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700">Run Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-4 items-end">
            {/* Dataset selector */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Dataset</label>
              <Select
                value={selectedDataset}
                onValueChange={handleDatasetChange}
                disabled={isRunning}
              >
                <SelectTrigger className="h-9 border-slate-200 bg-white text-slate-800 text-sm">
                  <SelectValue placeholder="Select dataset…" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-sm">
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Concurrency slider */}
            <div className="w-44">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Concurrency:{" "}
                <span className="text-slate-900 font-semibold">{concurrency}</span>
              </label>
              <Slider
                min={1}
                max={16}
                step={1}
                value={[concurrency]}
                onValueChange={handleConcurrencyChange}
                disabled={isRunning}
              />
            </div>

            {/* Reset checkbox */}
            <div className="flex items-center gap-2 pb-1">
              <input
                id="reset-chk"
                type="checkbox"
                checked={doReset}
                onChange={(e) => setDoReset(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-300 accent-indigo-600"
              />
              <label htmlFor="reset-chk" className="text-xs text-slate-500 cursor-pointer select-none">
                Reset checkpoint
              </label>
            </div>

            {/* Start / Stop */}
            {!isRunning ? (
              <Button
                onClick={handleStart}
                disabled={!selectedDataset || serverOnline === false}
                className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Start Run
              </Button>
            ) : (
              <Button onClick={handleStop} variant="destructive" className="h-9">
                Stop
              </Button>
            )}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{completed} / {total} companies</span>
                <span>
                  {pct}%
                  {eta != null && ` — ETA ~${eta}s`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {status?.status === "completed" && (
                <p className="text-xs text-emerald-600 font-medium">Run completed successfully.</p>
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
            label="CFO Found"
            value={`${foundPct}%`}
            sub={`${found} found · ${notFound} not found`}
            accent
          />
          <KpiCard
            label="Total Tokens"
            value={results.reduce((s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0).toLocaleString()}
            sub={avgTokens != null ? `${avgTokens} tok/company avg` : undefined}
          />
          <KpiCard
            label="Elapsed"
            value={`${elapsed.toFixed(0)}s`}
            sub={isRunning ? "running…" : (status?.status ?? "")}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Results table + charts                                                */}
      {/* ------------------------------------------------------------------ */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Live table */}
          <div className="xl:col-span-2">
            <Card className="border-slate-200 bg-white">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    Live Results
                    <Badge variant="secondary" className="text-[10px] tabular-nums">
                      {results.length}
                    </Badge>
                  </CardTitle>

                  {/* Toolbar */}
                  <div className="flex items-center gap-2 flex-wrap pb-1">
                    {selected.size > 0 && (
                      <>
                        {canLiSearch && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-blue-200 text-blue-600 hover:bg-blue-50"
                            onClick={() => setLiSearchModalOpen(true)}
                          >
                            Find LinkedIn ({liSearchCandidates.length})
                          </Button>
                        )}
                        {canReprocess && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-slate-200 text-slate-600"
                            disabled={reprocessingBulk}
                            onClick={handleReprocessBulk}
                          >
                            {reprocessingBulk
                              ? "Re-running…"
                              : `Re-run agent (${selectedResults.filter((r) => r.cfo_nome && !r.cfo_linkedin).length})`}
                          </Button>
                        )}
                        {canImport && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                            disabled={importing}
                            onClick={() => handleImport(selectedResults)}
                          >
                            {importing ? "Importing…" : `Import Selected (${selected.size})`}
                          </Button>
                        )}
                      </>
                    )}
                    {status?.dataset_id && (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
                        disabled={importing}
                        onClick={() => handleImport(results)}
                      >
                        {importing ? "Importing…" : "Import All"}
                      </Button>
                    )}
                  </div>
                </div>

                {importMsg && (
                  <p className={`text-xs mt-1.5 ${importMsg.includes("failed") || importMsg.includes("Failed") ? "text-red-600" : "text-emerald-600"}`}>
                    {importMsg}
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-0 mt-3">
                <div className="overflow-auto max-h-[520px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
                      <tr className="text-slate-500 text-left">
                        <th className="px-3 py-2.5 w-8">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 accent-indigo-600"
                            checked={allSelected}
                            ref={(el) => { if (el) el.indeterminate = someSelected; }}
                            onChange={toggleSelectAll}
                          />
                        </th>
                        <th className="px-3 py-2.5 font-medium w-10">#</th>
                        <th className="px-3 py-2.5 font-medium">Company</th>
                        <th className="px-3 py-2.5 font-medium">CFO</th>
                        <th className="px-3 py-2.5 font-medium hidden md:table-cell">Role</th>
                        <th className="px-3 py-2.5 font-medium">Conf.</th>
                        <th className="px-3 py-2.5 font-medium text-right hidden sm:table-cell">Tokens</th>
                        <th className="px-3 py-2.5 font-medium text-right hidden lg:table-cell">Turns</th>
                        <th className="px-3 py-2.5 font-medium text-right hidden lg:table-cell">Time</th>
                        <th className="px-3 py-2.5 font-medium text-right w-16">Act.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr
                          key={r.rank}
                          className={`border-b border-slate-100 transition-colors ${
                            selected.has(r.rank)
                              ? "bg-indigo-50/60"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 accent-indigo-600"
                              checked={selected.has(r.rank)}
                              onChange={() => toggleSelect(r.rank)}
                            />
                          </td>
                          <td className="px-3 py-2 text-slate-400">{r.rank}</td>
                          <td className="px-3 py-2 max-w-[140px]">
                            <button
                              onClick={() => setDetailCompany(r)}
                              className="block truncate font-medium text-slate-800 hover:text-indigo-600 transition-colors duration-150 cursor-pointer text-left w-full"
                              title="View details"
                            >
                              {r.azienda}
                            </button>
                          </td>
                          <td className="px-3 py-2 max-w-[130px]">
                            {r.cfo_nome ? (
                              r.cfo_linkedin ? (
                                <a
                                  href={r.cfo_linkedin}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block truncate text-indigo-600 hover:text-indigo-500 hover:underline"
                                >
                                  {r.cfo_nome}
                                </a>
                              ) : (
                                <span className="block truncate text-slate-800">{r.cfo_nome}</span>
                              )
                            ) : (
                              <span className="text-slate-300 italic">not found</span>
                            )}
                            {(r.cfo_email || r.cfo_telefono) && (
                              <span className="block truncate text-[10px] text-slate-400 mt-0.5">
                                {[r.cfo_email, r.cfo_telefono].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell max-w-[150px]">
                            <span className="block truncate text-slate-500">{r.cfo_ruolo ?? "—"}</span>
                          </td>
                          <td className="px-3 py-2">
                            <ConfBadge value={r.confidenza} />
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 hidden sm:table-cell tabular-nums">
                            {r.input_tokens != null && r.output_tokens != null
                              ? (r.input_tokens + r.output_tokens).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 hidden lg:table-cell tabular-nums">
                            {r.tool_calls || "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 hidden lg:table-cell tabular-nums">
                            {r.elapsed_s.toFixed(1)}s
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.cfo_nome && !r.cfo_linkedin && (
                              <button
                                onClick={() => handleLiSearchOne(r)}
                                disabled={liSearchingRanks.has(r.rank)}
                                title={
                                  liSearchingRanks.has(r.rank)
                                    ? "Searching…"
                                    : liRowResult[r.rank] === "found"
                                    ? "Found!"
                                    : liRowResult[r.rank] === "not_found"
                                    ? "Not found — retry"
                                    : "Find LinkedIn (fast web search)"
                                }
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium border transition-colors disabled:opacity-40 ${
                                  liRowResult[r.rank] === "found"
                                    ? "border-emerald-200 text-emerald-600 bg-emerald-50"
                                    : liRowResult[r.rank] === "not_found"
                                    ? "border-slate-200 text-slate-400"
                                    : "border-blue-200 text-blue-600 hover:bg-blue-50"
                                }`}
                              >
                                {liSearchingRanks.has(r.rank)
                                  ? "…"
                                  : liRowResult[r.rank] === "found"
                                  ? "✓"
                                  : liRowResult[r.rank] === "not_found"
                                  ? "✗"
                                  : "LI"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="space-y-4">
            {/* Confidence donut */}
            <Card className="border-slate-200 bg-white">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-semibold text-slate-700">
                  Confidence Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3 pb-4">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={PIE_COLORS[entry.key]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "#0f172a",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                  {pieData.map((d) => (
                    <div key={d.key} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: PIE_COLORS[d.key] }}
                      />
                      {d.name}: {d.value}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Cumulative token chart */}
            {tokenHistory.length > 1 && (
              <Card className="border-slate-200 bg-white">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-semibold text-slate-700">
                    Cumulative Tokens{" "}
                    <span className="text-indigo-600 tabular-nums">
                      {(tokenHistory[tokenHistory.length - 1]?.tokens ?? 0).toLocaleString()}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart
                      data={tokenHistory}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="n" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)}
                      />
                      <Tooltip
                        contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, color: "#0f172a" }}
                        formatter={(v) => [Number(v).toLocaleString(), "Total tokens"]}
                      />
                      <Area type="monotone" dataKey="tokens" stroke="#6366f1" strokeWidth={2} fill="url(#tokGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {liSearchModalOpen && (
        <LinkedInSearchModal
          open={liSearchModalOpen}
          selectedCompanies={liSearchCandidates.map((r) => ({
            id: String(r.rank),       // rank used as surrogate key — no DB save in monitor context
            azienda: r.azienda,
            cfoNome: r.cfo_nome!,
            dataOrigin: "curated",    // irrelevant — companyId is absent so no DB write
          }))}
          onClose={() => setLiSearchModalOpen(false)}
          onLinkedInUpdate={(rankStr, linkedinUrl) => {
            const rank = Number(rankStr);
            setResults((prev) =>
              prev.map((row) => row.rank === rank ? { ...row, cfo_linkedin: linkedinUrl } : row)
            );
          }}
        />
      )}

      <CompanyDetailModal
        company={detailCompany}
        onClose={() => setDetailCompany(null)}
      />
    </div>
  );
}
