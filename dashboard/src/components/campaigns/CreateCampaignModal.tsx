"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage, isCampaign, parseJsonSafe } from "@/lib/http-client";
import type { Campaign } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}

export default function CreateCampaignModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const payload = await parseJsonSafe(res);
        throw new Error(getApiErrorMessage(payload, "Failed to create campaign"));
      }
      const payload = await parseJsonSafe(res);
      if (!isCampaign(payload)) {
        throw new Error("Invalid campaign response");
      }
      const campaign = payload;
      onCreated(campaign);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setName("");
    setDescription("");
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
              Name
            </label>
            <Input
              placeholder="e.g. Q2 CFO Outreach 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
              Description{" "}
              <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm
                         placeholder:text-slate-400 focus:outline-none focus:ring-2
                         focus:ring-indigo-500 focus:border-transparent resize-none"
              rows={2}
              placeholder="Target audience, goal, context..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || saving}>
            {saving ? "Creating…" : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
