"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import CampaignStatusBadge from "@/components/campaigns/CampaignStatusBadge";
import CampaignStatsSummary from "@/components/campaigns/CampaignStatsSummary";
import CampaignContactsTable from "@/components/campaigns/CampaignContactsTable";
import EditCampaignModal from "@/components/campaigns/EditCampaignModal";
import AddContactsModal from "@/components/campaigns/AddContactsModal";
import { getApiErrorMessage, isCampaign, parseJsonSafe } from "@/lib/http-client";
import type { Campaign, CampaignContact } from "@/types";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [campaignRes, contactsRes] = await Promise.all([
          fetch(`/api/campaigns/${id}`),
          fetch(`/api/campaigns/${id}/contacts`),
        ]);
        const [campaignPayload, contactsPayload] = await Promise.all([
          parseJsonSafe(campaignRes),
          parseJsonSafe(contactsRes),
        ]);

        if (!campaignRes.ok) {
          throw new Error(getApiErrorMessage(campaignPayload, "Failed to load campaign"));
        }
        if (!contactsRes.ok) {
          throw new Error(getApiErrorMessage(contactsPayload, "Failed to load contacts"));
        }
        if (!isCampaign(campaignPayload)) {
          throw new Error("Invalid campaign response");
        }
        if (!Array.isArray(contactsPayload)) {
          throw new Error("Invalid contacts response");
        }

        if (!cancelled) {
          setCampaign(campaignPayload);
          setContacts(contactsPayload as CampaignContact[]);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setCampaign(null);
          setContacts([]);
          setError(err instanceof Error ? err.message : "Failed to load campaign");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleContactsChange = useCallback((updated: CampaignContact[]) => {
    setContacts(updated);
    // Recompute stats
    setCampaign((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        totalContacts: updated.length,
        contactedCount: updated.filter((c) => c.status !== "pending").length,
        repliedCount: updated.filter((c) =>
          ["replied", "meeting_scheduled", "converted"].includes(c.status)
        ).length,
        convertedCount: updated.filter((c) => c.status === "converted").length,
      };
    });
  }, []);

  async function handleDelete() {
    if (!campaign) return;
    if (!confirm(`Delete "${campaign.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/campaigns");
        return;
      }
      const payload = await parseJsonSafe(res);
      throw new Error(getApiErrorMessage(payload, "Failed to delete campaign"));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete campaign");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
        <div className="h-8 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="h-24 bg-slate-50 rounded-xl animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-50 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <p className="text-slate-500">{error ?? "Campaign not found."}</p>
        <Link href="/campaigns" className="text-indigo-600 text-sm mt-2 inline-block">
          ← Back to campaigns
        </Link>
      </div>
    );
  }

  const existingCompanyIds = new Set(contacts.map((c) => c.companyId));

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          {campaign.description && (
            <p className="text-sm text-slate-500">{campaign.description}</p>
          )}
          <p className="text-xs text-slate-400">
            Created{" "}
            {new Date(campaign.createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="gap-1.5"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <CampaignStatsSummary campaign={campaign} />

      {/* Contacts section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Contacts</h2>
          <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Add Contacts
          </Button>
        </div>

        <CampaignContactsTable
          campaignId={id}
          contacts={contacts}
          onChange={handleContactsChange}
        />
      </div>

      {/* Modals */}
      {editOpen && (
        <EditCampaignModal
          campaign={campaign}
          onClose={() => setEditOpen(false)}
          onSaved={(updates) => {
            setCampaign((prev) => (prev ? { ...prev, ...updates } : prev));
            setEditOpen(false);
          }}
        />
      )}

      {addOpen && (
        <AddContactsModal
          campaignId={id}
          existingContactCompanyIds={existingCompanyIds}
          onClose={() => setAddOpen(false)}
          onAdded={(updated) => {
            handleContactsChange(updated);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
