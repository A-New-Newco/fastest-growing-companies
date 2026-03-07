"use client";

import { useEffect, useState } from "react";
import { loadCompanies } from "@/lib/data";
import type { Company } from "@/types";
import TopSectorsBar from "@/components/charts/TopSectorsBar";
import RoleDistributionPie from "@/components/charts/RoleDistributionPie";
import ConfidenceBar from "@/components/charts/ConfidenceBar";
import GrowthRevenueScatter from "@/components/charts/GrowthRevenueScatter";
import RegionMap from "@/components/charts/RegionMap";

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

  useEffect(() => {
    loadCompanies()
      .then(setCompanies)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
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
          {/* Scatter: Growth vs Revenue */}
          <GrowthRevenueScatter companies={companies} />

          {/* Two-column row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RoleDistributionPie companies={companies} />
            <ConfidenceBar companies={companies} />
          </div>

          {/* Top sectors bar */}
          <TopSectorsBar companies={companies} />

          {/* Italy map */}
          <RegionMap companies={companies} />
        </>
      )}
    </div>
  );
}
