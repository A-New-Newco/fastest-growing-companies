"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { FilterState, Confidenza, CfoPresenceFilter } from "@/types";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";
import MultiSelectFilter from "./MultiSelectFilter";

function FilterChip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full border border-slate-200 bg-white text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-800 font-medium max-w-[160px] truncate">
        {value}
      </span>
      <button
        onClick={onRemove}
        className="text-slate-400 hover:text-slate-700 transition-colors ml-0.5"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  settori: string[];
  regioni: string[];
  resultCount: number;
  totalCount: number;
}

const CONFIDENCE_OPTIONS: { value: Confidenza; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const CFO_PRESENCE_OPTIONS: { value: CfoPresenceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "has", label: "Has" },
  { value: "no", label: "No" },
];

export default function FilterBar({
  filters,
  onChange,
  settori,
  regioni,
  resultCount,
  totalCount,
}: FilterBarProps) {
  const hasActiveFilters =
    filters.search !== "" ||
    filters.settori.length > 0 ||
    filters.regioni.length > 0 ||
    filters.confidenza.length > 0 ||
    filters.cfoFoundOnly ||
    filters.linkedinFilter !== "all" ||
    filters.hasRealCfoFilter !== "all" ||
    filters.minRevenue > 0 ||
    filters.maxRevenue > 0;

  function toggleConfidenza(c: Confidenza) {
    if (!c) return;
    const next = filters.confidenza.includes(c)
      ? filters.confidenza.filter((x) => x !== c)
      : [...filters.confidenza, c];
    onChange({ ...filters, confidenza: next });
  }

  function reset() {
    onChange({ ...DEFAULT_FILTER_STATE, country: filters.country });
  }

  return (
    <div className="space-y-3">
      {/* Row 1: search + dropdowns + result count */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <Input
          placeholder="Search company or CFO name…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-64 h-8 text-sm bg-white"
        />

        {/* Sector multi-select */}
        <MultiSelectFilter
          label="Filter by sector"
          options={settori}
          selected={filters.settori}
          onChange={(v) => onChange({ ...filters, settori: v })}
          width="w-52"
        />

        {/* Region multi-select */}
        <MultiSelectFilter
          label="Filter by region"
          options={regioni}
          selected={filters.regioni}
          onChange={(v) => onChange({ ...filters, regioni: v })}
          width="w-44"
        />

        {/* Revenue range inputs */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">Revenue (€M)</span>
          <input
            type="number"
            min={0}
            placeholder="Min"
            value={filters.minRevenue || ""}
            onChange={(e) =>
              onChange({ ...filters, minRevenue: Number(e.target.value) || 0 })
            }
            className="w-20 h-8 px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-indigo-400"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="number"
            min={0}
            placeholder="Max"
            value={filters.maxRevenue || ""}
            onChange={(e) =>
              onChange({ ...filters, maxRevenue: Number(e.target.value) || 0 })
            }
            className="w-20 h-8 px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-indigo-400"
          />
        </div>

        {/* Reset */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="h-8 text-xs text-slate-500 hover:text-slate-900"
          >
            <X className="w-3 h-3 mr-1" />
            Reset
          </Button>
        )}

        {/* Result count */}
        <span className="ml-auto text-xs text-slate-500 tabular-nums">
          <span className="font-semibold text-slate-900">{resultCount}</span>
          {" / "}
          {totalCount} companies
        </span>
      </div>

      {/* Row 2: toggle filter groups */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
        {/* Confidence */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 mr-1">Confidence</span>
          {CONFIDENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => toggleConfidenza(value)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
                filters.confidenza.includes(value)
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-indigo-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* LinkedIn presence */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 mr-1">LinkedIn</span>
          {CFO_PRESENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ ...filters, linkedinFilter: value })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
                filters.linkedinFilter === value
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Real CFO presence */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400 mr-1">Real CFO</span>
          {CFO_PRESENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ ...filters, hasRealCfoFilter: value })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
                filters.hasRealCfoFilter === value
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

      </div>

      {/* Active filter summary chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5">
          {filters.search && (
            <FilterChip
              label="Search"
              value={`"${filters.search}"`}
              onRemove={() => onChange({ ...filters, search: "" })}
            />
          )}
          {filters.settori.length > 0 && (
            <FilterChip
              label="Sector"
              value={
                filters.settori.length === 1
                  ? filters.settori[0]
                  : `${filters.settori.length} selected`
              }
              onRemove={() => onChange({ ...filters, settori: [] })}
            />
          )}
          {filters.regioni.length > 0 && (
            <FilterChip
              label="Region"
              value={
                filters.regioni.length === 1
                  ? filters.regioni[0]
                  : `${filters.regioni.length} selected`
              }
              onRemove={() => onChange({ ...filters, regioni: [] })}
            />
          )}
          {filters.confidenza.length > 0 && (
            <FilterChip
              label="Confidence"
              value={filters.confidenza.join(", ")}
              onRemove={() => onChange({ ...filters, confidenza: [] })}
            />
          )}
          {filters.linkedinFilter !== "all" && (
            <FilterChip
              label="LinkedIn"
              value={filters.linkedinFilter === "has" ? "present" : "absent"}
              onRemove={() => onChange({ ...filters, linkedinFilter: "all" })}
            />
          )}
          {filters.hasRealCfoFilter !== "all" && (
            <FilterChip
              label="Real CFO"
              value={filters.hasRealCfoFilter === "has" ? "present" : "absent"}
              onRemove={() => onChange({ ...filters, hasRealCfoFilter: "all" })}
            />
          )}
          {(filters.minRevenue > 0 || filters.maxRevenue > 0) && (
            <FilterChip
              label="Revenue"
              value={
                filters.minRevenue > 0 && filters.maxRevenue > 0
                  ? `€${filters.minRevenue}M – €${filters.maxRevenue}M`
                  : filters.minRevenue > 0
                  ? `≥ €${filters.minRevenue}M`
                  : `≤ €${filters.maxRevenue}M`
              }
              onRemove={() =>
                onChange({ ...filters, minRevenue: 0, maxRevenue: 0 })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
