"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Linkedin,
  Download,
  Pencil,
  UserX,
  ThumbsDown,
  StickyNote,
  Plus,
  Trash2,
  X,
  Search,
  Loader2,
  Check,
  XCircle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Annotation, Company } from "@/types";
import { formatRevenue, formatGrowth } from "@/lib/data";
import { ROLE_CATEGORY_META, CONFIDENCE_META } from "@/lib/constants";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import AnnotationModal from "./AnnotationModal";
import AddToCampaignModal from "@/components/campaigns/AddToCampaignModal";
import AddToEnrichmentModal from "@/components/enrichment/AddToEnrichmentModal";
import LinkedInSearchModal from "@/components/linkedin/LinkedInSearchModal";
import { useRouter } from "next/navigation";
import { startLinkedinRun } from "@/lib/linkedin-enrichment-client";

const columnHelper = createColumnHelper<Company>();

interface CompanyTableProps {
  companies: Company[];
  onAnnotationSave?: (companyId: string, annotation: Omit<Annotation, "companyId">) => void;
  onCompaniesDeleted?: (companyIds: string[]) => void;
  onLinkedInUpdate?: (companyId: string, linkedinUrl: string) => void;
  onCompanyClick?: (company: Company) => void;
  // Selection mode (optional — campaigns feature)
  selectionMode?: boolean;
}

function exportToCsv(companies: Company[]) {
  const headers = [
    "Rank", "Company", "Country", "Source", "Sector", "Region", "Growth Rate (%)",
    "Revenue 2021 (K€)", "Revenue 2024 (K€)", "Website",
    "CFO Name", "CFO Role", "CFO Category", "CFO LinkedIn", "Confidence",
    "Contact Left", "Low Quality", "Note",
  ];
  const rows = companies.map((c) => [
    c.rank,
    c.azienda,
    c.country,
    c.sourceName ?? "",
    c.settore,
    c.regione,
    c.tassoCrescita,
    c.ricavi2021,
    c.ricavi2024,
    c.sitoWeb,
    c.cfoNome ?? "",
    c.cfoRuolo ?? "",
    ROLE_CATEGORY_META[c.cfoRuoloCategory].label,
    c.cfoLinkedin ?? "",
    c.confidenza ?? "",
    c.annotation?.contactLeft ? "yes" : "",
    c.annotation?.lowQuality ? "yes" : "",
    c.annotation?.note ?? "",
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fastest-growing-companies-${companies.length}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompanyTable({
  companies,
  onAnnotationSave,
  onCompaniesDeleted,
  onLinkedInUpdate,
  onCompanyClick,
  selectionMode = false,
}: CompanyTableProps) {
  const onCompanyClickRef = useRef(onCompanyClick);
  onCompanyClickRef.current = onCompanyClick;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);
  const [addToEnrichmentOpen, setAddToEnrichmentOpen] = useState(false);
  const [linkedInSearchOpen, setLinkedInSearchOpen] = useState(false);
  const [linkedInSearchingId, setLinkedInSearchingId] = useState<string | null>(null);
  const [linkedInRowResult, setLinkedInRowResult] = useState<Record<string, "found" | "not_found">>({});
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [sendingToAgent, setSendingToAgent] = useState(false);
  const router = useRouter();

  // Reset selection when companies change (e.g. filter applied)
  useEffect(() => {
    setRowSelection({});
  }, [companies]);

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  const selectedCompanies = useMemo(
    () => companies.filter((c) => rowSelection[c.id]),
    [companies, rowSelection]
  );
  const selectedImportedCompanies = useMemo(
    () => selectedCompanies.filter((c) => c.dataOrigin === "imported"),
    [selectedCompanies]
  );
  const selectedImportedIds = useMemo(
    () => selectedImportedCompanies.map((c) => c.id),
    [selectedImportedCompanies]
  );
  const selectedCuratedCount = selectedIds.length - selectedImportedIds.length;
  const allSelected = companies.length > 0 && selectedIds.length === companies.length;

  async function handleSendToLinkedinAgent() {
    const targets = selectedCompanies.filter((c) => c.cfoNome && !c.cfoLinkedin);
    if (targets.length === 0) return;
    setSendingToAgent(true);
    try {
      await startLinkedinRun({
        contacts: targets.map((c) => ({
          id: c.id,
          nome: c.cfoNome!,
          ruolo: c.cfoRuolo ?? undefined,
          azienda: c.azienda,
          sito_web: c.sitoWeb ?? undefined,
          data_origin: c.dataOrigin ?? "curated",
        })),
        max_concurrency: 8,
        reset: false,
      });
      router.push("/linkedin-monitor");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to send to LinkedIn agent");
    } finally {
      setSendingToAgent(false);
    }
  }

  async function handleDeleteSelectedCompanies() {
    if (selectedImportedIds.length === 0) {
      alert("Only imported companies can be deleted.");
      return;
    }

    const confirmationMessage =
      selectedCuratedCount > 0
        ? `Only imported companies can be deleted. Delete ${selectedImportedIds.length} imported selected companies?`
        : `Delete ${selectedImportedIds.length} selected compan${selectedImportedIds.length === 1 ? "y" : "ies"}?`;

    if (!confirm(confirmationMessage)) return;

    setDeletingSelected(true);

    try {
      const res = await fetch("/api/companies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyIds: selectedImportedIds }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to delete companies");
      }

      const result = await res.json();
      const deletedIds: string[] = Array.isArray(result.deletedIds)
        ? result.deletedIds
        : selectedImportedIds;

      onCompaniesDeleted?.(deletedIds);

      setRowSelection((prev) => {
        const next = { ...prev };
        for (const id of deletedIds) delete next[id];
        return next;
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete companies");
    } finally {
      setDeletingSelected(false);
    }
  }

  async function handleSingleLinkedInSearch(company: Company) {
    if (!company.cfoNome) return;
    setLinkedInSearchingId(company.id);
    try {
      const res = await fetch("/api/linkedin-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          companyName: company.azienda,
          contactName: company.cfoNome,
          dataOrigin: company.dataOrigin,
        }),
      });
      const data = await res.json();
      if (res.ok && data.found) {
        setLinkedInRowResult((prev) => ({ ...prev, [company.id]: "found" }));
        onLinkedInUpdate?.(company.id, data.linkedinUrl);
        // Clear indicator after 3 s
        setTimeout(() => setLinkedInRowResult((prev) => {
          const next = { ...prev };
          delete next[company.id];
          return next;
        }), 3000);
      } else {
        setLinkedInRowResult((prev) => ({ ...prev, [company.id]: "not_found" }));
        setTimeout(() => setLinkedInRowResult((prev) => {
          const next = { ...prev };
          delete next[company.id];
          return next;
        }), 3000);
      }
    } catch {
      setLinkedInRowResult((prev) => ({ ...prev, [company.id]: "not_found" }));
    } finally {
      setLinkedInSearchingId(null);
    }
  }

  function handleSelectAllCompanies() {
    const next: RowSelectionState = {};
    for (const company of companies) {
      next[company.id] = true;
    }
    setRowSelection(next);
  }

  const checkboxColumn = useMemo(
    () =>
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            disabled={deletingSelected}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            disabled={deletingSelected}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
          />
        ),
        size: 40,
      }),
    [deletingSelected]
  );

  const dataColumns = useMemo(
    () => [
      columnHelper.accessor("rank", {
        header: "#",
        cell: (info) => (
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {info.getValue()}
          </span>
        ),
        size: 48,
      }),
      // Annotation status badges
      columnHelper.display({
        id: "status",
        header: "",
        cell: (info) => {
          const ann = info.row.original.annotation;
          if (!ann?.contactLeft && !ann?.lowQuality && !ann?.note) return null;
          return (
            <div className="flex items-center gap-1">
              {ann.contactLeft && (
                <span
                  title="No longer at company"
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-600"
                >
                  <UserX className="w-3 h-3" />
                </span>
              )}
              {ann.lowQuality && (
                <span
                  title="Low quality"
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600"
                >
                  <ThumbsDown className="w-3 h-3" />
                </span>
              )}
              {ann.note && (
                <span title={ann.note} className="text-slate-400">
                  <StickyNote className="w-3 h-3" />
                </span>
              )}
            </div>
          );
        },
        size: 60,
      }),
      columnHelper.accessor("azienda", {
        header: "Company",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 group">
                <button
                  onClick={() => onCompanyClickRef.current?.(row)}
                  className="font-medium text-slate-900 text-sm text-left hover:text-indigo-600 transition-colors duration-150 cursor-pointer"
                >
                  {info.getValue()}
                </button>
                {row.sitoWeb && row.sitoWeb !== "n/a" && (
                  <a
                    href={row.sitoWeb}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-500"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              {row.sourceName && (
                <span className="text-[10px] font-mono text-slate-400 leading-none">
                  {row.sourceName}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("settore", {
        header: "Sector",
        cell: (info) => (
          <span className="text-xs text-slate-500 line-clamp-1">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("regione", {
        header: "Region",
        cell: (info) => (
          <span className="text-xs text-slate-600">{info.getValue()}</span>
        ),
        size: 120,
      }),
      columnHelper.accessor("tassoCrescita", {
        header: "Growth",
        cell: (info) => (
          <span className="font-bold text-slate-900 tabular-nums text-sm">
            {formatGrowth(info.getValue())}
          </span>
        ),
        size: 90,
      }),
      columnHelper.accessor("ricavi2024", {
        header: "Revenue '24",
        cell: (info) => (
          <span className="text-xs text-slate-600 tabular-nums">
            {formatRevenue(info.getValue())}
          </span>
        ),
        size: 90,
      }),
      columnHelper.accessor("cfoNome", {
        header: "CFO Name",
        enableSorting: false,
        cell: (info) => {
          const name = info.getValue();
          if (!name) return <span className="text-slate-300 text-xs">—</span>;
          return <span className="text-xs text-slate-700">{name}</span>;
        },
      }),
      columnHelper.accessor("cfoLinkedin", {
        header: "LinkedIn",
        enableSorting: false,
        cell: (info) => {
          const url = info.getValue();
          if (!url) return <span className="text-slate-300 text-xs">—</span>;
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 hover:text-blue-700 transition-colors"
            >
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          );
        },
        size: 72,
      }),
      columnHelper.accessor("cfoRuoloCategory", {
        header: "CFO Category",
        enableSorting: false,
        cell: (info) => {
          const cat = info.getValue();
          const meta = ROLE_CATEGORY_META[cat];
          const rawRole = info.row.original.cfoRuolo;
          if (cat === "Not Found")
            return <span className="text-slate-300 text-xs">—</span>;
          const chip = (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
              style={{
                backgroundColor: meta.color + "1a",
                color: meta.color,
                cursor: rawRole ? "help" : "default",
              }}
            >
              {meta.label}
            </span>
          );
          if (!rawRole) return chip;
          return (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent>{rawRole}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
      }),
      columnHelper.accessor("confidenza", {
        header: "Confidence",
        enableSorting: false,
        cell: (info) => {
          const val = info.getValue() ?? "";
          const meta = CONFIDENCE_META[val] ?? CONFIDENCE_META[""];
          return (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
          );
        },
        size: 80,
      }),
      // Actions column: LinkedIn search + annotate
      columnHelper.display({
        id: "edit",
        header: "",
        cell: (info) => {
          const company = info.row.original;
          const isSearching = linkedInSearchingId === company.id;
          const rowResult = linkedInRowResult[company.id];
          // Keep visible while searching or showing a transient result
          const forceVisible = isSearching || !!rowResult;
          return (
            <div
              className={`flex items-center gap-0.5 transition-opacity ${
                forceVisible
                  ? "opacity-100"
                  : "opacity-0 group-hover/row:opacity-100"
              }`}
            >
              {company.cfoNome && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSingleLinkedInSearch(company);
                  }}
                  disabled={isSearching}
                  className="p-1 rounded hover:bg-slate-100 disabled:cursor-not-allowed"
                  title={
                    isSearching
                      ? "Searching…"
                      : rowResult === "found"
                      ? "LinkedIn found — click to search again"
                      : rowResult === "not_found"
                      ? "Not found — click to retry"
                      : "Find LinkedIn profile"
                  }
                >
                  {isSearching ? (
                    <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  ) : rowResult === "found" ? (
                    <Check className="w-3 h-3 text-emerald-500" />
                  ) : rowResult === "not_found" ? (
                    <XCircle className="w-3 h-3 text-slate-400" />
                  ) : (
                    <Search className="w-3 h-3 text-slate-400 hover:text-blue-500" />
                  )}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingCompany(company);
                }}
                className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-indigo-500"
                title="Annotate"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          );
        },
        size: 56,
      }),
    ],
    []
  );

  const columns = useMemo(
    () => (selectionMode ? [checkboxColumn, ...dataColumns] : dataColumns),
    [selectionMode, checkboxColumn, dataColumns]
  );

  const table = useReactTable({
    data: companies,
    columns,
    state: { sorting, pagination, rowSelection },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: selectionMode,
    manualPagination: false,
  });

  const totalPages = table.getPageCount();
  const currentPage = pagination.pageIndex + 1;

  return (
    <>
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="bg-slate-50 hover:bg-slate-50">
                    {hg.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="text-xs font-semibold text-slate-500 uppercase tracking-wider py-2.5 whitespace-nowrap"
                        style={{ width: header.getSize() }}
                      >
                        {header.column.getCanSort() ? (
                          <button
                            className="flex items-center gap-1 hover:text-slate-900 transition-colors"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getIsSorted() === "asc" ? (
                              <ArrowUp className="w-3 h-3" />
                            ) : header.column.getIsSorted() === "desc" ? (
                              <ArrowDown className="w-3 h-3" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 opacity-40" />
                            )}
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="text-center py-12 text-slate-400 text-sm"
                    >
                      No companies match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="hover:bg-slate-50/60 transition-colors group/row"
                      data-selected={row.getIsSelected() || undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-2.5">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => exportToCsv(companies)}
              disabled={companies.length === 0}
            >
              <Download className="w-3 h-3" />
              Export CSV ({companies.length})
            </Button>
            {selectionMode && companies.length > 0 && !allSelected && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={handleSelectAllCompanies}
                disabled={deletingSelected}
              >
                Select all ({companies.length})
              </Button>
            )}
            {selectionMode && allSelected && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={() => setRowSelection({})}
                disabled={deletingSelected}
              >
                Clear all
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rows per page:</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) =>
                setPagination({ pageIndex: 0, pageSize: Number(v) })
              }
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 tabular-nums">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              ←
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              →
            </Button>
          </div>
        </div>
      </div>

      {/* Floating selection action bar */}
      {selectionMode && selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
                        flex items-center gap-3 px-4 py-2.5 rounded-full shadow-xl
                        bg-slate-900 border border-slate-700 text-white text-sm">
          <span className="tabular-nums font-medium">
            {selectedIds.length} selected
          </span>
          <button
            onClick={() => setRowSelection({})}
            className="text-slate-400 hover:text-white"
            title="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-slate-600" />
          <button
            onClick={() => setAddToCampaignOpen(true)}
            disabled={deletingSelected}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add to campaign
          </button>
          <button
            onClick={() => setAddToEnrichmentOpen(true)}
            disabled={deletingSelected}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Enrich
          </button>
          <button
            onClick={() => setLinkedInSearchOpen(true)}
            disabled={deletingSelected || selectedCompanies.filter((c) => c.cfoNome).length === 0}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
            title="Find LinkedIn profiles for selected contacts"
          >
            <Linkedin className="w-3.5 h-3.5" />
            Find LinkedIn
          </button>
          <button
            onClick={handleSendToLinkedinAgent}
            disabled={deletingSelected || sendingToAgent || selectedCompanies.filter((c) => c.cfoNome && !c.cfoLinkedin).length === 0}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
            title="Send to LinkedIn Agent (Claude) for batch search"
          >
            <Search className="w-3.5 h-3.5" />
            {sendingToAgent ? "Sending…" : "LI Agent"}
          </button>
          <button
            onClick={handleDeleteSelectedCompanies}
            disabled={deletingSelected || selectedImportedIds.length === 0}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
            title={
              selectedImportedIds.length === 0
                ? "Only imported companies can be deleted"
                : "Delete selected companies"
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deletingSelected ? "Deleting…" : `Delete selected (${selectedImportedIds.length})`}
          </button>
        </div>
      )}

      <AnnotationModal
        company={editingCompany}
        onClose={() => setEditingCompany(null)}
        onSave={(id, ann) => {
          setEditingCompany(null);
          onAnnotationSave?.(id, ann);
        }}
      />

      {addToCampaignOpen && (
        <AddToCampaignModal
          open={addToCampaignOpen}
          selectedCompanies={selectedCompanies.map((c) => ({
            id: c.id,
            azienda: c.azienda,
            cfoNome: c.cfoNome,
            cfoRuolo: c.cfoRuolo,
            cfoLinkedin: c.cfoLinkedin,
          }))}
          onClose={() => setAddToCampaignOpen(false)}
          onAdded={() => setRowSelection({})}
        />
      )}

      {linkedInSearchOpen && (
        <LinkedInSearchModal
          open={linkedInSearchOpen}
          selectedCompanies={selectedCompanies
            .filter((c) => c.cfoNome)
            .map((c) => ({
              id: c.id,
              azienda: c.azienda,
              cfoNome: c.cfoNome!,
              dataOrigin: c.dataOrigin,
            }))}
          onClose={() => {
            setLinkedInSearchOpen(false);
            setRowSelection({});
          }}
          onLinkedInUpdate={(id, url) => {
            onLinkedInUpdate?.(id, url);
          }}
        />
      )}

      {addToEnrichmentOpen && (
        <AddToEnrichmentModal
          open={addToEnrichmentOpen}
          selectedCompanies={selectedCompanies.map((c) => ({
            id: c.id,
            azienda: c.azienda,
            sitoWeb: c.sitoWeb,
            country: c.country,
            dataOrigin: c.dataOrigin,
          }))}
          onClose={() => setAddToEnrichmentOpen(false)}
          onAdded={() => setRowSelection({})}
        />
      )}
    </>
  );
}
