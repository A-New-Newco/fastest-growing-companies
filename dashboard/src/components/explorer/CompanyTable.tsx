"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, Linkedin, Download } from "lucide-react";
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
import type { Company } from "@/types";
import { formatRevenue, formatGrowth } from "@/lib/data";
import { ROLE_CATEGORY_META, CONFIDENCE_META } from "@/lib/constants";

const columnHelper = createColumnHelper<Company>();

interface CompanyTableProps {
  companies: Company[];
}

function exportToCsv(companies: Company[]) {
  const headers = [
    "Rank", "Company", "Sector", "Region", "Growth Rate (%)",
    "Revenue 2021 (K€)", "Revenue 2024 (K€)", "Website",
    "CFO Name", "CFO Role", "CFO Category", "CFO LinkedIn", "Confidence",
  ];
  const rows = companies.map((c) => [
    c.rank,
    c.azienda,
    c.settore,
    c.regione,
    c.tassoCrescita,
    c.ricavi2021,
    c.ricavi2024,
    c.sitoWeb,
    c.cfoNome ?? "",
    c.cfoRuolo ?? "",
    c.cfoRuoloCategory,
    c.cfoLinkedin ?? "",
    c.confidenza ?? "",
  ]);
  const csvContent = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leader-della-crescita-${companies.length}-companies.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompanyTable({ companies }: CompanyTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });

  const columns = useMemo(
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
    ],
    []
  );

  const table = useReactTable({
    data: companies,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: false,
  });

  const totalPages = table.getPageCount();
  const currentPage = pagination.pageIndex + 1;

  return (
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
                    className="hover:bg-slate-50/60 transition-colors"
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
  );
}
