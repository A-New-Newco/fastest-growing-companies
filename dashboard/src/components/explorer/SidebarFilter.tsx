"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FilterState, Confidenza, CfoPresenceFilter } from "@/types";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";
import MultiSelectFilter from "./MultiSelectFilter";

interface SidebarFilterProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  settori: string[];
  regioni: string[];
  resultCount: number;
  totalCount: number;
}

const CONFIDENCE_OPTIONS: { value: NonNullable<Confidenza>; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Med" },
  { value: "low", label: "Low" },
];

const CFO_PRESENCE_OPTIONS: { value: CfoPresenceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "has", label: "Has" },
  { value: "no", label: "No" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">
      {children}
    </p>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-slate-200 bg-white text-[11px] text-slate-700 max-w-full">
      <span className="truncate">{label}</span>
      <button onClick={onRemove} className="text-slate-400 hover:text-slate-700 flex-shrink-0">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

const MAX_VISIBLE_CHIPS = 3;

type Chip = { key: string; label: string; onRemove: () => void };

function ChipGroup({
  label,
  chips,
}: {
  label: string;
  chips: Chip[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (chips.length === 0) return null;

  const visible = expanded ? chips : chips.slice(0, MAX_VISIBLE_CHIPS);
  const hidden = chips.length - visible.length;

  return (
    <div className="space-y-1">
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map(({ key, label, onRemove }) => (
          <FilterChip key={key} label={label} onRemove={onRemove} />
        ))}
        {!expanded && hidden > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            +{hidden} more
          </button>
        )}
        {expanded && chips.length > MAX_VISIBLE_CHIPS && (
          <button
            onClick={() => setExpanded(false)}
            className="inline-flex items-center px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            Less
          </button>
        )}
      </div>
    </div>
  );
}

function ActiveChips({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const settoriChips: Chip[] = filters.settori.map((s) => ({
    key: `settore-${s}`,
    label: s,
    onRemove: () => onChange({ ...filters, settori: filters.settori.filter((x) => x !== s) }),
  }));

  const regioniChips: Chip[] = filters.regioni.map((r) => ({
    key: `regione-${r}`,
    label: r,
    onRemove: () => onChange({ ...filters, regioni: filters.regioni.filter((x) => x !== r) }),
  }));

  const otherChips: Chip[] = [];

  if (filters.search)
    otherChips.push({
      key: "search",
      label: `"${filters.search}"`,
      onRemove: () => onChange({ ...filters, search: "" }),
    });

  filters.confidenza.forEach((c) =>
    otherChips.push({
      key: `conf-${c}`,
      label: `Conf: ${c}`,
      onRemove: () =>
        onChange({ ...filters, confidenza: filters.confidenza.filter((x) => x !== c) }),
    })
  );

  if (filters.linkedinFilter !== "all")
    otherChips.push({
      key: "linkedin",
      label: `LinkedIn: ${filters.linkedinFilter}`,
      onRemove: () => onChange({ ...filters, linkedinFilter: "all" }),
    });

  if (filters.hasRealCfoFilter !== "all")
    otherChips.push({
      key: "cfo",
      label: `CFO: ${filters.hasRealCfoFilter}`,
      onRemove: () => onChange({ ...filters, hasRealCfoFilter: "all" }),
    });

  if (filters.minGrowth > 0 || filters.maxGrowth < 600)
    otherChips.push({
      key: "growth",
      label: `Growth: ${filters.minGrowth}–${filters.maxGrowth}%`,
      onRemove: () => onChange({ ...filters, minGrowth: 0, maxGrowth: 600 }),
    });

  if (filters.minRevenue > 0 || filters.maxRevenue > 0)
    otherChips.push({
      key: "revenue",
      label:
        filters.minRevenue > 0 && filters.maxRevenue > 0
          ? `Rev: €${filters.minRevenue}–${filters.maxRevenue}M`
          : filters.minRevenue > 0
          ? `Rev ≥ €${filters.minRevenue}M`
          : `Rev ≤ €${filters.maxRevenue}M`,
      onRemove: () => onChange({ ...filters, minRevenue: 0, maxRevenue: 0 }),
    });

  return (
    <div className="space-y-2 pt-1">
      <ChipGroup label="Sector" chips={settoriChips} />
      <ChipGroup label="Region" chips={regioniChips} />
      {otherChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {otherChips.map(({ key, label, onRemove }) => (
            <FilterChip key={key} label={label} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

const toggleBase = "flex-1 py-1.5 text-[11px] font-medium transition-colors";
const toggleInactive = "text-slate-500 hover:bg-slate-100";
const toggleRow = "flex rounded-md border border-slate-200 overflow-hidden bg-slate-50 w-full";

export default function SidebarFilter({
  filters,
  onChange,
  settori,
  regioni,
  resultCount,
  totalCount,
}: SidebarFilterProps) {
  const hasActive =
    filters.search !== "" ||
    filters.settori.length > 0 ||
    filters.regioni.length > 0 ||
    filters.confidenza.length > 0 ||
    filters.cfoFoundOnly ||
    filters.linkedinFilter !== "all" ||
    filters.hasRealCfoFilter !== "all" ||
    filters.minRevenue > 0 ||
    filters.maxRevenue > 0 ||
    filters.minGrowth > 0 ||
    filters.maxGrowth < 600;

  function toggleConfidenza(c: NonNullable<Confidenza>) {
    const next = filters.confidenza.includes(c)
      ? filters.confidenza.filter((x) => x !== c)
      : [...filters.confidenza, c];
    onChange({ ...filters, confidenza: next });
  }

  const numInputClass =
    "w-full h-8 px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-indigo-400 tabular-nums";

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Filters</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 tabular-nums">
            <span className="font-semibold text-slate-700">{resultCount}</span>
            {" / "}
            {totalCount}
          </span>
          {hasActive && (
            <button
              onClick={() => onChange({ ...DEFAULT_FILTER_STATE })}
              className="flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
            >
              <X className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div>
        <SectionLabel>Search</SectionLabel>
        <Input
          placeholder="Company or CFO name…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="h-8 text-xs bg-white w-full"
        />
      </div>

      {/* Sector */}
      <div>
        <SectionLabel>Sector</SectionLabel>
        <MultiSelectFilter
          label="All sectors"
          options={settori}
          selected={filters.settori}
          onChange={(v) => onChange({ ...filters, settori: v })}
          width="w-full"
        />
      </div>

      {/* Region */}
      <div>
        <SectionLabel>Region</SectionLabel>
        <MultiSelectFilter
          label="All regions"
          options={regioni}
          selected={filters.regioni}
          onChange={(v) => onChange({ ...filters, regioni: v })}
          width="w-full"
        />
      </div>

      <hr className="border-slate-100" />

      {/* Growth range */}
      <div>
        <SectionLabel>Growth CAGR (%)</SectionLabel>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={600}
            placeholder="Min"
            value={filters.minGrowth || ""}
            onChange={(e) =>
              onChange({ ...filters, minGrowth: Number(e.target.value) || 0 })
            }
            className={numInputClass}
          />
          <span className="text-slate-300 text-xs flex-shrink-0">–</span>
          <input
            type="number"
            min={0}
            max={600}
            placeholder="Max"
            value={filters.maxGrowth < 600 ? filters.maxGrowth : ""}
            onChange={(e) =>
              onChange({ ...filters, maxGrowth: Number(e.target.value) || 600 })
            }
            className={numInputClass}
          />
        </div>
      </div>

      {/* Revenue range */}
      <div>
        <SectionLabel>Revenue (€M)</SectionLabel>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            placeholder="Min"
            value={filters.minRevenue || ""}
            onChange={(e) =>
              onChange({ ...filters, minRevenue: Number(e.target.value) || 0 })
            }
            className={numInputClass}
          />
          <span className="text-slate-300 text-xs flex-shrink-0">–</span>
          <input
            type="number"
            min={0}
            placeholder="Max"
            value={filters.maxRevenue || ""}
            onChange={(e) =>
              onChange({ ...filters, maxRevenue: Number(e.target.value) || 0 })
            }
            className={numInputClass}
          />
        </div>
      </div>

      <hr className="border-slate-100" />

      {/* Confidence */}
      <div>
        <SectionLabel>Confidence</SectionLabel>
        <div className={toggleRow}>
          {CONFIDENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => toggleConfidenza(value)}
              className={`${toggleBase} ${
                filters.confidenza.includes(value)
                  ? "bg-indigo-600 text-white"
                  : toggleInactive
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* LinkedIn */}
      <div>
        <SectionLabel>LinkedIn</SectionLabel>
        <div className={toggleRow}>
          {CFO_PRESENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ ...filters, linkedinFilter: value })}
              className={`${toggleBase} ${
                filters.linkedinFilter === value
                  ? "bg-blue-600 text-white"
                  : toggleInactive
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Real CFO */}
      <div>
        <SectionLabel>Real CFO</SectionLabel>
        <div className={toggleRow}>
          {CFO_PRESENCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ ...filters, hasRealCfoFilter: value })}
              className={`${toggleBase} ${
                filters.hasRealCfoFilter === value
                  ? "bg-emerald-600 text-white"
                  : toggleInactive
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active chips */}
      {hasActive && <ActiveChips filters={filters} onChange={onChange} />}
    </div>
  );
}
