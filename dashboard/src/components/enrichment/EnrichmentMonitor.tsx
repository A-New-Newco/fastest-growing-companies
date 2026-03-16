"use client";

import { useState } from "react";
import { Play, Pause, CheckCheck, Loader2, AlertTriangle, Zap, Cloud, Monitor, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import SessionStatusBadge from "./SessionStatusBadge";
import TokenUsageBadge from "./TokenUsageBadge";
import CompanyEnrichmentTable from "./CompanyEnrichmentTable";
import { useEnrichmentStream } from "@/hooks/useEnrichmentStream";
import type { EnrichmentSession, EnrichmentSessionCompany } from "@/types";

interface Props {
  initialSession: EnrichmentSession;
  initialCompanies: EnrichmentSessionCompany[];
}

export default function EnrichmentMonitor({ initialSession, initialCompanies }: Props) {
  const { state, start, pause, retryFailed, resetAll } = useEnrichmentStream({
    sessionId: initialSession.id,
    initialSession,
    initialCompanies,
  });

  const [applyingAll, setApplyingAll] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resetting, setResetting] = useState(false);

  const session = state.session ?? initialSession;
  const isRunning = state.isConnected;
  const modelCfg = session.modelConfig as { numWorkers?: number; enrichmentMode?: "remote" | "local" } | null;
  const numWorkers = modelCfg?.numWorkers ?? 3;
  const enrichmentMode = modelCfg?.enrichmentMode ?? "remote";
  const total = session.totalCompanies;
  const completed = state.progress?.completed ?? session.completedCount;
  const found = state.progress?.found ?? session.foundCount;
  const failed = state.progress?.failed ?? session.failedCount;
  const tokensTotal = state.progress?.tokensTotal ?? session.tokensTotal;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const canStart = !isRunning && !state.isComplete && session.status !== "failed";
  const canPause = isRunning;
  const canApply = state.isComplete || session.status === "completed";
  const canRetry = !isRunning && failed > 0 && (state.isComplete || session.status === "completed" || session.status === "failed");
  const canReset = !isRunning && (completed > 0 || session.status === "failed");

  async function handleApplyAll() {
    setApplyingAll(true);
    try {
      await fetch(`/api/enrichment-sessions/${session.id}/apply`, { method: "POST" });
    } finally {
      setApplyingAll(false);
    }
  }

  async function handleApplySingle(companyRowId: string) {
    await fetch(`/api/enrichment-sessions/${session.id}/companies/${companyRowId}/apply`, {
      method: "POST",
    });
  }

  async function handleResetAll() {
    if (!confirm("Reset all companies and start over? This clears all results.")) return;
    setResetting(true);
    try {
      await resetAll();
    } finally {
      setResetting(false);
    }
  }

  async function handleRetryFailed() {
    setRetrying(true);
    try {
      await retryFailed();
    } finally {
      setRetrying(false);
    }
  }

  // Stale session detection (last_heartbeat > 5 min ago while status=running)
  const isStale = session.status === "running" && !isRunning && (() => {
    if (!session.lastHeartbeat) return false;
    return Date.now() - new Date(session.lastHeartbeat).getTime() > 5 * 60_000;
  })();

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{session.name}</h1>
            <div className="flex items-center gap-3 mt-1.5">
              <SessionStatusBadge status={isRunning ? "running" : session.status} />
              {tokensTotal > 0 && <TokenUsageBadge tokensTotal={tokensTotal} />}
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {enrichmentMode === "local"
                  ? <Monitor className="w-3 h-3" />
                  : <Cloud className="w-3 h-3" />}
                {enrichmentMode === "local" ? "Local" : "Cloud"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                <Zap className="w-3 h-3" />
                {numWorkers}w
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canStart && (
              <Button onClick={start} className="gap-1.5">
                <Play className="w-3.5 h-3.5" />
                {session.status === "paused" ? "Resume" : "Start"}
              </Button>
            )}
            {canPause && (
              <Button variant="outline" onClick={pause} className="gap-1.5">
                <Pause className="w-3.5 h-3.5" />
                Pause
              </Button>
            )}
            {canApply && (
              <Button
                variant="outline"
                onClick={handleApplyAll}
                disabled={applyingAll}
                className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
              >
                {applyingAll
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</>
                  : <><CheckCheck className="w-3.5 h-3.5" /> {session.enrichmentCategory === "linkedin" ? "Apply All LinkedIn URLs" : "Apply All Results"}</>}
              </Button>
            )}
            {canRetry && (
              <Button
                variant="outline"
                onClick={handleRetryFailed}
                disabled={retrying}
                className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50"
              >
                {retrying
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Retrying…</>
                  : <><RotateCcw className="w-3.5 h-3.5" /> Retry Failed ({failed})</>}
              </Button>
            )}
            {canReset && (
              <Button
                variant="outline"
                onClick={handleResetAll}
                disabled={resetting}
                className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
              >
                {resetting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Resetting…</>
                  : <><RotateCcw className="w-3.5 h-3.5" /> Reset All</>}
              </Button>
            )}
          </div>
        </div>

        {/* Stale warning */}
        {isStale && (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            This session appears stuck (last heartbeat was over 5 minutes ago). Click Resume to restart.
          </div>
        )}

        {/* Error */}
        {state.error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{completed} / {total} companies processed</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-4 pt-1">
            <div className="text-center">
              <p className="text-base font-semibold text-slate-900 tabular-nums">{completed}</p>
              <p className="text-xs text-slate-500">Done</p>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-emerald-600 tabular-nums">{found}</p>
              <p className="text-xs text-slate-500">Found</p>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-red-400 tabular-nums">{failed}</p>
              <p className="text-xs text-slate-500">Failed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Company table */}
      <CompanyEnrichmentTable
        companies={state.companies}
        enrichmentCategory={session.enrichmentCategory}
        isRunning={isRunning}
        onApplySingle={handleApplySingle}
      />
    </div>
  );
}
