"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FilterState, Confidenza } from "@/types";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";

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
    filters.cfoFoundOnly;

  function toggleSettore(s: string) {
    const next = filters.settori.includes(s)
      ? filters.settori.filter((x) => x !== s)
      : [...filters.settori, s];
    onChange({ ...filters, settori: next });
  }

  function toggleRegione(r: string) {
    const next = filters.regioni.includes(r)
      ? filters.regioni.filter((x) => x !== r)
      : [...filters.regioni, r];
    onChange({ ...filters, regioni: next });
  }

  function toggleConfidenza(c: Confidenza) {
    if (!c) return;
    const next = filters.confidenza.includes(c)
      ? filters.confidenza.filter((x) => x !== c)
      : [...filters.confidenza, c];
    onChange({ ...filters, confidenza: next });
  }

  function reset() {
    onChange({ ...DEFAULT_FILTER_STATE });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <Input
          placeholder="Search company or CFO name…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-64 h-8 text-sm bg-white"
        />

        {/* Sector */}
        <Select
          value=""
          onValueChange={(v) => {
            if (v && !filters.settori.includes(v))
              onChange({ ...filters, settori: [...filters.settori, v] });
          }}
        >
          <SelectTrigger className="w-48 h-8 text-sm bg-white">
            <SelectValue placeholder="Filter by sector" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {settori.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Region */}
        <Select
          value=""
          onValueChange={(v) => {
            if (v && !filters.regioni.includes(v))
              onChange({ ...filters, regioni: [...filters.regioni, v] });
          }}
        >
          <SelectTrigger className="w-44 h-8 text-sm bg-white">
            <SelectValue placeholder="Filter by region" />
          </SelectTrigger>
          <SelectContent>
            {regioni.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Confidence */}
        <div className="flex items-center gap-1">
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

        {/* CFO Found toggle */}
        <button
          onClick={() =>
            onChange({ ...filters, cfoFoundOnly: !filters.cfoFoundOnly })
          }
          className={`px-2.5 py-1 text-xs rounded-md border transition-all ${
            filters.cfoFoundOnly
              ? "bg-emerald-600 text-white border-emerald-600"
              : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400"
          }`}
        >
          Real CFO only
        </button>

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

      {/* Active filter chips */}
      {(filters.settori.length > 0 || filters.regioni.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {filters.settori.map((s) => (
            <Badge
              key={s}
              variant="secondary"
              className="text-xs pl-2 pr-1 py-0.5 gap-1 cursor-pointer hover:bg-slate-200"
              onClick={() => toggleSettore(s)}
            >
              {s}
              <X className="w-3 h-3" />
            </Badge>
          ))}
          {filters.regioni.map((r) => (
            <Badge
              key={r}
              variant="outline"
              className="text-xs pl-2 pr-1 py-0.5 gap-1 cursor-pointer hover:bg-slate-100"
              onClick={() => toggleRegione(r)}
            >
              {r}
              <X className="w-3 h-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
