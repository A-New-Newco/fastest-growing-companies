"use client";

import { CONTACT_STATUS_META } from "@/lib/constants";
import type { ContactStatus } from "@/types";

interface Props {
  status: ContactStatus;
  className?: string;
}

export default function ContactStatusBadge({ status, className = "" }: Props) {
  const meta = CONTACT_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.label}
    </span>
  );
}
