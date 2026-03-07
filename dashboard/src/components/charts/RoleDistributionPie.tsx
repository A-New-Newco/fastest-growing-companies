"use client";

import { useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Linkedin } from "lucide-react";
import type { Company, RuoloCategory } from "@/types";
import { ROLE_CATEGORY_META } from "@/lib/constants";

interface RoleDistributionPieProps {
  companies: Company[];
}

interface PieSlice {
  category: RuoloCategory;
  count: number;
  pct: number;
  label: string;
  color: string;
}


export default function RoleDistributionPie({ companies }: RoleDistributionPieProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [modalCategory, setModalCategory] = useState<RuoloCategory | null>(null);

  const data: PieSlice[] = useMemo(() => {
    const total = companies.length;
    const map = new Map<RuoloCategory, number>();
    for (const c of companies) {
      map.set(c.cfoRuoloCategory, (map.get(c.cfoRuoloCategory) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([category, count]) => ({
        category,
        count,
        pct: (count / total) * 100,
        label: ROLE_CATEGORY_META[category].label,
        color: ROLE_CATEGORY_META[category].color,
      }))
      .sort((a, b) => b.count - a.count);
  }, [companies]);

  const modalCompanies = useMemo(() => {
    if (!modalCategory) return [];
    return companies.filter((c) => c.cfoRuoloCategory === modalCategory);
  }, [companies, modalCategory]);

  function handleSliceClick(entry: PieSlice) {
    setModalCategory(entry.category);
  }

  return (
    <>
      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-900">
            CFO Role Category Distribution
          </CardTitle>
          <p className="text-xs text-slate-500">
            Click any slice to see the list of companies in that category.
            <span className="ml-1 text-amber-600 font-medium">
              &quot;Other&quot; requires manual review.
            </span>
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row items-center gap-6">
            {/* Pie */}
            <div className="w-full lg:w-64 h-64 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    dataKey="count"
                    nameKey="label"
                    paddingAngle={1.5}
                    onMouseEnter={(_, i) => setActiveIndex(i)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onClick={(entry) => handleSliceClick(entry as unknown as PieSlice)}
                    style={{ cursor: "pointer" }}
                  >
                    {data.map((entry) => (
                      <Cell
                        key={entry.category}
                        fill={entry.color}
                        fillOpacity={
                          activeIndex === null || data[activeIndex]?.category === entry.category
                            ? 0.9
                            : 0.4
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, _name: any, props: any) => [
                      `${value} companies (${props?.payload?.pct?.toFixed(1)}%)`,
                      props?.payload?.label,
                    ]}
                    contentStyle={{
                      fontSize: 12,
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex-1 w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {data.map((entry, i) => (
                  <button
                    key={entry.category}
                    onClick={() => handleSliceClick(entry)}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseLeave={() => setActiveIndex(null)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700 truncate">
                          {entry.label}
                        </span>
                        <span className="text-xs tabular-nums text-slate-500 flex-shrink-0">
                          {entry.count}{" "}
                          <span className="text-slate-400">
                            ({entry.pct.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div
                        className="mt-1 h-1 rounded-full"
                        style={{
                          width: `${entry.pct}%`,
                          backgroundColor: entry.color,
                          opacity: 0.4,
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modal: companies in selected category */}
      <Dialog
        open={modalCategory !== null}
        onOpenChange={(open) => !open && setModalCategory(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{
                  backgroundColor: modalCategory
                    ? ROLE_CATEGORY_META[modalCategory].color
                    : "#94a3b8",
                }}
              />
              {modalCategory
                ? ROLE_CATEGORY_META[modalCategory].label
                : ""}
              <span className="text-sm font-normal text-slate-500">
                — {modalCompanies.length} companies
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 divide-y divide-slate-100">
            {modalCompanies.map((c) => (
              <div
                key={c.rank}
                className="py-2.5 flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span className="text-xs font-mono text-slate-400 w-8 flex-shrink-0 pt-0.5">
                    #{c.rank}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {c.azienda}
                    </p>
                    {c.cfoNome && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {c.cfoNome}
                        {c.cfoRuolo && (
                          <span className="ml-1 text-slate-400">
                            — {c.cfoRuolo}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {c.cfoLinkedin && (
                  <a
                    href={c.cfoLinkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    <Linkedin className="w-4 h-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
