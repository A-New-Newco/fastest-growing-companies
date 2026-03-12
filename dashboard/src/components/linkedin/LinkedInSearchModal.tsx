"use client";

import { useState } from "react";
import { Linkedin, Search, Check, X, Loader2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SearchCompany {
  id: string;
  azienda: string;
  cfoNome: string;
  dataOrigin: "curated" | "imported";
}

type RowStatus = "idle" | "searching" | "found" | "not_found";

interface RowState {
  status: RowStatus;
  linkedinUrl: string | null;
}

interface LinkedInSearchModalProps {
  open: boolean;
  selectedCompanies: SearchCompany[];
  onClose: () => void;
  onLinkedInUpdate: (companyId: string, linkedinUrl: string) => void;
}

export default function LinkedInSearchModal({
  open,
  selectedCompanies,
  onClose,
  onLinkedInUpdate,
}: LinkedInSearchModalProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      selectedCompanies.map((c) => [c.id, { status: "idle", linkedinUrl: null }])
    )
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  const total = selectedCompanies.length;
  const foundCount = Object.values(rows).filter((r) => r.status === "found").length;
  const allDone =
    done ||
    selectedCompanies.every((c) => {
      const s = rows[c.id]?.status;
      return s === "found" || s === "not_found";
    });

  const progressPct = total > 0 ? Math.round((processedCount / total) * 100) : 0;

  async function runSearch() {
    setRunning(true);
    setDone(false);
    setProcessedCount(0);

    for (let i = 0; i < selectedCompanies.length; i++) {
      const company = selectedCompanies[i];

      setRows((prev) => ({
        ...prev,
        [company.id]: { status: "searching", linkedinUrl: null },
      }));

      try {
        const res = await fetch("/api/linkedin-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: company.id,
            companyName: company.azienda,
            contactName: company.cfoNome,
            dataOrigin: company.dataOrigin,
          }),
        });

        const data = await res.json();

        if (res.ok && data.found) {
          setRows((prev) => ({
            ...prev,
            [company.id]: { status: "found", linkedinUrl: data.linkedinUrl },
          }));
          onLinkedInUpdate(company.id, data.linkedinUrl);
        } else {
          setRows((prev) => ({
            ...prev,
            [company.id]: { status: "not_found", linkedinUrl: null },
          }));
        }
      } catch {
        setRows((prev) => ({
          ...prev,
          [company.id]: { status: "not_found", linkedinUrl: null },
        }));
      }

      setProcessedCount(i + 1);
    }

    setRunning(false);
    setDone(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !running) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Linkedin className="w-4 h-4 text-blue-600" />
            Find LinkedIn Profiles
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar — visible while running or after completion */}
        {(running || allDone) && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              {running ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  Searching… {processedCount} / {total}
                </span>
              ) : (
                <span className="text-slate-600 font-medium">
                  Done —{" "}
                  <span className="text-emerald-600">{foundCount} found</span>
                  {foundCount < total && (
                    <span className="text-slate-400">
                      {" "}
                      · {total - foundCount} not found
                    </span>
                  )}
                </span>
              )}
              <span className="tabular-nums">{progressPct}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  allDone && foundCount === 0
                    ? "bg-slate-300"
                    : allDone
                    ? "bg-emerald-500"
                    : "bg-blue-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Company list */}
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {selectedCompanies.map((company) => {
            const row = rows[company.id] ?? { status: "idle", linkedinUrl: null };
            return (
              <div
                key={company.id}
                className={`flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
                  row.status === "found"
                    ? "bg-emerald-50"
                    : row.status === "searching"
                    ? "bg-blue-50"
                    : "bg-slate-50"
                }`}
              >
                {/* Status icon */}
                <div className="w-4 flex-shrink-0">
                  {row.status === "idle" && (
                    <Search className="w-3.5 h-3.5 text-slate-300" />
                  )}
                  {row.status === "searching" && (
                    <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                  )}
                  {row.status === "found" && (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  {row.status === "not_found" && (
                    <X className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>

                {/* Company + contact */}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-800 truncate block">
                    {company.azienda}
                  </span>
                  <span className="text-slate-500 text-xs truncate block">
                    {company.cfoNome}
                  </span>
                </div>

                {/* Result */}
                {row.status === "found" && row.linkedinUrl && (
                  <a
                    href={row.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 flex-shrink-0 font-medium"
                  >
                    View
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {row.status === "not_found" && (
                  <span className="text-xs text-slate-400 flex-shrink-0">not found</span>
                )}
                {row.status === "searching" && (
                  <span className="text-xs text-blue-400 flex-shrink-0">searching…</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={running}
            className="text-xs"
          >
            {allDone ? "Close" : "Cancel"}
          </Button>
          {!allDone && (
            <Button
              size="sm"
              onClick={runSearch}
              disabled={running}
              className="text-xs bg-blue-600 hover:bg-blue-500 text-white"
            >
              {running ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                  Start Search
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
