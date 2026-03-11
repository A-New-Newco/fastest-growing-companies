"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import EnrichmentSessionCard from "@/components/enrichment/EnrichmentSessionCard";
import CreateSessionModal from "@/components/enrichment/CreateSessionModal";
import type { EnrichmentSession } from "@/types";

export default function EnrichmentPage() {
  const [sessions, setSessions] = useState<EnrichmentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch("/api/enrichment-sessions")
      .then((r) => r.json())
      .then((data: EnrichmentSession[]) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Enrichment Sessions</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            AI-powered CFO / head-of-finance research for selected companies
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          New Session
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-20 text-center">
          <p className="text-slate-400 text-sm mb-4">No enrichment sessions yet</p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Create your first session
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <EnrichmentSessionCard key={s.id} session={s} />
          ))}
        </div>
      )}

      <CreateSessionModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(session) => {
          setSessions((prev) => [session, ...prev]);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
