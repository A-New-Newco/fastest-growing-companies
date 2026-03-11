"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTACT_STATUS_META } from "@/lib/constants";
import type { ContactStatus } from "@/types";

const ALL_STATUSES: ContactStatus[] = [
  "pending",
  "contacted",
  "replied",
  "meeting_scheduled",
  "converted",
  "not_interested",
  "no_reply",
];

interface Props {
  value: ContactStatus;
  onChange: (value: ContactStatus) => void;
  disabled?: boolean;
}

export default function ContactStatusSelect({ value, onChange, disabled }: Props) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ContactStatus)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 text-xs w-[150px] border-0 px-2 focus:ring-0">
        <SelectValue>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              color: CONTACT_STATUS_META[value].color,
              backgroundColor: CONTACT_STATUS_META[value].bg,
            }}
          >
            {CONTACT_STATUS_META[value].label}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ALL_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                color: CONTACT_STATUS_META[s].color,
                backgroundColor: CONTACT_STATUS_META[s].bg,
              }}
            >
              {CONTACT_STATUS_META[s].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
