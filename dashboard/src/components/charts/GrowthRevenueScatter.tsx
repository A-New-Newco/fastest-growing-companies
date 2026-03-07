"use client";

import { useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";
import { SECTOR_COLORS, DEFAULT_SECTOR_COLOR } from "@/lib/constants";
import { formatRevenue, formatGrowth } from "@/lib/data";

interface GrowthRevenueScatterProps {
  companies: Company[];
}

interface ScatterPoint {
  x: number; // log10(ricavi2024)
  y: number; // tassoCrescita
  azienda: string;
  settore: string;
  ricavi2024: number;
  tassoCrescita: number;
  color: string;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs max-w-[200px]">
      <p className="font-semibold text-slate-900 mb-1 leading-tight">{d.azienda}</p>
      <p className="text-slate-500 mb-1.5 leading-tight text-[11px]">{d.settore}</p>
      <div className="flex justify-between gap-4">
        <span className="text-slate-500">Growth</span>
        <span className="font-medium text-slate-900">{formatGrowth(d.tassoCrescita)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-slate-500">Revenue</span>
        <span className="font-medium text-slate-900">{formatRevenue(d.ricavi2024)}</span>
      </div>
    </div>
  );
}

export default function GrowthRevenueScatter({ companies }: GrowthRevenueScatterProps) {
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  // Group by sector for separate Scatter series (for color coding)
  const { points, topSectors } = useMemo(() => {
    const pts: ScatterPoint[] = companies
      .filter((c) => c.ricavi2024 > 0)
      .map((c) => ({
        x: Math.log10(c.ricavi2024),
        y: c.tassoCrescita,
        azienda: c.azienda,
        settore: c.settore,
        ricavi2024: c.ricavi2024,
        tassoCrescita: c.tassoCrescita,
        color: SECTOR_COLORS[c.settore] ?? DEFAULT_SECTOR_COLOR,
      }));

    // Top 8 sectors by count for legend
    const sectorCount = new Map<string, number>();
    for (const c of companies) {
      sectorCount.set(c.settore, (sectorCount.get(c.settore) ?? 0) + 1);
    }
    const top = [...sectorCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([s]) => s);

    return { points: pts, topSectors: top };
  }, [companies]);

  // X axis ticks for log scale (€1K, €10K, €100K, €1M, €100M, €1B)
  const xTicks = [3, 4, 5, 6, 7, 8]; // log10 of thousands: 1M, 10M, 100M, 1B, 10B
  const xTickLabels: Record<number, string> = {
    3: "€1M",
    4: "€10M",
    5: "€100M",
    6: "€1B",
    7: "€10B",
    8: "€100B",
  };

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Growth Rate vs Revenue 2024
        </CardTitle>
        <p className="text-xs text-slate-500">
          Each dot is one company. X axis is logarithmic. Color = sector.
        </p>
      </CardHeader>
      <CardContent>
        {/* Sector legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
          {topSectors.map((s) => (
            <button
              key={s}
              onMouseEnter={() => setHoveredSector(s)}
              onMouseLeave={() => setHoveredSector(null)}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: SECTOR_COLORS[s] ?? DEFAULT_SECTOR_COLOR,
                  opacity: hoveredSector && hoveredSector !== s ? 0.3 : 1,
                }}
              />
              <span
                style={{
                  opacity: hoveredSector && hoveredSector !== s ? 0.4 : 1,
                }}
              >
                {s.length > 28 ? s.slice(0, 26) + "…" : s}
              </span>
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              type="number"
              dataKey="x"
              name="Revenue"
              ticks={xTicks}
              tickFormatter={(v) => xTickLabels[v] ?? ""}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              label={{
                value: "Revenue 2024 (log scale)",
                position: "insideBottom",
                offset: -16,
                style: { fontSize: 11, fill: "#94a3b8" },
              }}
              domain={[2.8, 6.5]}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Growth"
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              label={{
                value: "Growth Rate (CAGR %)",
                angle: -90,
                position: "insideLeft",
                offset: 16,
                style: { fontSize: 11, fill: "#94a3b8" },
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter
              data={points}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const cx: number = props.cx;
                const cy: number = props.cy;
                const payload: ScatterPoint = props.payload;
                const dimmed =
                  hoveredSector !== null &&
                  hoveredSector !== payload.settore;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={payload.color}
                    fillOpacity={dimmed ? 0.08 : 0.7}
                    stroke={payload.color}
                    strokeOpacity={dimmed ? 0.1 : 0.3}
                    strokeWidth={1}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
