"use client";

import type { EnrichmentSessionStatus } from "@/types";

interface Props {
  status: EnrichmentSessionStatus;
  className?: string;
}

const STATUS_META: Record<EnrichmentSessionStatus, { label: string; color: string; bg: string; pulse?: boolean }> = {
  pending:   { label: "Pending",   color: "#475569", bg: "#f1f5f9" },
  running:   { label: "Running",   color: "#1d4ed8", bg: "#dbeafe", pulse: true },
  paused:    { label: "Paused",    color: "#92400e", bg: "#fef3c7" },
  completed: { label: "Completed", color: "#166534", bg: "#dcfce7" },
  failed:    { label: "Failed",    color: "#991b1b", bg: "#fee2e2" },
};

export default function SessionStatusBadge({ status, className = "" }: Props) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: meta.color }}
          />
          <span
            className="relative inline-flex rounded-full h-1.5 w-1.5"
            style={{ backgroundColor: meta.color }}
          />
        </span>
      )}
      {meta.label}
    </span>
  );
}
