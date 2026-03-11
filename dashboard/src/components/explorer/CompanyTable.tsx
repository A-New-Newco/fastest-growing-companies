"use client";

import { useState, useMemo, useEffect } from "react";
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
  X,
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
import AnnotationModal from "./AnnotationModal";
import AddToCampaignModal from "@/components/campaigns/AddToCampaignModal";

const columnHelper = createColumnHelper<Company>();

interface CompanyTableProps {
  companies: Company[];
  onAnnotationSave?: (companyId: string, annotation: Omit<Annotation, "companyId">) => void;
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

export default function CompanyTable({ companies, onAnnotationSave, selectionMode = false }: CompanyTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);

  // Reset selection when companies change (e.g. filter applied)
  useEffect(() => {
    setRowSelection({});
  }, [companies]);

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  const selectedCompanies = useMemo(
    () => companies.filter((c) => rowSelection[c.id]),
    [companies, rowSelection]
  );

  const checkboxColumn = useMemo(
    () =>
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400 cursor-pointer"
          />
        ),
        size: 40,
      }),
    []
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
            <div className="flex items-center gap-1.5 group">
              <span className="font-medium text-slate-900 text-sm">
                {info.getValue()}
              </span>
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
          if (cat === "Not Found")
            return <span className="text-slate-300 text-xs">—</span>;
          return (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
              style={{
                backgroundColor: meta.color + "1a",
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
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
      // Edit / annotate button
      columnHelper.display({
        id: "edit",
        header: "",
        cell: (info) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingCompany(info.row.original);
            }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-indigo-500"
            title="Annotate"
          >
            <Pencil className="w-3 h-3" />
          </button>
        ),
        size: 36,
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
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500
                       text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add to campaign
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
    </>
  );
}
