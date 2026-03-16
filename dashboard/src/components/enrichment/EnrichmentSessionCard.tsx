"use client";

import Link from "next/link";
import { ArrowRight, Calendar, Building2, UserSearch, Linkedin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import SessionStatusBadge from "./SessionStatusBadge";
import TokenUsageBadge from "./TokenUsageBadge";
import type { EnrichmentSession } from "@/types";

interface Props {
  session: EnrichmentSession;
}

export default function EnrichmentSessionCard({ session }: Props) {
  const total = session.totalCompanies;
  const completed = session.completedCount;
  const found = session.foundCount;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Link href={`/enrichment/${session.id}`} className="group block">
      <Card className="h-full border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all duration-150">
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {session.enrichmentCategory === "linkedin" ? (
                  <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 uppercase tracking-wide shrink-0">
                    <Linkedin className="w-2.5 h-2.5" /> LinkedIn
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 uppercase tracking-wide shrink-0">
                    <UserSearch className="w-2.5 h-2.5" /> CFO
                  </span>
                )}
                <h3 className="font-semibold text-slate-900 text-sm leading-tight truncate group-hover:text-indigo-600 transition-colors">
                  {session.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <TokenUsageBadge tokensTotal={session.tokensTotal} />
              </div>
            </div>
            <SessionStatusBadge status={session.status} className="shrink-0" />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-100">
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-900 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500">Total</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-900 tabular-nums">{completed}</p>
              <p className="text-xs text-slate-500">Done</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-emerald-600 tabular-nums">{found}</p>
              <p className="text-xs text-slate-500">Found</p>
            </div>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {completed}/{total} processed
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(session.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
