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
import { Plus, ChevronRight } from "lucide-react";
import { getApiErrorMessage, isCampaign, parseJsonSafe } from "@/lib/http-client";
import CampaignStatusBadge from "./CampaignStatusBadge";
import type { Campaign } from "@/types";

interface SelectedCompany {
  id: string;
  azienda: string;
  cfoNome: string | null;
  cfoRuolo: string | null;
  cfoLinkedin: string | null;
}

interface Props {
  open: boolean;
  selectedCompanies: SelectedCompany[];
  onClose: () => void;
  onAdded: () => void;
}

export default function AddToCampaignModal({ open, selectedCompanies, onClose, onAdded }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // campaignId being saved
  const [newName, setNewName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/campaigns")
      .then(async (response) => {
        const payload = await parseJsonSafe(response);
        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, "Failed to load campaigns"));
        }
        if (!Array.isArray(payload)) {
          throw new Error("Invalid campaigns response");
        }
        setCampaigns((payload as Campaign[]).filter((c) => c.status !== "archived"));
      })
      .catch((err: unknown) => {
        setCampaigns([]);
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function addToExisting(campaignId: string) {
    setSaving(campaignId);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: selectedCompanies.map((c) => ({
            companyId: c.id,
            contactName: c.cfoNome,
            contactRole: c.cfoRuolo,
            contactLinkedin: c.cfoLinkedin,
          })),
        }),
      });
      if (!res.ok) {
        const payload = await parseJsonSafe(res);
        throw new Error(getApiErrorMessage(payload, "Failed"));
      }
      onAdded();
      onClose();
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
      // Create campaign
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const payload = await parseJsonSafe(res);
        throw new Error(getApiErrorMessage(payload, "Failed to create"));
      }
      const payload = await parseJsonSafe(res);
      if (!isCampaign(payload)) {
        throw new Error("Invalid campaign response");
      }
      const campaign = payload;

      // Add contacts
      const addRes = await fetch(`/api/campaigns/${campaign.id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companies: selectedCompanies.map((c) => ({
            companyId: c.id,
            contactName: c.cfoNome,
            contactRole: c.cfoRuolo,
            contactLinkedin: c.cfoLinkedin,
          })),
        }),
      });
      if (!addRes.ok) {
        const addPayload = await parseJsonSafe(addRes);
        throw new Error(getApiErrorMessage(addPayload, "Failed to add contacts"));
      }

      onAdded();
      onClose();
      router.push(`/campaigns/${campaign.id}`);
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
            Add {selectedCompanies.length} contact{selectedCompanies.length !== 1 ? "s" : ""} to campaign
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Existing campaigns */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Add to existing campaign
            </p>
            {loading ? (
              <p className="text-sm text-slate-400 py-3 text-center">Loading…</p>
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-slate-400 py-3 text-center">No active campaigns yet</p>
            ) : (
              <div className="rounded-md border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    disabled={!!saving}
                    onClick={() => addToExisting(c.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50
                               transition-colors text-left disabled:opacity-60"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.totalContacts ?? 0} contacts</p>
                    </div>
                    <CampaignStatusBadge status={c.status} />
                    {saving === c.id ? (
                      <span className="text-xs text-slate-400">Adding…</span>
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

          {/* Create new */}
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Create new campaign
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Campaign name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                className="flex-1"
              />
              <Button
                onClick={createAndAdd}
                disabled={!newName.trim() || creatingNew}
                size="sm"
              >
                <Plus className="w-4 h-4 mr-1" />
                {creatingNew ? "Creating…" : "Create"}
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
