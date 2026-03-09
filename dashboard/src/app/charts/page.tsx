"use client";

import { useEffect, useMemo, useState } from "react";
import { loadCompanies, filterCompanies } from "@/lib/data";
import type { Company } from "@/types";
import { useFilters } from "@/lib/filter-context";
import ChartFilterBar from "@/components/charts/ChartFilterBar";
import TopSectorsBar from "@/components/charts/TopSectorsBar";
import RoleDistributionPie from "@/components/charts/RoleDistributionPie";
import ConfidenceBar from "@/components/charts/ConfidenceBar";
import GrowthRevenueScatter from "@/components/charts/GrowthRevenueScatter";
import RegionMap from "@/components/charts/RegionMap";
import CfoPresenceBySettore from "@/components/charts/CfoPresenceBySettore";
import CfoPresenceByRegione from "@/components/charts/CfoPresenceByRegione";
import GrowthByCfoPresence from "@/components/charts/GrowthByCfoPresence";
import RevenueByCfoPresence from "@/components/charts/RevenueByCfoPresence";

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      className="w-full rounded-lg bg-slate-100 animate-pulse"
      style={{ height }}
    />
  );
}

export default function ChartsPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const { filters, setFilters } = useFilters();

  useEffect(() => {
    loadCompanies()
      .then(setCompanies)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => filterCompanies(companies, filters),
    [companies, filters]
  );

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Analytics &amp; Charts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Visual breakdown of growth patterns, sector dynamics, and CFO data quality.
        </p>
      </div>

      {loading ? (
        <div className="space-y-6">
          <ChartSkeleton height={56} />
          <ChartSkeleton height={420} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartSkeleton height={340} />
            <ChartSkeleton height={340} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartSkeleton height={380} />
            <ChartSkeleton height={320} />
          </div>
          <ChartSkeleton height={460} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartSkeleton height={320} />
            <ChartSkeleton height={320} />
          </div>
          <ChartSkeleton height={420} />
          <ChartSkeleton height={520} />
        </div>
      ) : (
        <>
          {/* Global filter bar */}
          <ChartFilterBar
            companies={companies}
            filters={filters}
            onChange={setFilters}
            filteredCount={filtered.length}
          />

          {/* ── CFO Presence section ─────────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              Analisi Presenza CFO
            </h2>
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CfoPresenceBySettore companies={filtered} />
                <CfoPresenceByRegione companies={filtered} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <GrowthByCfoPresence companies={filtered} />
                <RevenueByCfoPresence companies={filtered} />
              </div>
            </div>
          </div>

          {/* ── General charts ───────────────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              Analisi Generale
            </h2>
            <div className="space-y-6">
              <GrowthRevenueScatter companies={filtered} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <RoleDistributionPie companies={filtered} />
                <ConfidenceBar companies={filtered} />
              </div>

              <TopSectorsBar companies={filtered} />
              <RegionMap companies={filtered} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
