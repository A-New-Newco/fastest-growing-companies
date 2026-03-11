"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Linkedin, Plus, Search } from "lucide-react";
import { ALL_COUNTRIES_VALUE, normalizeCountryCode } from "@/lib/constants";
import { useFilters } from "@/lib/filter-context";
import { getApiErrorMessage, parseJsonSafe } from "@/lib/http-client";
import type { CampaignContact } from "@/types";

interface ContactRow {
  companyId: string;
  companyName: string;
  contactName: string | null;
  contactRole: string | null;
  contactLinkedin: string | null;
  selected: boolean;
  alreadyAdded: boolean;
}

interface Props {
  campaignId: string;
  existingContactCompanyIds: Set<string>;
  onClose: () => void;
  onAdded: (contacts: CampaignContact[]) => void;
}

export default function AddContactsModal({
  campaignId,
  existingContactCompanyIds,
  onClose,
  onAdded,
}: Props) {
  const { filters } = useFilters();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanies = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: q, limit: "30" });
      if (filters.country !== ALL_COUNTRIES_VALUE) {
        params.set("country", normalizeCountryCode(filters.country));
      }
      const res = await fetch(`/api/companies/search?${params}`);
      const payload = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(payload, "Failed to load companies"));
      }
      if (!Array.isArray(payload)) {
        throw new Error("Invalid companies response");
      }
      const data = payload as Array<{
        id: string;
        azienda: string;
        cfo_nome: string | null;
        cfo_ruolo: string | null;
        cfo_linkedin: string | null;
      }>;
      setRows(
        data.map((c) => ({
          companyId: c.id,
          companyName: c.azienda,
          contactName: c.cfo_nome,
          contactRole: c.cfo_ruolo,
          contactLinkedin: c.cfo_linkedin,
          selected: false,
          alreadyAdded: existingContactCompanyIds.has(c.id),
        }))
      );
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not load companies");
    } finally {
      setLoading(false);
    }
  }, [existingContactCompanyIds, filters.country]);

  useEffect(() => {
    fetchCompanies(search);
    // Intentionally exclude fetchCompanies to avoid re-fetching on every render:
    // existingContactCompanyIds is a Set recreated by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters.country]);

  const selectedRows = rows.filter((r) => r.selected && !r.alreadyAdded);

  async function handleAdd() {
    if (selectedRows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: selectedRows.map((r) => ({
            companyId: r.companyId,
            contactName: r.contactName,
            contactRole: r.contactRole,
            contactLinkedin: r.contactLinkedin,
          })),
        }),
      });
      if (!res.ok) {
        const payload = await parseJsonSafe(res);
        throw new Error(getApiErrorMessage(payload, "Failed to add contacts"));
      }
      // Refresh contacts from server
      const contactsRes = await fetch(`/api/campaigns/${campaignId}/contacts`);
      const contactsPayload = await parseJsonSafe(contactsRes);
      if (!contactsRes.ok) {
        throw new Error(getApiErrorMessage(contactsPayload, "Failed to refresh contacts"));
      }
      if (!Array.isArray(contactsPayload)) {
        throw new Error("Invalid contacts response");
      }
      onAdded(contactsPayload as CampaignContact[]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Contacts</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search company or contact name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-400">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-slate-400">
                No results
              </div>
            ) : (
              rows.map((row) => (
                <label
                  key={row.companyId}
                  className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors
                    ${row.alreadyAdded ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={row.alreadyAdded}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.companyId === row.companyId
                            ? { ...r, selected: e.target.checked }
                            : r
                        )
                      )
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{row.companyName}</p>
                    <p className="text-xs text-slate-500">
                      {row.contactName ?? "No contact"}{row.contactRole ? ` · ${row.contactRole}` : ""}
                    </p>
                  </div>
                  {row.contactLinkedin && (
                    <Linkedin className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  )}
                  {row.alreadyAdded && (
                    <span className="text-[10px] text-slate-400 shrink-0">already in campaign</span>
                  )}
                </label>
              ))
            )}
          </div>

          {selectedRows.length > 0 && (
            <p className="text-xs text-indigo-600 font-medium">
              {selectedRows.length} contact{selectedRows.length > 1 ? "s" : ""} selected
            </p>
          )}

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={selectedRows.length === 0 || saving}
          >
            <Plus className="w-4 h-4 mr-1" />
            {saving ? "Adding…" : `Add ${selectedRows.length > 0 ? selectedRows.length : ""} Contact${selectedRows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
