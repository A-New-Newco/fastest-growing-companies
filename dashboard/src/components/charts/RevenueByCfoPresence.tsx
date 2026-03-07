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

interface Props {
  companies: Company[];
}

interface BinDatum {
  bin: string;
  rangeLabel: string;
  hasCfo: number;
  noCfo: number;
  total: number;
}

// Log-scale revenue bins (ricavi in €k)
const BINS: { min: number; max: number; label: string }[] = [
  { min: 0, max: 1_000, label: "< €1M" },
  { min: 1_000, max: 5_000, label: "€1M–5M" },
  { min: 5_000, max: 10_000, label: "€5M–10M" },
  { min: 10_000, max: 25_000, label: "€10M–25M" },
  { min: 25_000, max: 50_000, label: "€25M–50M" },
  { min: 50_000, max: 100_000, label: "€50M–100M" },
  { min: 100_000, max: Infinity, label: "> €100M" },
];

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
  const d: BinDatum = payload[0]?.payload;
  const pct =
    d?.total > 0 ? ((d.hasCfo / d.total) * 100).toFixed(0) : "0";
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs">
      <p className="font-semibold text-slate-900 mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Con CFO reale
          </span>
          <span className="font-medium text-slate-900">
            {d?.hasCfo} ({pct}%)
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
            Senza CFO reale
          </span>
          <span className="font-medium text-slate-900">{d?.noCfo}</span>
        </div>
        <div className="flex justify-between gap-6 pt-1 border-t border-slate-100">
          <span className="text-slate-500">Totale</span>
          <span className="font-medium text-slate-900">{d?.total}</span>
        </div>
      </div>
    </div>
  );
}

export default function RevenueByCfoPresence({ companies }: Props) {
  const data = useMemo<BinDatum[]>(() => {
    return BINS.map((b) => {
      const inBin = companies.filter(
        (c) => c.ricavi2024 >= b.min && c.ricavi2024 < b.max
      );
      const hasCfo = inBin.filter((c) => c.hasRealCfo).length;
      const noCfo = inBin.length - hasCfo;
      return {
        bin: b.label,
        rangeLabel: b.label,
        hasCfo,
        noCfo,
        total: inBin.length,
      };
    }).filter((d) => d.total > 0);
  }, [companies]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Dimensione Ricavi vs. Presenza CFO (2024)
        </CardTitle>
        <p className="text-xs text-slate-500 mt-0.5">
          Distribuzione delle aziende per fascia di ricavi 2024, colorata per presenza di un CFO reale.
          Mostra a quale soglia di fatturato le aziende tendono a dotarsi di una funzione finanziaria dedicata.
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, bottom: 8, left: 8 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="bin"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="square"
              iconSize={10}
              formatter={(value) =>
                value === "hasCfo" ? "Con CFO reale" : "Senza CFO reale"
              }
              wrapperStyle={{ fontSize: 11, color: "#64748b" }}
            />
            <Bar dataKey="hasCfo" name="hasCfo" stackId="a" fill="#10b981" fillOpacity={0.85} />
            <Bar dataKey="noCfo" name="noCfo" stackId="a" fill="#94a3b8" fillOpacity={0.6} radius={[4, 4, 0, 0]}>
              <LabelList
                dataKey="total"
                position="top"
                style={{ fontSize: 10, fill: "#64748b" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
