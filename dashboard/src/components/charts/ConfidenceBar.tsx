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
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";

const CONF_META = [
  { key: "high", label: "High", color: "#16a34a" },
  { key: "medium", label: "Medium", color: "#d97706" },
  { key: "low", label: "Low", color: "#ea580c" },
  { key: "Not Found", label: "Not Found", color: "#94a3b8" },
];

interface ConfidenceBarProps {
  companies: Company[];
}

export default function ConfidenceBar({ companies }: ConfidenceBarProps) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {
      high: 0,
      medium: 0,
      low: 0,
      "Not Found": 0,
    };
    for (const c of companies) {
      if (c.confidenza) counts[c.confidenza]++;
      else counts["Not Found"]++;
    }
    return CONF_META.map(({ key, label, color }) => ({
      label,
      count: counts[key] ?? 0,
      pct: ((counts[key] ?? 0) / companies.length) * 100,
      color,
    }));
  }, [companies]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          CFO Search Confidence Distribution
        </CardTitle>
        <p className="text-xs text-slate-500">
          Confidence assigned by the enrichment agent per company
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, _name: any, props: any) => [
                `${value} companies (${(props?.payload?.pct ?? 0).toFixed(1)}%)`,
                "Count",
              ]}
              contentStyle={{
                fontSize: 12,
                border: "1px solid #e2e8f0",
                borderRadius: 6,
              }}
              cursor={{ fill: "#f8fafc" }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
