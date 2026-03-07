"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";

interface Props {
  companies: Company[];
}

interface BarDatum {
  settore: string;
  label: string;
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
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs max-w-[220px]">
      <p className="font-semibold text-slate-900 mb-2 leading-tight">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Con CFO reale
          </span>
          <span className="font-medium text-slate-900">
            {d?.hasCfo} ({d?.pct.toFixed(0)}%)
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
            Senza CFO reale
          </span>
          <span className="font-medium text-slate-900">{d?.noCfo}</span>
        </div>
        <div className="flex justify-between gap-6 pt-1 border-t border-slate-100 mt-1">
          <span className="text-slate-500">Totale</span>
          <span className="font-medium text-slate-900">{d?.total}</span>
        </div>
      </div>
    </div>
  );
}

export default function CfoPresenceBySettore({ companies }: Props) {
  const [showPct, setShowPct] = useState(false);

  const data = useMemo<BarDatum[]>(() => {
    const map = new Map<string, { hasCfo: number; noCfo: number }>();
    for (const c of companies) {
      const entry = map.get(c.settore) ?? { hasCfo: 0, noCfo: 0 };
      if (c.hasRealCfo) entry.hasCfo++;
      else entry.noCfo++;
      map.set(c.settore, entry);
    }
    return [...map.entries()]
      .map(([settore, { hasCfo, noCfo }]) => {
        const total = hasCfo + noCfo;
        const pct = total > 0 ? (hasCfo / total) * 100 : 0;
        // Truncate long sector names for axis
        const label =
          settore.length > 30 ? settore.slice(0, 28) + "…" : settore;
        return { settore, label, hasCfo, noCfo, total, pct };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [companies]);

  const yKey = showPct ? "pct" : "total";

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900">
              CFO Presence per Settore
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Aziende con CFO/Finance Manager reale vs. senza, per settore.
              Ordinato per tasso di presenza CFO.
            </p>
          </div>
          <div className="flex items-center rounded-md border border-slate-200 overflow-hidden bg-slate-50 h-7 flex-shrink-0">
            {["#", "%"].map((v) => (
              <button
                key={v}
                onClick={() => setShowPct(v === "%")}
                className={`px-2.5 h-full text-xs font-medium transition-colors ${
                  (v === "%") === showPct
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
            Con CFO reale
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-200 inline-block" />
            Senza CFO reale
          </span>
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            barCategoryGap="30%"
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
              tickFormatter={showPct ? (v) => `${v.toFixed(0)}%` : undefined}
            />
            <Tooltip content={<CustomTooltip />} />
            {showPct ? (
              <Bar dataKey="pct" stackId="a" radius={[4, 4, 0, 0]}>
                {data.map((entry) => (
                  <Cell key={entry.settore} fill="#10b981" fillOpacity={0.85} />
                ))}
                <LabelList
                  dataKey="pct"
                  position="top"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => `${Number(v).toFixed(0)}%`}
                  style={{ fontSize: 9, fill: "#64748b" }}
                />
              </Bar>
            ) : (
              <>
                <Bar dataKey="hasCfo" stackId="a" fill="#10b981" fillOpacity={0.85} name="Con CFO reale" />
                <Bar dataKey="noCfo" stackId="a" fill="#e2e8f0" name="Senza CFO reale" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="total"
                    position="top"
                    style={{ fontSize: 9, fill: "#94a3b8" }}
                  />
                </Bar>
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
