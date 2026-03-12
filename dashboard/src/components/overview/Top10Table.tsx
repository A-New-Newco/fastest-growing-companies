"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";
import { formatRevenue, formatGrowth } from "@/lib/data";
import { ROLE_CATEGORY_META } from "@/lib/constants";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Top10TableProps {
  companies: Company[];
}

export default function Top10Table({ companies }: Top10TableProps) {
  const top10 = useMemo(
    () => [...companies].sort((a, b) => a.rank - b.rank).slice(0, 10),
    [companies]
  );

  if (top10.length === 0) return null;

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900">
          Top 10 by Growth Rate
        </CardTitle>
        <p className="text-xs text-slate-500">
          CAGR 2021 → 2024 — Source: Il Sole 24 Ore, Leaders of Growth 2026
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-12">
                  #
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Company
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">
                  Sector
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">
                  Region
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Growth
                </th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">
                  Revenue '24
                </th>
                <th className="text-left px-3 py-2.5 pr-5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden xl:table-cell">
                  CFO Role
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {top10.map((c, i) => {
                const roleMeta = ROLE_CATEGORY_META[c.cfoRuoloCategory];
                return (
                  <tr
                    key={c.rank}
                    className="hover:bg-slate-50/70 transition-colors group"
                  >
                    <td className="px-5 py-3 text-xs font-mono font-semibold text-slate-400">
                      {c.rank}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-900 truncate max-w-[160px]">
                          {c.azienda}
                        </span>
                        {c.sitoWeb && c.sitoWeb !== "n/a" && (
                          <a
                            href={c.sitoWeb}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-500"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-xs hidden md:table-cell truncate max-w-[140px]">
                      {c.settore}
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-xs hidden lg:table-cell">
                      {c.regione}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatGrowth(c.tassoCrescita)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 text-xs tabular-nums hidden sm:table-cell">
                      {formatRevenue(c.ricavi2024)}
                    </td>
                    <td className="px-3 py-3 pr-5 hidden xl:table-cell">
                      {c.cfoRuoloCategory !== "Not Found" ? (
                        c.cfoRuolo ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium cursor-help"
                                  style={{
                                    backgroundColor: roleMeta.color + "1a",
                                    color: roleMeta.color,
                                  }}
                                >
                                  {roleMeta.label}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{c.cfoRuolo}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{
                              backgroundColor: roleMeta.color + "1a",
                              color: roleMeta.color,
                            }}
                          >
                            {roleMeta.label}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
