"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, SkipForward, Minus, ExternalLink, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LogPanel from "./LogPanel";
import type { EnrichmentSessionCompany, EnrichmentCategory } from "@/types";

interface Props {
  companies: EnrichmentSessionCompany[];
  enrichmentCategory?: EnrichmentCategory;
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

export default function CompanyEnrichmentTable({ companies, enrichmentCategory = "cfo", isRunning, onApplySingle }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const isLinkedin = enrichmentCategory === "linkedin";

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

  // ---------------------------------------------------------------------------
  // LinkedIn mode — table layout matching LI Monitor
  // ---------------------------------------------------------------------------
  if (isLinkedin) {
    return (
      <div className="rounded-md border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">LinkedIn</th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => {
                const isExpanded = expanded.has(company.id);
                const isLive = isRunning && company.status === "running";
                const confidenzaMeta = company.resultConfidenza ? CONFIDENZA_META[company.resultConfidenza] : null;
                const hasResult = !!company.resultLinkedin;

                return (
                  <Fragment key={company.id}>
                    <tr
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      onClick={() => toggle(company.id)}
                    >
                      {/* Expand toggle */}
                      <td className="px-4 py-2 text-slate-400">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      {/* Contact */}
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {company.contactNome || "\u2014"}
                      </td>
                      {/* Role */}
                      <td className="px-4 py-2 text-slate-600">
                        {company.contactRuolo || "\u2014"}
                      </td>
                      {/* Company */}
                      <td className="px-4 py-2 text-slate-700">
                        {company.companyName}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={company.status} />
                          <span className="text-xs text-slate-500 capitalize">{company.status}</span>
                        </div>
                      </td>
                      {/* LinkedIn URL */}
                      <td className="px-4 py-2">
                        {company.resultLinkedin ? (
                          <a
                            href={company.resultLinkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-800 text-xs truncate block max-w-[200px]"
                          >
                            {company.resultLinkedin
                              .replace("https://www.linkedin.com/in/", "")
                              .replace(/\/$/, "")}
                          </a>
                        ) : company.status === "done" ? (
                          <span className="text-slate-300">&mdash;</span>
                        ) : null}
                      </td>
                      {/* Confidence */}
                      <td className="px-4 py-2">
                        {confidenzaMeta ? (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${confidenzaMeta.className}`}
                          >
                            {confidenzaMeta.label}
                          </span>
                        ) : company.status === "done" ? (
                          <span className="text-slate-300">&mdash;</span>
                        ) : null}
                      </td>
                      {/* Tokens */}
                      <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">
                        {company.tokensInput + company.tokensOutput > 0
                          ? `${((company.tokensInput + company.tokensOutput) / 1000).toFixed(1)}k`
                          : "\u2014"}
                      </td>
                      {/* Apply */}
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        {company.status === "done" && hasResult && !company.appliedAt && onApplySingle && (
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
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="p-0">
                          <LogPanel logs={company.logs} isLive={isLive} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No companies in this session yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // CFO mode — original grid layout
  // ---------------------------------------------------------------------------
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
        const hasResult = !!company.resultNome;

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
                {company.modelUsed ? (
                  <p className="text-xs text-slate-400 truncate">{company.modelUsed}</p>
                ) : null}
              </div>

              {/* Status */}
              <div className="flex items-center gap-1.5">
                <StatusIcon status={company.status} />
                <span className="text-xs text-slate-500 capitalize">{company.status}</span>
              </div>

              {/* Result — CFO mode */}
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
                  : "\u2014"}
              </span>

              {/* Apply button */}
              <div onClick={(e) => e.stopPropagation()}>
                {company.status === "done" && hasResult && !company.appliedAt && onApplySingle && (
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
