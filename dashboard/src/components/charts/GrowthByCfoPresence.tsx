"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";
import { formatGrowth } from "@/lib/data";

interface Props {
  companies: Company[];
}

interface BarDatum {
  settore: string;
  label: string;
  avgWithCfo: number | null;
  avgNoCfo: number | null;
  countWith: number;
  countNo: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d: BarDatum = payload[0]?.payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs max-w-[220px]">
      <p className="font-semibold text-slate-900 mb-2 leading-tight">{label}</p>
      <div className="space-y-1">
        {d?.avgWithCfo !== null && (
          <div className="flex justify-between gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              With CFO ({d.countWith})
            </span>
            <span className="font-medium text-slate-900">
              {formatGrowth(d.avgWithCfo!)}
            </span>
          </div>
        )}
        {d?.avgNoCfo !== null && (
          <div className="flex justify-between gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
              Without CFO ({d.countNo})
            </span>
            <span className="font-medium text-slate-900">
              {formatGrowth(d.avgNoCfo!)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GrowthByCfoPresence({ companies }: Props) {
  const data = useMemo<BarDatum[]>(() => {
    // Group by sector, compute avg growth for each CFO cohort
    const map = new Map<
      string,
      { withCfo: number[]; noCfo: number[] }
    >();
    for (const c of companies) {
      const entry = map.get(c.settore) ?? { withCfo: [], noCfo: [] };
      if (c.hasRealCfo) entry.withCfo.push(c.tassoCrescita);
      else entry.noCfo.push(c.tassoCrescita);
      map.set(c.settore, entry);
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    return [...map.entries()]
      .map(([settore, { withCfo, noCfo }]) => {
        const total = withCfo.length + noCfo.length;
        const label =
          settore.length > 30 ? settore.slice(0, 28) + "…" : settore;
        return {
          settore,
          label,
          avgWithCfo: avg(withCfo),
          avgNoCfo: avg(noCfo),
          countWith: withCfo.length,
          countNo: noCfo.length,
          total,
        };
      })
      // Only show sectors with at least 3 companies in either group
      .filter((d) => d.total >= 3)
      // Sort by total desc, take top 12
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [companies]);

  // Global averages for annotation
  const globalWith = useMemo(() => {
    const vals = companies.filter((c) => c.hasRealCfo).map((c) => c.tassoCrescita);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  }, [companies]);
  const globalNo = useMemo(() => {
    const vals = companies.filter((c) => !c.hasRealCfo).map((c) => c.tassoCrescita);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  }, [companies]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Avg. Growth: With vs. Without Real CFO
        </CardTitle>
        <p className="text-xs text-slate-500 mt-0.5">
          Avg. CAGR for companies with CFO/Finance Manager vs. without, by sector (top 12 by size).
          Global avg:{" "}
          <span className="text-emerald-600 font-medium">
            with CFO {formatGrowth(globalWith)}
          </span>
          {" · "}
          <span className="text-slate-500 font-medium">
            without {formatGrowth(globalNo)}
          </span>
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={380}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            barCategoryGap="35%"
            barGap={3}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="square"
              iconSize={10}
              formatter={(value) =>
                value === "avgWithCfo" ? "With Real CFO" : "Without Real CFO"
              }
              wrapperStyle={{ fontSize: 11, color: "#64748b" }}
            />
            <Bar
              dataKey="avgWithCfo"
              name="avgWithCfo"
              fill="#10b981"
              fillOpacity={0.85}
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="avgWithCfo"
                position="top"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => v != null ? `${Number(v).toFixed(0)}%` : ""}
                style={{ fontSize: 9, fill: "#064e3b" }}
              />
            </Bar>
            <Bar
              dataKey="avgNoCfo"
              name="avgNoCfo"
              fill="#94a3b8"
              fillOpacity={0.7}
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="avgNoCfo"
                position="top"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => v != null ? `${Number(v).toFixed(0)}%` : ""}
                style={{ fontSize: 9, fill: "#475569" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
