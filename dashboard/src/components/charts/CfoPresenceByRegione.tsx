"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";

interface Props {
  companies: Company[];
}

interface BarDatum {
  regione: string;
  hasCfo: number;
  noCfo: number;
  total: number;
  pct: number;
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
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs">
      <p className="font-semibold text-slate-900 mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            With Real CFO
          </span>
          <span className="font-medium text-slate-900">
            {d?.hasCfo} ({d?.pct.toFixed(0)}%)
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
            Without
          </span>
          <span className="font-medium text-slate-900">{d?.noCfo}</span>
        </div>
        <div className="flex justify-between gap-6 pt-1 border-t border-slate-100">
          <span className="text-slate-500">Total</span>
          <span className="font-medium text-slate-900">{d?.total}</span>
        </div>
      </div>
    </div>
  );
}

export default function CfoPresenceByRegione({ companies }: Props) {
  const data = useMemo<BarDatum[]>(() => {
    const map = new Map<string, { hasCfo: number; noCfo: number }>();
    for (const c of companies) {
      const entry = map.get(c.regione) ?? { hasCfo: 0, noCfo: 0 };
      if (c.hasRealCfo) entry.hasCfo++;
      else entry.noCfo++;
      map.set(c.regione, entry);
    }
    return [...map.entries()]
      .map(([regione, { hasCfo, noCfo }]) => {
        const total = hasCfo + noCfo;
        const pct = total > 0 ? (hasCfo / total) * 100 : 0;
        return { regione, hasCfo, noCfo, total, pct };
      })
      .sort((a, b) => b.total - a.total);
  }, [companies]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          CFO Presence by Region
        </CardTitle>
        <p className="text-xs text-slate-500 mt-0.5">
          Companies with a real CFO/Finance Manager by Italian region.
          Sorted by total company count.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            With Real CFO
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-200 inline-block" />
            Without Real CFO
          </span>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(320, data.length * 32)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 60, bottom: 4, left: 8 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="regione"
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
              width={130}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="hasCfo" stackId="a" fill="#10b981" fillOpacity={0.85} name="With Real CFO" />
            <Bar dataKey="noCfo" stackId="a" fill="#e2e8f0" name="Without Real CFO" radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="total"
                position="right"
                style={{ fontSize: 10, fill: "#94a3b8" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
