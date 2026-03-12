"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Globe,
  Linkedin,
  Mail,
  Phone,
  Copy,
  Check,
  ExternalLink,
  Hash,
  Cpu,
  Clock,
  AlertTriangle,
  UserRound,
  BriefcaseBusiness,
  DollarSign,
} from "lucide-react";
import type { CompanyResult } from "@/lib/enrichment-client";

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

const CONF_CLASS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  low: "bg-slate-100 text-slate-500 border border-slate-200",
};

function ConfBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${CONF_CLASS[value] ?? ""}`}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors duration-150 cursor-pointer"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <span className="mt-0.5 text-slate-400 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
          {label}
        </p>
        <div className="text-sm text-slate-800 break-all">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function Section({ title }: { title: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-5 mb-1 px-0.5">
      {title}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

interface Props {
  company: CompanyResult | null;
  onClose: () => void;
}

export default function CompanyDetailModal({ company, onClose }: Props) {
  if (!company) return null;

  const totalTokens =
    (company.input_tokens ?? 0) + (company.output_tokens ?? 0);

  return (
    <Dialog open={!!company} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-1">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <Building2 className="w-4.5 h-4.5 text-slate-500" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-slate-900 leading-tight">
                {company.azienda}
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span className="font-mono">#{company.rank}</span>
                <span className="text-slate-300">·</span>
                <span>{company.country}</span>
                {company.had_rate_limit && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="flex items-center gap-0.5 text-amber-600">
                      <AlertTriangle className="w-3 h-3" /> rate limited
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-1">
          {/* ── Company ── */}
          <Section title="Company" />
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
            {company.website && (
              <Field icon={<Globe className="w-4 h-4" />} label="Website">
                <a
                  href={
                    company.website.startsWith("http")
                      ? company.website
                      : `https://${company.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors duration-150"
                >
                  {company.website}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </Field>
            )}
          </div>

          {/* ── CFO Contact ── */}
          <Section title="CFO / Finance Contact" />
          {company.cfo_nome ? (
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
              <Field icon={<UserRound className="w-4 h-4 text-slate-500" />} label="Name">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{company.cfo_nome}</span>
                  <ConfBadge value={company.confidenza} />
                </div>
              </Field>

              {company.cfo_ruolo && (
                <Field icon={<BriefcaseBusiness className="w-4 h-4 text-slate-400" />} label="Role">
                  {company.cfo_ruolo}
                </Field>
              )}

              {company.cfo_linkedin && (
                <Field icon={<Linkedin className="w-4 h-4 text-[#0A66C2]" />} label="LinkedIn">
                  <a
                    href={company.cfo_linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors duration-150 truncate max-w-[280px]"
                  >
                    {company.cfo_linkedin.replace("https://www.linkedin.com/in/", "in/")}
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </Field>
              )}

              {company.cfo_email && (
                <Field icon={<Mail className="w-4 h-4 text-slate-500" />} label="Email">
                  <span className="flex items-center gap-0.5">
                    <span className="text-slate-800">{company.cfo_email}</span>
                    <CopyButton value={company.cfo_email} />
                  </span>
                </Field>
              )}

              {company.cfo_telefono && (
                <Field icon={<Phone className="w-4 h-4 text-slate-500" />} label="Phone">
                  <span className="flex items-center gap-0.5">
                    <span className="text-slate-800 font-mono">{company.cfo_telefono}</span>
                    <CopyButton value={company.cfo_telefono} />
                  </span>
                </Field>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-400 italic">
              No contact found for this company.
            </div>
          )}

          {/* ── Run metadata ── */}
          <Section title="Enrichment Metadata" />
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
            {totalTokens > 0 && (
              <Field icon={<Cpu className="w-4 h-4 text-slate-400" />} label="Tokens">
                <span className="font-mono text-slate-700">
                  {(company.input_tokens ?? 0).toLocaleString()} in +{" "}
                  {(company.output_tokens ?? 0).toLocaleString()} out ={" "}
                  <span className="font-semibold">{totalTokens.toLocaleString()}</span>
                </span>
              </Field>
            )}
            {company.cost_usd != null && (
              <Field icon={<DollarSign className="w-4 h-4 text-slate-400" />} label="Cost">
                <span className="font-mono text-slate-700">${company.cost_usd.toFixed(5)}</span>
              </Field>
            )}
            {company.elapsed_s > 0 && (
              <Field icon={<Clock className="w-4 h-4 text-slate-400" />} label="Elapsed">
                <span className="font-mono text-slate-700">{company.elapsed_s}s</span>
              </Field>
            )}
            {company.tool_calls > 0 && (
              <Field icon={<Hash className="w-4 h-4 text-slate-400" />} label="Tool calls">
                <span className="font-mono text-slate-700">{company.tool_calls}</span>
              </Field>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
