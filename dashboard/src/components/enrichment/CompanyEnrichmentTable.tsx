"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, SkipForward, Minus, ExternalLink, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LogPanel from "./LogPanel";
import type { EnrichmentSessionCompany } from "@/types";

interface Props {
  companies: EnrichmentSessionCompany[];
  isRunning?: boolean;
  onApplySingle?: (companyRowId: string) => Promise<void>;
}

const CONFIDENZA_META = {
  high:   { label: "High",   className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  medium: { label: "Medium", className: "bg-amber-50 text-amber-700 border-amber-200" },
  low:    { label: "Low",    className: "bg-slate-50 text-slate-600 border-slate-200" },
};

function StatusIcon({ status }: { status: EnrichmentSessionCompany["status"] }) {
  if (status === "running") return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-red-400" />;
  if (status === "skipped") return <SkipForward className="w-4 h-4 text-slate-400" />;
  return <Minus className="w-4 h-4 text-slate-300" />;
}

export default function CompanyEnrichmentTable({ companies, isRunning, onApplySingle }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApply(companyRowId: string) {
    if (!onApplySingle || applying.has(companyRowId)) return;
    setApplying((prev) => new Set([...prev, companyRowId]));
    try {
      await onApplySingle(companyRowId);
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(companyRowId);
        return next;
      });
    }
  }

  return (
    <div className="rounded-md border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[2rem_1rem_1fr_6rem_8rem_5rem_4rem] gap-3 items-center px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
        <span></span>
        <span>#</span>
        <span>Company</span>
        <span>Status</span>
        <span>Result</span>
        <span>Tokens</span>
        <span></span>
      </div>

      {companies.map((company) => {
        const isExpanded = expanded.has(company.id);
        const isLive = isRunning && company.status === "running";
        const confidenzaMeta = company.resultConfidenza ? CONFIDENZA_META[company.resultConfidenza] : null;

        return (
          <div key={company.id} className="border-b border-slate-100 last:border-0">
            {/* Row */}
            <div
              className="grid grid-cols-[2rem_1rem_1fr_6rem_8rem_5rem_4rem] gap-3 items-center px-4 py-3 hover:bg-slate-50 cursor-pointer"
              onClick={() => toggle(company.id)}
            >
              {/* Expand toggle */}
              <span className="text-slate-400">
                {isExpanded
                  ? <ChevronDown className="w-3.5 h-3.5" />
                  : <ChevronRight className="w-3.5 h-3.5" />}
              </span>

              {/* Position */}
              <span className="text-xs text-slate-400 tabular-nums">{company.position}</span>

              {/* Company name */}
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{company.companyName}</p>
                {company.modelUsed && (
                  <p className="text-xs text-slate-400 truncate">{company.modelUsed}</p>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-1.5">
                <StatusIcon status={company.status} />
                <span className="text-xs text-slate-500 capitalize">{company.status}</span>
              </div>

              {/* Result */}
              <div className="min-w-0">
                {company.resultNome ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs font-medium text-slate-800 truncate">{company.resultNome}</p>
                    <div className="flex items-center gap-1">
                      {confidenzaMeta && (
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${confidenzaMeta.className}`}>
                          {confidenzaMeta.label}
                        </Badge>
                      )}
                      {company.resultLinkedin && (
                        <a
                          href={company.resultLinkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-500 hover:text-blue-600"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ) : company.status === "done" ? (
                  <span className="text-xs text-slate-400">Not found</span>
                ) : null}
              </div>

              {/* Tokens */}
              <span className="text-xs text-slate-400 tabular-nums">
                {company.tokensInput + company.tokensOutput > 0
                  ? `${((company.tokensInput + company.tokensOutput) / 1000).toFixed(1)}k`
                  : "—"}
              </span>

              {/* Apply button */}
              <div onClick={(e) => e.stopPropagation()}>
                {company.status === "done" && company.resultNome && !company.appliedAt && onApplySingle && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                    disabled={applying.has(company.id)}
                    onClick={() => handleApply(company.id)}
                  >
                    {applying.has(company.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
                  </Button>
                )}
                {company.appliedAt && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600">
                    <Check className="w-3 h-3" />
                    Applied
                  </span>
                )}
              </div>
            </div>

            {/* Expanded log panel */}
            {isExpanded && (
              <LogPanel logs={company.logs} isLive={isLive} />
            )}
          </div>
        );
      })}
    </div>
  );
}
