"use client";

import { IMPORT_TARGET_FIELDS } from "@/lib/constants";
import type { ParsedField } from "@/types";

export interface MappingRow {
  sourceField: string;
  target: string | null;
  transform: string | null;
  confidence: number;
  sampleValue: unknown;
}

interface MappingTableProps {
  fields: ParsedField[];
  rows: MappingRow[];
  onChange: (sourceField: string, target: string | null) => void;
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8
      ? "bg-emerald-500"
      : confidence >= 0.5
      ? "bg-amber-400"
      : confidence > 0
      ? "bg-red-400"
      : "bg-slate-200";
  const label =
    confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : confidence > 0 ? "Low" : "—";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-xs text-slate-500 tabular-nums">
        {confidence > 0 ? `${Math.round(confidence * 100)}%` : label}
      </span>
    </span>
  );
}

function formatSampleValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 40 ? value.slice(0, 40) + "…" : value;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 40) + "…";
  return String(value);
}

export default function MappingTable({ fields, rows, onChange }: MappingTableProps) {
  const targetOptions = [
    { value: "__skip__", label: "— skip (do not import)" },
    ...Object.entries(IMPORT_TARGET_FIELDS).map(([k, v]) => ({
      value: k,
      label: v.label,
    })),
  ];

  // Count mapped vs total
  const mappedCount = rows.filter(
    (r) => r.target !== null && r.target !== "__skip__"
  ).length;

  // Detect conflicts: multiple source fields mapping to the same target
  const targetCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.target && r.target !== "__skip__" && !r.target.startsWith("extra_data")) {
      targetCounts.set(r.target, (targetCounts.get(r.target) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{mappedCount}</span> of{" "}
        <span className="font-semibold text-slate-700">{rows.length}</span> fields mapped
        automatically
      </p>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-500 w-[35%]">
                  Source field
                </th>
                <th className="text-left px-3 py-2 font-medium text-slate-500 w-[25%]">
                  Sample value
                </th>
                <th className="text-left px-3 py-2 font-medium text-slate-500 w-[30%]">
                  Maps to
                </th>
                <th className="text-left px-3 py-2 font-medium text-slate-500 w-[10%]">
                  Conf.
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isConflict =
                  row.target !== null &&
                  row.target !== "__skip__" &&
                  !row.target.startsWith("extra_data") &&
                  (targetCounts.get(row.target) ?? 0) > 1;

                const sampleField = fields.find((f) => f.name === row.sourceField);
                const sampleVal = formatSampleValue(sampleField?.sampleValue ?? row.sampleValue);

                return (
                  <tr
                    key={row.sourceField}
                    className={`border-b border-slate-100 last:border-0 ${
                      isConflict ? "bg-amber-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                    }`}
                  >
                    {/* Source field */}
                    <td className="px-3 py-2">
                      <span
                        className="font-mono text-slate-700 break-all"
                        title={row.sourceField}
                      >
                        {row.sourceField.length > 35
                          ? row.sourceField.slice(0, 35) + "…"
                          : row.sourceField}
                      </span>
                      {isConflict && (
                        <span className="ml-1 text-amber-600 text-[10px] font-medium">
                          ⚠ conflict
                        </span>
                      )}
                    </td>

                    {/* Sample value */}
                    <td className="px-3 py-2">
                      <span className="font-mono text-slate-400 break-all">{sampleVal}</span>
                    </td>

                    {/* Target select */}
                    <td className="px-3 py-2">
                      <select
                        value={row.target ?? "__skip__"}
                        onChange={(e) =>
                          onChange(row.sourceField, e.target.value === "__skip__" ? null : e.target.value)
                        }
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        {targetOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Confidence */}
                    <td className="px-3 py-2">
                      <ConfidenceDot confidence={row.confidence} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
