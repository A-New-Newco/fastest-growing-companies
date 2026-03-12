"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, ChevronRight, Loader2 } from "lucide-react";
import SessionStatusBadge from "./SessionStatusBadge";
import type { EnrichmentSession } from "@/types";

interface SelectedCompany {
  id: string;
  azienda: string;
  sitoWeb: string | null;
  country: string;
  dataOrigin: "curated" | "imported";
}

interface Props {
  open: boolean;
  selectedCompanies: SelectedCompany[];
  onClose: () => void;
  onAdded: () => void;
}

export default function AddToEnrichmentModal({ open, selectedCompanies, onClose, onAdded }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<EnrichmentSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // sessionId being saved
  const [newName, setNewName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/enrichment-sessions")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load sessions");
        const data: EnrichmentSession[] = await res.json();
        // Only show sessions that can still accept companies
        setSessions(data.filter((s) => s.status === "pending" || s.status === "paused"));
      })
      .catch((err: unknown) => {
        setSessions([]);
        setError(err instanceof Error ? err.message : "Failed to load sessions");
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function addToExisting(sessionId: string) {
    setSaving(sessionId);
    setError(null);
    try {
      const res = await fetch(`/api/enrichment-sessions/${sessionId}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: selectedCompanies.map((c) => ({
            companyId: c.id,
            companyOrigin: c.dataOrigin,
            companyName: c.azienda,
            companyWebsite: c.sitoWeb,
            companyCountry: c.country,
          })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? "Failed to add");
      }
      onAdded();
      onClose();
      router.push(`/enrichment/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(null);
    }
  }

  async function createAndAdd() {
    if (!newName.trim()) return;
    setCreatingNew(true);
    setError(null);
    try {
      const res = await fetch("/api/enrichment-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          companies: selectedCompanies.map((c) => ({
            companyId: c.id,
            companyOrigin: c.dataOrigin,
            companyName: c.azienda,
            companyWebsite: c.sitoWeb,
            companyCountry: c.country,
          })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? "Failed to create session");
      }
      const session: EnrichmentSession = await res.json();
      onAdded();
      onClose();
      router.push(`/enrichment/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreatingNew(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add {selectedCompanies.length} compan{selectedCompanies.length !== 1 ? "ies" : "y"} to enrichment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Existing sessions */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Add to existing session
            </p>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-slate-400 py-3 text-center">No pending or paused sessions</p>
            ) : (
              <div className="rounded-md border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    disabled={!!saving || creatingNew}
                    onClick={() => addToExisting(s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50
                               transition-colors text-left disabled:opacity-60"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.totalCompanies} companies</p>
                    </div>
                    <SessionStatusBadge status={s.status} />
                    {saving === s.id ? (
                      <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="mx-3 text-xs text-slate-400">or</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          {/* Create new session */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Create new session
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Session name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                className="flex-1"
                disabled={creatingNew}
              />
              <Button
                onClick={createAndAdd}
                disabled={!newName.trim() || creatingNew || !!saving}
                size="sm"
              >
                {creatingNew ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Creating…</>
                ) : (
                  <><Plus className="w-4 h-4 mr-1" /> Create</>
                )}
              </Button>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!saving || creatingNew}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
