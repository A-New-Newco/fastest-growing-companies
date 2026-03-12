"use client";

import { useState, useEffect } from "react";
import { Plus, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import CampaignCard from "@/components/campaigns/CampaignCard";
import CreateCampaignModal from "@/components/campaigns/CreateCampaignModal";
import { getApiErrorMessage, parseJsonSafe } from "@/lib/http-client";
import type { Campaign } from "@/types";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/campaigns");
        const payload = await parseJsonSafe(response);
        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, "Failed to load campaigns"));
        }
        if (!Array.isArray(payload)) {
          throw new Error("Invalid campaigns response");
        }
        if (!cancelled) {
          setCampaigns(payload as Campaign[]);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCampaigns([]);
          setError(err instanceof Error ? err.message : "Failed to load campaigns");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const visible = campaigns.filter((c) =>
    showArchived ? true : c.status !== "archived"
  );

  const archivedCount = campaigns.filter((c) => c.status === "archived").length;

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            LinkedIn outreach campaigns for company contacts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <button
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700
                         px-3 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
            </button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            New Campaign
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl border border-slate-100 bg-slate-50 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed
                        border-slate-200 py-20 text-center">
          <p className="text-slate-400 text-sm mb-4">No campaigns yet</p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Create your first campaign
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}

      <CreateCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(campaign) => {
          setCampaigns((prev) => [campaign, ...prev]);
          setError(null);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
