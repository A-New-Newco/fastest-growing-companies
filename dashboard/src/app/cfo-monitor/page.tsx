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
import {
  type CompanyResult,
  type Dataset,
  type DoneEvent,
  type EnrichmentStatus,
  type ProgressEvent,
  connectToEnrichmentStream,
  fetchDatasets,
  fetchStatus,
  startRun,
  stopRun,
} from "@/lib/enrichment-client";

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
  // Config
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [concurrency, setConcurrency] = useState(8);
  const [doReset, setDoReset] = useState(false);

  // State
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [costHistory, setCostHistory] = useState<{ n: number; cost: number }[]>([]);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // ------------------------------------------------------------------
  // Boot: load datasets + current status
  // ------------------------------------------------------------------
  useEffect(() => {
    fetchDatasets()
      .then((ds) => {
        setDatasets(ds);
        if (ds.length > 0) setSelectedDataset(ds[0].id);
        setServerOnline(true);
      })
      .catch(() => setServerOnline(false));

    fetchStatus()
      .then((s) => {
        setStatus(s);
        if (s.status === "running") attachStream();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // SSE
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
        setResults((prev) => [data, ...prev]);
        if (data.cost_usd != null) {
          setCostHistory((prev) => {
            const running = parseFloat(
              ((prev[prev.length - 1]?.cost ?? 0) + data.cost_usd!).toFixed(6)
            );
            return [...prev, { n: prev.length + 1, cost: running }];
          });
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
    setResults([]);
    setCostHistory([]);
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
  // Derived values
  // ------------------------------------------------------------------
  const isRunning = status?.status === "running";
  const completed = progress?.completed ?? status?.completed ?? 0;
  const total = status?.total ?? 0;
  const found = progress?.found ?? status?.found ?? 0;
  const notFound = progress?.not_found ?? status?.not_found ?? 0;
  const totalCost = progress?.total_cost_usd ?? status?.total_cost_usd ?? 0;
  const elapsed = progress?.elapsed_s ?? status?.elapsed_s ?? 0;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const foundPct = completed > 0 ? Math.round((found / completed) * 100) : 0;
  const avgCost = completed > 0 ? `$${(totalCost / completed).toFixed(4)}` : "—";
  const eta =
    isRunning && completed > 0 && elapsed > 0
      ? Math.round(((total - completed) * elapsed) / completed)
      : null;

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
              <Select value={selectedDataset} onValueChange={setSelectedDataset} disabled={isRunning}>
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
                onValueChange={([v]) => setConcurrency(v)}
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
            label="Total Cost"
            value={`$${totalCost.toFixed(4)}`}
            sub={`${avgCost}/company avg`}
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
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  Live Results
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {results.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[520px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
                      <tr className="text-slate-500 text-left">
                        <th className="px-4 py-2.5 font-medium w-12">#</th>
                        <th className="px-4 py-2.5 font-medium">Company</th>
                        <th className="px-4 py-2.5 font-medium">CFO</th>
                        <th className="px-4 py-2.5 font-medium hidden md:table-cell">Role</th>
                        <th className="px-4 py-2.5 font-medium">Conf.</th>
                        <th className="px-4 py-2.5 font-medium text-right hidden sm:table-cell">Cost</th>
                        <th className="px-4 py-2.5 font-medium text-right hidden sm:table-cell">Tokens</th>
                        <th className="px-4 py-2.5 font-medium text-right hidden lg:table-cell">Turns</th>
                        <th className="px-4 py-2.5 font-medium text-right hidden lg:table-cell">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr
                          key={r.rank}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-2 text-slate-400">{r.rank}</td>
                          <td className="px-4 py-2 max-w-[160px]">
                            <span className="block truncate font-medium text-slate-800">{r.azienda}</span>
                          </td>
                          <td className="px-4 py-2 max-w-[140px]">
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
                          </td>
                          <td className="px-4 py-2 hidden md:table-cell max-w-[160px]">
                            <span className="block truncate text-slate-500">{r.cfo_ruolo ?? "—"}</span>
                          </td>
                          <td className="px-4 py-2">
                            <ConfBadge value={r.confidenza} />
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 hidden sm:table-cell tabular-nums">
                            {r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 hidden sm:table-cell tabular-nums">
                            {r.input_tokens != null && r.output_tokens != null
                              ? `${r.input_tokens}+${r.output_tokens}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 hidden lg:table-cell tabular-nums">
                            {r.tool_calls || "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-500 hidden lg:table-cell tabular-nums">
                            {r.elapsed_s.toFixed(1)}s
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

            {/* Cumulative cost chart */}
            {costHistory.length > 1 && (
              <Card className="border-slate-200 bg-white">
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-semibold text-slate-700">
                    Cumulative Cost{" "}
                    <span className="text-indigo-600 tabular-nums">${totalCost.toFixed(4)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart
                      data={costHistory}
                      margin={{ top: 4, right: 8, left: -24, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="n"
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          fontSize: 11,
                          color: "#0f172a",
                        }}
                        formatter={(v) => [`$${Number(v).toFixed(4)}`, "Total cost"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#costGrad)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
