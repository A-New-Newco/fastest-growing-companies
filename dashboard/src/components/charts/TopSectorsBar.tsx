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
import { SECTOR_COLORS, DEFAULT_SECTOR_COLOR } from "@/lib/constants";

interface TopSectorsBarProps {
  companies: Company[];
}

export default function TopSectorsBar({ companies }: TopSectorsBarProps) {
  const data = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const c of companies) {
      if (!map.has(c.settore)) map.set(c.settore, []);
      map.get(c.settore)!.push(c.tassoCrescita);
    }
    return Array.from(map.entries())
      .map(([settore, rates]) => ({
        settore,
        avg: rates.reduce((a, b) => a + b, 0) / rates.length,
        count: rates.length,
        shortName:
          settore.length > 30 ? settore.slice(0, 28) + "…" : settore,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 15);
  }, [companies]);

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Top 15 Sectors by Avg. Growth Rate
        </CardTitle>
        <p className="text-xs text-slate-500">
          Average CAGR 2021→2024 per sector
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 40, bottom: 0, left: 160 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
            <XAxis
              type="number"
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="shortName"
              width={155}
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, _name: any, props: any) => [
                `${(value as number).toFixed(1)}% avg (${props?.payload?.count} companies)`,
                "Avg. Growth",
              ]}
              contentStyle={{
                fontSize: 12,
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                boxShadow: "0 1px 6px rgba(0,0,0,.08)",
              }}
              cursor={{ fill: "#f8fafc" }}
            />
            <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
              {data.map((entry) => (
                <Cell
                  key={entry.settore}
                  fill={SECTOR_COLORS[entry.settore] ?? DEFAULT_SECTOR_COLOR}
                  fillOpacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
