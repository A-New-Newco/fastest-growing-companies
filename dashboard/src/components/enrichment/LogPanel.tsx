"use client";

import { useEffect, useRef } from "react";
import { Search, Globe, MessageSquare, CheckCircle } from "lucide-react";
import type { SSELogEntry } from "@/types";

interface Props {
  logs: SSELogEntry[];
  isLive?: boolean; // auto-scroll when true
}

const EVENT_ICONS = {
  search:  { icon: Search,        color: "text-blue-500",   label: "Search" },
  fetch:   { icon: Globe,         color: "text-purple-500", label: "Fetch" },
  think:   { icon: MessageSquare, color: "text-slate-400",  label: "Think" },
  result:  { icon: CheckCircle,   color: "text-emerald-500", label: "Result" },
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function getLogText(entry: SSELogEntry): string {
  if (entry.event === "search") return entry.data.query ?? "";
  if (entry.event === "fetch") return entry.data.url ?? "";
  return entry.data.text ?? "";
}

export default function LogPanel({ logs, isLive }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isLive]);

  if (logs.length === 0) {
    return <p className="text-xs text-slate-400 py-2 px-3">No logs yet.</p>;
  }

  return (
    <div className="max-h-48 overflow-y-auto font-mono text-xs bg-slate-950 rounded-b-md border-t border-slate-800">
      {logs.map((entry, i) => {
        const meta = EVENT_ICONS[entry.event] ?? EVENT_ICONS.think;
        const Icon = meta.icon;
        const text = getLogText(entry);

        return (
          <div
            key={i}
            className="flex items-start gap-2 px-3 py-1.5 border-b border-slate-800/50 last:border-0 hover:bg-slate-900/50"
          >
            <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${meta.color}`} />
            <span className="flex-1 text-slate-300 break-all leading-relaxed">{text}</span>
            <span className="text-slate-600 shrink-0 tabular-nums">{formatTime(entry.ts)}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
