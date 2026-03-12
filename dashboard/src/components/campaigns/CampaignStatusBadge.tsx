"use client";

import { CAMPAIGN_STATUS_META } from "@/lib/constants";
import type { CampaignStatus } from "@/types";

interface Props {
  status: CampaignStatus;
  className?: string;
}

export default function CampaignStatusBadge({ status, className = "" }: Props) {
  const meta = CAMPAIGN_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.label}
    </span>
  );
}
