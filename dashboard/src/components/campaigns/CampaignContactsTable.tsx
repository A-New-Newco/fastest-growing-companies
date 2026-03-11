"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Linkedin,
  Trash2,
  StickyNote,
  Download,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ContactStatusSelect from "./ContactStatusSelect";
import type { CampaignContact, ContactStatus } from "@/types";

const columnHelper = createColumnHelper<CampaignContact>();

interface Props {
  campaignId: string;
  contacts: CampaignContact[];
  onChange: (contacts: CampaignContact[]) => void;
}

function exportToCsv(contacts: CampaignContact[]) {
  const headers = [
    "Company", "Sector", "Region",
    "Contact Name", "Role", "LinkedIn",
    "Status", "Notes", "Contacted At", "Replied At",
  ];
  const rows = contacts.map((c) => [
    c.companyName ?? "",
    c.companySector ?? "",
    c.companyRegion ?? "",
    c.contactName ?? "",
    c.contactRole ?? "",
    c.contactLinkedin ?? "",
    c.status,
    c.notes ?? "",
    c.contactedAt ? new Date(c.contactedAt).toLocaleDateString("en-GB") : "",
    c.repliedAt ? new Date(c.repliedAt).toLocaleDateString("en-GB") : "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign-contacts.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CampaignContactsTable({ campaignId, contacts, onChange }: Props) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const updateContact = useCallback(
    async (contactId: string, updates: Partial<CampaignContact> & Record<string, unknown>) => {
      setUpdatingId(contactId);
      // Optimistic update
      onChange(
        contacts.map((c) => (c.id === contactId ? { ...c, ...updates } : c))
      );
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          // Revert on error
          onChange(contacts);
        } else {
          const updated = await res.json();
          onChange(contacts.map((c) => (c.id === contactId ? { ...c, ...updated } : c)));
        }
      } catch {
        onChange(contacts);
      } finally {
        setUpdatingId(null);
      }
    },
    [campaignId, contacts, onChange]
  );

  const deleteContact = useCallback(
    async (contactId: string) => {
      setDeletingId(contactId);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/contacts/${contactId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          onChange(contacts.filter((c) => c.id !== contactId));
        }
      } finally {
        setDeletingId(null);
      }
    },
    [campaignId, contacts, onChange]
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("companyName", {
        header: ({ column }) => (
          <button
            className="flex items-center gap-1 hover:text-slate-900"
            onClick={() => column.toggleSorting()}
          >
            Company
            {column.getIsSorted() === "asc" ? (
              <ArrowUp className="w-3 h-3" />
            ) : column.getIsSorted() === "desc" ? (
              <ArrowDown className="w-3 h-3" />
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-40" />
            )}
          </button>
        ),
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-900 text-xs">{row.original.companyName}</p>
            <p className="text-[11px] text-slate-400">{row.original.companySector}</p>
          </div>
        ),
      }),
      columnHelper.accessor("contactName", {
        header: "Contact",
        cell: ({ row }) => (
          <div>
            <p className="text-xs text-slate-800">{row.original.contactName ?? "—"}</p>
            <p className="text-[11px] text-slate-400">{row.original.contactRole ?? ""}</p>
          </div>
        ),
      }),
      columnHelper.accessor("contactLinkedin", {
        header: "LinkedIn",
        cell: ({ getValue }) => {
          const url = getValue();
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
            >
              <Linkedin className="w-3.5 h-3.5" />
              Profile
            </a>
          ) : (
            <span className="text-slate-300 text-xs">—</span>
          );
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ row }) => (
          <ContactStatusSelect
            value={row.original.status}
            disabled={updatingId === row.original.id}
            onChange={(newStatus: ContactStatus) =>
              updateContact(row.original.id, { status: newStatus })
            }
          />
        ),
      }),
      columnHelper.accessor("notes", {
        header: "Notes",
        cell: ({ row }) => (
          <NoteCell
            contact={row.original}
            disabled={updatingId === row.original.id}
            onSave={(notes) => updateContact(row.original.id, { notes })}
          />
        ),
      }),
      columnHelper.accessor("contactedAt", {
        header: "Contacted",
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? (
            <span className="text-xs text-slate-500 tabular-nums">
              {new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </span>
          ) : (
            <span className="text-slate-300 text-xs">—</span>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded
                       text-slate-400 hover:text-red-500 hover:bg-red-50"
            disabled={deletingId === row.original.id}
            onClick={() => {
              if (confirm(`Remove ${row.original.companyName ?? "this contact"} from the campaign?`)) {
                deleteContact(row.original.id);
              }
            }}
            title="Remove contact"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ),
      }),
    ],
    [updateContact, deleteContact, updatingId, deletingId]
  );

  const table = useReactTable({
    data: contacts,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
        </p>
        <button
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800
                     px-2.5 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
          onClick={() => exportToCsv(contacts)}
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-slate-50 hover:bg-slate-50">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="text-xs font-medium text-slate-500 uppercase tracking-wider py-2.5"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
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
                  className="h-24 text-center text-sm text-slate-400"
                >
                  No contacts yet. Click &quot;Add Contacts&quot; to get started.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group hover:bg-slate-50/80 border-slate-100"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5 text-xs">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {contacts.length > 25 && (
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rows per page</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) =>
                setPagination((p) => ({ ...p, pageSize: Number(v), pageIndex: 0 }))
              }
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Page {pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex - 1 }))}
              disabled={!table.getCanPreviousPage()}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex + 1 }))}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline notes cell with edit-on-click
function NoteCell({
  contact,
  disabled,
  onSave,
}: {
  contact: CampaignContact;
  disabled: boolean;
  onSave: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(contact.notes ?? "");

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          className="text-xs border border-slate-200 rounded px-1.5 py-0.5 w-32 focus:outline-none
                     focus:ring-1 focus:ring-indigo-400"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (value !== (contact.notes ?? "")) onSave(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              if (value !== (contact.notes ?? "")) onSave(value);
            }
            if (e.key === "Escape") {
              setEditing(false);
              setValue(contact.notes ?? "");
            }
          }}
        />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 max-w-[120px]"
            disabled={disabled}
            onClick={() => {
              setValue(contact.notes ?? "");
              setEditing(true);
            }}
          >
            {contact.notes ? (
              <>
                <StickyNote className="w-3 h-3 shrink-0 text-amber-400" />
                <span className="truncate">{contact.notes}</span>
              </>
            ) : (
              <span className="text-slate-300 hover:text-slate-500 italic">add note…</span>
            )}
          </button>
        </TooltipTrigger>
        {contact.notes && (
          <TooltipContent>
            <p className="max-w-xs text-xs">{contact.notes}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
