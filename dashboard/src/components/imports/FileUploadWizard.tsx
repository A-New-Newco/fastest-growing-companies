"use client";

import { useReducer, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { parseFileSample, detectFormat } from "@/lib/file-parser";
import { SUPPORTED_COUNTRIES } from "@/lib/constants";
import MappingTable, { type MappingRow } from "./MappingTable";
import type { ParseResult } from "@/types";
import { cn } from "@/lib/utils";

// ── State machine ──────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface WizardState {
  step: Step;
  // Step 1
  file: File | null;
  format: "json" | "jsonl" | "csv" | null;
  parseResult: ParseResult | null;
  parseError: string | null;
  countryCode: string;
  year: string;
  sourceName: string;
  isDragging: boolean;
  // Step 2
  batchId: string | null;
  fieldMappingId: string | null;
  fileKey: string | null;
  mappingRows: MappingRow[];
  mappingLoading: boolean;
  mappingError: string | null;
  llmNotes: string | null;
  // Step 3
  importing: boolean;
  importedCount: number;
  skippedCount: number;
  totalRecords: number;
  importError: string | null;
  importErrors: string[]; // batch-level errors from the run route
}

type Action =
  | { type: "DRAG_ENTER" }
  | { type: "DRAG_LEAVE" }
  | { type: "FILE_SELECTED"; file: File; format: "json" | "jsonl" | "csv"; parseResult: ParseResult }
  | { type: "PARSE_ERROR"; error: string }
  | { type: "COUNTRY_CHANGED"; value: string }
  | { type: "YEAR_CHANGED"; value: string }
  | { type: "SOURCE_NAME_CHANGED"; value: string }
  | { type: "MAPPING_LOADING" }
  | { type: "MAPPING_LOADED"; batchId: string; fieldMappingId: string; fileKey: string; rows: MappingRow[]; sourceName: string; llmNotes: string | null }
  | { type: "MAPPING_ERROR"; error: string }
  | { type: "FIELD_CHANGED"; sourceField: string; target: string | null }
  | { type: "IMPORT_STARTED" }
  | { type: "IMPORT_DONE"; importedCount: number; skippedCount: number; totalRecords: number; errors: string[] }
  | { type: "IMPORT_ERROR"; error: string }
  | { type: "RESET" };

function initialState(): WizardState {
  return {
    step: 1,
    file: null,
    format: null,
    parseResult: null,
    parseError: null,
    countryCode: "DE",
    year: String(new Date().getFullYear()),
    sourceName: "",
    isDragging: false,
    batchId: null,
    fieldMappingId: null,
    fileKey: null,
    mappingRows: [],
    mappingLoading: false,
    mappingError: null,
    llmNotes: null,
    importing: false,
    importedCount: 0,
    skippedCount: 0,
    totalRecords: 0,
    importError: null,
    importErrors: [],
  };
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "DRAG_ENTER":    return { ...state, isDragging: true };
    case "DRAG_LEAVE":    return { ...state, isDragging: false };
    case "FILE_SELECTED": return {
      ...state, isDragging: false,
      file: action.file, format: action.format,
      parseResult: action.parseResult, parseError: null,
    };
    case "PARSE_ERROR":  return { ...state, isDragging: false, parseError: action.error, file: null };
    case "COUNTRY_CHANGED": return { ...state, countryCode: action.value };
    case "YEAR_CHANGED":    return { ...state, year: action.value };
    case "SOURCE_NAME_CHANGED": return { ...state, sourceName: action.value };
    case "MAPPING_LOADING": return { ...state, step: 2, mappingLoading: true, mappingError: null };
    case "MAPPING_LOADED":  return {
      ...state, mappingLoading: false,
      batchId: action.batchId,
      fieldMappingId: action.fieldMappingId,
      fileKey: action.fileKey,
      mappingRows: action.rows,
      sourceName: state.sourceName || action.sourceName,
      llmNotes: action.llmNotes,
    };
    case "MAPPING_ERROR":   return { ...state, step: 1, mappingLoading: false, mappingError: action.error };
    case "FIELD_CHANGED":   return {
      ...state,
      mappingRows: state.mappingRows.map((r) =>
        r.sourceField === action.sourceField ? { ...r, target: action.target } : r
      ),
    };
    case "IMPORT_STARTED":  return { ...state, step: 3, importing: true, importError: null };
    case "IMPORT_DONE":     return {
      ...state, importing: false,
      importedCount: action.importedCount,
      skippedCount: action.skippedCount,
      totalRecords: action.totalRecords,
      importErrors: action.errors,
    };
    case "IMPORT_ERROR":    return { ...state, importing: false, importError: action.error };
    case "RESET":           return initialState();
    default:               return state;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface FileUploadWizardProps {
  open: boolean;
  onClose: () => void;
  onImportComplete: (importedCount: number) => void;
}

export default function FileUploadWizard({ open, onClose, onImportComplete }: FileUploadWizardProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFile(file: File) {
    const format = detectFormat(file.name);
    if (!format) {
      dispatch({ type: "PARSE_ERROR", error: "Unsupported format. Use .json, .jsonl, or .csv" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      dispatch({ type: "PARSE_ERROR", error: "File too large (max 10 MB)" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        const parseResult = parseFileSample(text, format);
        dispatch({ type: "FILE_SELECTED", file, format, parseResult });
      } catch (err) {
        dispatch({ type: "PARSE_ERROR", error: String(err) });
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dispatch({ type: "DRAG_LEAVE" });
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleAnalyze() {
    if (!state.file || !state.format || !state.parseResult) return;
    if (!state.countryCode || !state.year) return;

    dispatch({ type: "MAPPING_LOADING" });

    try {
      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("country_code", state.countryCode);
      formData.append("year", state.year);
      if (state.sourceName) formData.append("source_name", state.sourceName);

      const res = await fetch("/api/imports", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        dispatch({ type: "MAPPING_ERROR", error: err.error ?? "Upload failed" });
        return;
      }

      const data = await res.json();
      const { batchId, fieldMappingId, fileKey, sourceName, fieldMapping, totalRows } = data;

      // Convert JSONB mapping to MappingRow[]
      const rows: MappingRow[] = Object.entries(
        fieldMapping.mapping as Record<string, { target: string | null; transform: string | null; confidence: number }>
      ).map(([sourceField, entry]) => ({
        sourceField,
        target: entry.target,
        transform: entry.transform,
        confidence: entry.confidence ?? 0,
        sampleValue: state.parseResult!.fields.find((f) => f.name === sourceField)?.sampleValue ?? null,
      }));

      // Add any fields not in the mapping
      for (const field of state.parseResult!.fields) {
        if (!rows.find((r) => r.sourceField === field.name)) {
          rows.push({
            sourceField: field.name,
            target: null,
            transform: null,
            confidence: 0,
            sampleValue: field.sampleValue,
          });
        }
      }

      dispatch({
        type: "MAPPING_LOADED",
        batchId, fieldMappingId, fileKey,
        rows,
        sourceName: sourceName ?? "",
        llmNotes: fieldMapping.llmNotes ?? null,
      });
    } catch (e) {
      dispatch({ type: "MAPPING_ERROR", error: String(e) });
    }
  }

  async function handleConfirmImport() {
    if (!state.batchId || !state.fieldMappingId || !state.fileKey) return;
    dispatch({ type: "IMPORT_STARTED" });

    try {
      // 1. Save approved mapping
      const confirmRes = await fetch(`/api/imports/${state.batchId}/mapping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldMappingId: state.fieldMappingId,
          mapping: Object.fromEntries(
            state.mappingRows.map((r) => [
              r.sourceField,
              { target: r.target, transform: r.transform },
            ])
          ),
          sourceName: state.sourceName || undefined,
        }),
      });

      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        dispatch({ type: "IMPORT_ERROR", error: err.error ?? "Failed to confirm mapping" });
        return;
      }

      // 2. Run import
      const runRes = await fetch(`/api/imports/${state.batchId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldMappingId: state.fieldMappingId,
          fileKey: state.fileKey,
        }),
      });

      if (!runRes.ok) {
        const err = await runRes.json();
        dispatch({ type: "IMPORT_ERROR", error: err.error ?? "Import failed" });
        return;
      }

      const result = await runRes.json();
      dispatch({
        type: "IMPORT_DONE",
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        totalRecords: result.totalRecords,
        errors: result.errors ?? [],
      });
    } catch (e) {
      dispatch({ type: "IMPORT_ERROR", error: String(e) });
    }
  }

  function handleClose() {
    if (state.step === 3 && !state.importing && state.importedCount > 0) {
      onImportComplete(state.importedCount);
    }
    dispatch({ type: "RESET" });
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const canAnalyze =
    !!state.file &&
    state.countryCode.length === 2 &&
    state.year.length === 4 &&
    !isNaN(parseInt(state.year));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-900">
            {state.step === 1 && "Import company data"}
            {state.step === 2 && "Review field mapping"}
            {state.step === 3 && (state.importing ? "Importing…" : "Import complete")}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-1">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors",
                  state.step === s
                    ? "bg-indigo-600 text-white"
                    : state.step > s
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-100 text-slate-400"
                )}
              >
                {state.step > s ? "✓" : s}
              </div>
              {s < 3 && <div className={cn("h-px w-8 transition-colors", state.step > s ? "bg-emerald-400" : "bg-slate-200")} />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Upload ── */}
        {state.step === 1 && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); dispatch({ type: "DRAG_ENTER" }); }}
              onDragLeave={() => dispatch({ type: "DRAG_LEAVE" })}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                state.isDragging
                  ? "border-indigo-400 bg-indigo-50"
                  : state.file
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.jsonl,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {state.file ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  <p className="font-medium text-slate-700 text-sm">{state.file.name}</p>
                  <p className="text-xs text-slate-400">
                    {state.format?.toUpperCase()} · {state.parseResult?.totalRows.toLocaleString()} records detected
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Drop file here or click to browse</p>
                  <p className="text-xs text-slate-400">.json, .jsonl, .csv · max 10 MB</p>
                </div>
              )}
            </div>

            {state.parseError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {state.parseError}
              </div>
            )}

            {/* Source info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Country *</label>
                <select
                  value={state.countryCode}
                  onChange={(e) => dispatch({ type: "COUNTRY_CHANGED", value: e.target.value })}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {SUPPORTED_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
                  ))}
                  <option value="__custom__">Other…</option>
                </select>
                {state.countryCode === "__custom__" && (
                  <input
                    type="text"
                    placeholder="ISO code (e.g. SE)"
                    maxLength={2}
                    className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 uppercase focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    onChange={(e) => dispatch({ type: "COUNTRY_CHANGED", value: e.target.value.toUpperCase() })}
                  />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Year *</label>
                <input
                  type="number"
                  value={state.year}
                  min={2000}
                  max={2100}
                  onChange={(e) => dispatch({ type: "YEAR_CHANGED", value: e.target.value })}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </div>

            {state.mappingError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {state.mappingError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleAnalyze}
                disabled={!canAnalyze || state.mappingLoading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {state.mappingLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Analyzing…</>
                ) : (
                  "Analyze ▶"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Mapping review ── */}
        {state.step === 2 && (
          <div className="space-y-4">
            {state.mappingLoading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm text-slate-500">Analyzing file structure with AI…</p>
              </div>
            ) : (
              <>
                {/* Source name */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Source name (slug)</label>
                  <input
                    type="text"
                    value={state.sourceName}
                    placeholder="e.g. wachstumschampions_2026"
                    onChange={(e) => dispatch({ type: "SOURCE_NAME_CHANGED", value: e.target.value })}
                    className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                {state.llmNotes && (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2 italic">
                    AI note: {state.llmNotes}
                  </p>
                )}

                <MappingTable
                  fields={state.parseResult?.fields ?? []}
                  rows={state.mappingRows}
                  onChange={(sourceField, target) =>
                    dispatch({ type: "FIELD_CHANGED", sourceField, target })
                  }
                />

                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: "RESET" })}
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmImport}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    Confirm & Import ▶
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 3: Import progress / done ── */}
        {state.step === 3 && (
          <div className="space-y-4 py-4">
            {state.importing ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm text-slate-600">
                  Importing {state.parseResult?.totalRows.toLocaleString()} companies…
                </p>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-indigo-500 h-1.5 rounded-full w-1/3 animate-pulse" />
                </div>
              </div>
            ) : state.importError ? (
              <div className="flex flex-col items-center gap-3">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-600">{state.importError}</p>
                <Button variant="outline" size="sm" onClick={() => dispatch({ type: "RESET" })}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                <div className="text-center">
                  <p className="text-base font-semibold text-slate-800">
                    {state.importedCount.toLocaleString()} companies imported
                  </p>
                  {state.skippedCount > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {state.skippedCount} skipped (duplicates or errors)
                    </p>
                  )}
                  {state.importErrors.length > 0 && (
                    <div className="mt-2 max-w-md text-left">
                      {state.importErrors.map((err, i) => (
                        <p key={i} className="text-[11px] text-red-500 font-mono break-all">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-1.5 rounded-full transition-all"
                    style={{
                      width: `${state.totalRecords > 0 ? Math.round((state.importedCount / state.totalRecords) * 100) : 100}%`,
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleClose}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white mt-2"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Close & view in Explorer
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
