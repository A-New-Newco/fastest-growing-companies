"use client";

import { Users, Send, MessageSquare, TrendingUp } from "lucide-react";
import type { Campaign } from "@/types";

interface Props {
  campaign: Campaign;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

export default function CampaignStatsSummary({ campaign }: Props) {
  const total = campaign.totalContacts ?? 0;
  const contacted = campaign.contactedCount ?? 0;
  const replied = campaign.repliedCount ?? 0;
  const converted = campaign.convertedCount ?? 0;

  const replyRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
  const convRate = replied > 0 ? Math.round((converted / replied) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        icon={Users}
        label="Total Contacts"
        value={total}
        color="bg-slate-100 text-slate-600"
      />
      <StatCard
        icon={Send}
        label="Contacted"
        value={contacted}
        sub={total > 0 ? `${Math.round((contacted / total) * 100)}% of total` : undefined}
        color="bg-blue-50 text-blue-600"
      />
      <StatCard
        icon={MessageSquare}
        label="Replied"
        value={replied}
        sub={contacted > 0 ? `${replyRate}% reply rate` : undefined}
        color="bg-amber-50 text-amber-600"
      />
      <StatCard
        icon={TrendingUp}
        label="Converted"
        value={converted}
        sub={replied > 0 ? `${convRate}% conversion` : undefined}
        color="bg-green-50 text-green-600"
      />
    </div>
  );
}
