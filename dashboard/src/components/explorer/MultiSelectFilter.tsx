"use client";

import { useRef, useState, useEffect } from "react";
import { Check, ChevronDown, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: string[] | SelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  width?: string;
}

function normalizeOptions(options: string[] | SelectOption[]): SelectOption[] {
  if (options.length === 0) return [];
  return typeof options[0] === "string"
    ? (options as string[]).map((s) => ({ value: s, label: s }))
    : (options as SelectOption[]);
}

export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  width = "w-48",
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const normalized = normalizeOptions(options);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const allSelected =
    selected.length === normalized.length && normalized.length > 0;
  const someSelected = selected.length > 0 && !allSelected;

  function toggleAll() {
    onChange(allSelected ? [] : normalized.map((o) => o.value));
  }

  function toggle(v: string) {
    onChange(
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
    );
  }

  const selectedLabels = normalized
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  const triggerLabel =
    selected.length === 0
      ? label
      : selected.length === 1
      ? selectedLabels[0]
      : `${selected.length} selected`;

  return (
    <div className={`relative ${width}`} ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between h-8 px-3 rounded-md border transition-colors ${
          selected.length > 0
            ? "border-indigo-400 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
        }`}
      >
        <span className="truncate text-xs">{triggerLabel}</span>
        <div className="flex items-center gap-1 ml-1 flex-shrink-0">
          {selected.length > 0 && (
            <X
              className="w-3 h-3 opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-auto min-w-full">
          {/* Select All / Deselect All */}
          <button
            onClick={toggleAll}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-100"
          >
            <span
              className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${
                allSelected
                  ? "bg-indigo-600 border-indigo-600"
                  : "border-slate-300"
              }`}
            >
              {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
              {someSelected && (
                <span className="w-1.5 h-0.5 bg-indigo-400 rounded" />
              )}
            </span>
            <span className="font-medium">
              {allSelected ? "Deselect all" : "Select all"}
            </span>
          </button>

          {/* Options */}
          {normalized.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggle(opt.value)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              <span
                className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${
                  selected.includes(opt.value)
                    ? "bg-indigo-600 border-indigo-600"
                    : "border-slate-300"
                }`}
              >
                {selected.includes(opt.value) && (
                  <Check className="w-2.5 h-2.5 text-white" />
                )}
              </span>
              <span className="text-left line-clamp-1">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
