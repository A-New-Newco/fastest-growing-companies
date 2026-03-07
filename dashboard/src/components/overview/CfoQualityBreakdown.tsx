"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";

interface CfoQualityBreakdownProps {
  companies: Company[];
}

export default function CfoQualityBreakdown({
  companies,
}: CfoQualityBreakdownProps) {
  const stats = useMemo(() => {
    const total = companies.length;
    if (total === 0) return null;
    const realCfo = companies.filter((c) => c.hasRealCfo).length;
    const contactOnly = companies.filter(
      (c) => c.cfoFound && !c.hasRealCfo
    ).length;
    const notFound = companies.filter((c) => !c.cfoFound).length;
    return {
      total,
      realCfo,
      contactOnly,
      notFound,
      realPct: (realCfo / total) * 100,
      contactPct: (contactOnly / total) * 100,
      notFoundPct: (notFound / total) * 100,
    };
  }, [companies]);

  if (!stats) return null;

  const { total, realCfo, contactOnly, notFound, realPct, contactPct, notFoundPct } =
    stats;

  const segments = [
    {
      label: "Real CFO / Finance",
      count: realCfo,
      pct: realPct,
      color: "bg-emerald-500",
      textColor: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      description: "CFO/DAF or Finance Manager, confidence medium–high",
    },
    {
      label: "Contact Found (non-CFO)",
      count: contactOnly,
      pct: contactPct,
      color: "bg-blue-500",
      textColor: "text-blue-700",
      bg: "bg-blue-50",
      border: "border-blue-200",
      description: "CEO, Founder, Amministratore, or low-confidence match",
    },
    {
      label: "Not Found",
      count: notFound,
      pct: notFoundPct,
      color: "bg-slate-300",
      textColor: "text-slate-500",
      bg: "bg-slate-50",
      border: "border-slate-200",
      description: "No finance contact identified",
    },
  ];

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900">
          CFO Data Quality Breakdown
        </CardTitle>
        <p className="text-xs text-slate-500 leading-relaxed">
          Only contacts classified as{" "}
          <strong className="text-slate-700">CFO/DAF or Finance Manager</strong>{" "}
          with{" "}
          <strong className="text-slate-700">medium or high confidence</strong>{" "}
          count as &quot;Real CFO&quot;. The 92.4% contact-found rate is
          misleading — only{" "}
          <span className="font-semibold text-emerald-600">
            {realPct.toFixed(1)}%
          </span>{" "}
          are true finance officers.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stacked bar */}
        <div className="flex h-6 w-full rounded-full overflow-hidden gap-0.5">
          {segments.map((seg) => (
            <div
              key={seg.label}
              className={`${seg.color} transition-all duration-500 first:rounded-l-full last:rounded-r-full`}
              style={{ width: `${seg.pct}%` }}
              title={`${seg.label}: ${seg.pct.toFixed(1)}%`}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {segments.map((seg) => (
            <div
              key={seg.label}
              className={`flex items-start gap-2.5 rounded-lg border p-3 ${seg.bg} ${seg.border}`}
            >
              <div
                className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${seg.color}`}
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className={`text-xl font-bold ${seg.textColor}`}>
                    {seg.count}
                  </span>
                  <span className={`text-xs font-medium ${seg.textColor} opacity-70`}>
                    {seg.pct.toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-700 leading-tight">
                  {seg.label}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                  {seg.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
