"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Annotation, Company } from "@/types";
import { upsertAnnotation } from "@/lib/data";
import { UserX, ThumbsDown, StickyNote } from "lucide-react";

interface Props {
  company: Company | null;
  onClose: () => void;
  onSave: (companyId: string, annotation: Omit<Annotation, "companyId">) => void;
}

export default function AnnotationModal({ company, onClose, onSave }: Props) {
  const [contactLeft, setContactLeft] = useState(false);
  const [lowQuality, setLowQuality] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form with current annotation when company changes
  useEffect(() => {
    if (company) {
      setContactLeft(company.annotation?.contactLeft ?? false);
      setLowQuality(company.annotation?.lowQuality ?? false);
      setNote(company.annotation?.note ?? "");
      setError(null);
    }
  }, [company]);

  async function handleSave() {
    if (!company) return;
    setSaving(true);
    setError(null);
    try {
      await upsertAnnotation(company.id, { contactLeft, lowQuality, note });
      onSave(company.id, { contactLeft, lowQuality, note });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error while saving");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!company} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900">
            {company?.azienda}
          </DialogTitle>
          {company?.cfoNome && (
            <p className="text-xs text-slate-500 mt-0.5">
              Contact: {company.cfoNome}
              {company.cfoRuolo && ` — ${company.cfoRuolo}`}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Flag: no longer at company */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400"
              checked={contactLeft}
              onChange={(e) => setContactLeft(e.target.checked)}
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <UserX className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-sm font-medium text-slate-800">
                  No longer at company
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                The contact left the company or is no longer reachable.
              </p>
            </div>
          </label>

          {/* Flag: low quality */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
              checked={lowQuality}
              onChange={(e) => setLowQuality(e.target.checked)}
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <ThumbsDown className="w-3.5 h-3.5 text-red-500" />
                <span className="text-sm font-medium text-slate-800">
                  Low quality / unverified
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Low-quality data or impossible to verify.
              </p>
            </div>
          </label>

          {/* Free note */}
          <div>
            <label className="flex items-center gap-1.5 mb-1.5">
              <StickyNote className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-700">Note</span>
            </label>
            <textarea
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              rows={3}
              placeholder="Add a comment about this company or contact..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
