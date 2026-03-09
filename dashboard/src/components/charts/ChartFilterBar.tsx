"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { ChevronDown, X, SlidersHorizontal } from "lucide-react";
import type { Company, FilterState, CfoPresenceFilter } from "@/types";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface ChartFilterBarProps {
  companies: Company[];
  filters: FilterState;
  onChange: (f: FilterState) => void;
  filteredCount: number;
}

// ── Tiny multi-select dropdown ─────────────────────────────────────────────────
function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors",
          hasSelection
            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
        )}
      >
        <span>
          {hasSelection ? `${label} (${selected.length})` : label}
        </span>
        {hasSelection ? (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="ml-0.5 rounded-full hover:bg-indigo-100 p-0.5"
          >
            <X className="w-3 h-3" />
          </span>
        ) : (
          <ChevronDown className="w-3 h-3 opacity-50" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 min-w-[200px] max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt)}
                  className="accent-indigo-600 w-3.5 h-3.5 flex-shrink-0"
                />
                <span className="truncate text-slate-700">{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CFO presence toggle ────────────────────────────────────────────────────────
const CFO_OPTIONS: { value: CfoPresenceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "has", label: "With Real CFO" },
  { value: "no", label: "Without Real CFO" },
];

export default function ChartFilterBar({
  companies,
  filters,
  onChange,
  filteredCount,
}: ChartFilterBarProps) {
  const allSettori = useMemo(
    () => [...new Set(companies.map((c) => c.settore))].sort(),
    [companies]
  );
  const allRegioni = useMemo(
    () => [...new Set(companies.map((c) => c.regione))].sort(),
    [companies]
  );

  const active =
    filters.settori.length > 0 ||
    filters.regioni.length > 0 ||
    filters.hasRealCfoFilter !== "all" ||
    filters.minGrowth > 0 ||
    filters.maxGrowth < 600;

  function toggleSettore(v: string) {
    const next = filters.settori.includes(v)
      ? filters.settori.filter((s) => s !== v)
      : [...filters.settori, v];
    onChange({ ...filters, settori: next });
  }

  function toggleRegione(v: string) {
    const next = filters.regioni.includes(v)
      ? filters.regioni.filter((r) => r !== v)
      : [...filters.regioni, v];
    onChange({ ...filters, regioni: next });
  }

  function setCfoPresence(v: CfoPresenceFilter) {
    onChange({ ...filters, hasRealCfoFilter: v });
  }

  function clearAll() {
    onChange({ ...DEFAULT_FILTER_STATE });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Label */}
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mr-1">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters</span>
        </div>

        {/* Settore multi-select */}
        <MultiSelectDropdown
          label="Sector"
          options={allSettori}
          selected={filters.settori}
          onToggle={toggleSettore}
          onClear={() => onChange({ ...filters, settori: [] })}
        />

        {/* Regione multi-select */}
        <MultiSelectDropdown
          label="Region"
          options={allRegioni}
          selected={filters.regioni}
          onToggle={toggleRegione}
          onClear={() => onChange({ ...filters, regioni: [] })}
        />

        {/* CFO Presence toggle */}
        <div className="flex items-center rounded-md border border-slate-200 overflow-hidden bg-slate-50 h-8">
          {CFO_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setCfoPresence(opt.value)}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors",
                filters.hasRealCfoFilter === opt.value
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Spacer + result count + clear */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-slate-400">
            {filteredCount} / {companies.length} companies
          </span>
          {active && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
