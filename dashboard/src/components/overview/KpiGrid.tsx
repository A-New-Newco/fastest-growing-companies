"use client";

import { useMemo } from "react";
import { Building2, TrendingUp, UserCheck, Layers, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Company } from "@/types";
import { formatGrowth } from "@/lib/data";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: boolean;
  tooltip?: string;
}

function KpiCard({ label, value, sub, icon, accent, tooltip }: KpiCardProps) {
  const card = (
    <Card
      className={cn(
        "relative overflow-hidden border transition-shadow hover:shadow-md",
        accent
          ? "border-indigo-200 bg-indigo-50/60"
          : "border-slate-200 bg-white"
      )}
    >
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p
              className={cn(
                "text-xs font-medium uppercase tracking-widest mb-1",
                accent ? "text-indigo-500" : "text-slate-400"
              )}
            >
              {label}
            </p>
            <p
              className={cn(
                "text-3xl font-bold tracking-tight leading-none",
                accent ? "text-indigo-700" : "text-slate-900"
              )}
            >
              {value}
            </p>
            {sub && (
              <p
                className={cn(
                  "mt-1 text-xs",
                  accent ? "text-indigo-400" : "text-slate-400"
                )}
              >
                {sub}
              </p>
            )}
          </div>
          <div
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-lg",
              accent
                ? "bg-indigo-100 text-indigo-600"
                : "bg-slate-100 text-slate-500"
            )}
          >
            {icon}
          </div>
        </div>
        {accent && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500" />
        )}
      </CardContent>
    </Card>
  );

  if (!tooltip) return card;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{card}</div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-xs text-xs leading-relaxed"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

interface KpiGridProps {
  companies: Company[];
}

export default function KpiGrid({ companies }: KpiGridProps) {
  const stats = useMemo(() => {
    if (companies.length === 0) return null;
    const avgGrowth =
      companies.reduce((s, c) => s + c.tassoCrescita, 0) / companies.length;
    const realCfo = companies.filter((c) => c.hasRealCfo).length;
    const sectors = new Set(companies.map((c) => c.settore)).size;
    const regions = new Set(companies.map((c) => c.regione)).size;
    return { avgGrowth, realCfo, sectors, regions };
  }, [companies]);

  if (!stats) return <KpiGridSkeleton />;

  const { avgGrowth, realCfo, sectors, regions } = stats;
  const total = companies.length;
  const realCfoPct = ((realCfo / total) * 100).toFixed(1);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Total Companies"
          value={total.toLocaleString()}
          icon={<Building2 className="w-4 h-4" />}
        />
        <KpiCard
          label="Avg. Growth Rate"
          value={formatGrowth(avgGrowth)}
          sub="CAGR 2021 → 2024"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label="Real CFO Identified"
          value={`${realCfo}`}
          sub={`${realCfoPct}% of total`}
          icon={<UserCheck className="w-4 h-4" />}
          accent
          tooltip="Contacts classified as CFO/DAF or Finance Manager with medium or high confidence. Excludes CEOs, Founders, and low-confidence matches."
        />
        <KpiCard
          label="Sectors Covered"
          value={String(sectors)}
          icon={<Layers className="w-4 h-4" />}
        />
        <KpiCard
          label="Regions Active"
          value={String(regions)}
          sub="out of 20 Italian regions"
          icon={<MapPin className="w-4 h-4" />}
        />
      </div>
    </TooltipProvider>
  );
}

function KpiGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="border-slate-200 bg-white">
          <CardContent className="pt-5 pb-4 px-5">
            <div className="h-3 w-24 bg-slate-100 rounded animate-pulse mb-3" />
            <div className="h-8 w-16 bg-slate-100 rounded animate-pulse" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
