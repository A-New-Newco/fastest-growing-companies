"use client";

import { useEffect, useState } from "react";
import { loadCompanies } from "@/lib/data";
import type { Company } from "@/types";
import KpiGrid from "@/components/overview/KpiGrid";
import CfoQualityBreakdown from "@/components/overview/CfoQualityBreakdown";
import Top10Table from "@/components/overview/Top10Table";

export default function OverviewPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompanies()
      .then(setCompanies)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Italy&apos;s Fastest Growing Companies
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          2026 Edition &middot; Il Sole 24 Ore &mdash; Leader della Crescita
        </p>
      </div>

      {/* KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-slate-100 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <KpiGrid companies={companies} />
      )}

      {/* CFO quality breakdown */}
      {!loading && <CfoQualityBreakdown companies={companies} />}

      {/* Top 10 table */}
      {!loading && <Top10Table companies={companies} />}
    </div>
  );
}
