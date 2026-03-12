"use client";

import Link from "next/link";
import { Users, ArrowRight, MessageSquare, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import CampaignStatusBadge from "./CampaignStatusBadge";
import type { Campaign } from "@/types";

interface Props {
  campaign: Campaign;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

export default function CampaignCard({ campaign }: Props) {
  const total = campaign.totalContacts ?? 0;
  const contacted = campaign.contactedCount ?? 0;
  const replied = campaign.repliedCount ?? 0;
  const converted = campaign.convertedCount ?? 0;

  const contactedPct = total > 0 ? Math.round((contacted / total) * 100) : 0;

  return (
    <Link href={`/campaigns/${campaign.id}`} className="group block">
      <Card className="h-full border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all duration-150">
        <CardContent className="p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 text-sm leading-tight truncate group-hover:text-indigo-600 transition-colors">
                {campaign.name}
              </h3>
              {campaign.description && (
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                  {campaign.description}
                </p>
              )}
            </div>
            <CampaignStatusBadge status={campaign.status} className="shrink-0" />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 py-3 border-y border-slate-100">
            <Stat label="Total" value={total} />
            <Stat label="Contacted" value={contacted} />
            <Stat label="Replied" value={replied} />
            <Stat label="Converted" value={converted} />
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {contacted}/{total} contacted
                </span>
                <span>{contactedPct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${contactedPct}%` }}
                />
              </div>
            </div>
          )}

          {total === 0 && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" />
              No contacts added yet
            </p>
          )}

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(campaign.createdAt).toLocaleDateString("en-GB", {
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
