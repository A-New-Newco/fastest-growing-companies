"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Globe,
  LayoutGrid,
  MapPin,
  TrendingUp,
  BarChart2,
  UserRound,
  BriefcaseBusiness,
  Linkedin,
  ExternalLink,
  Mail,
  Phone,
  Copy,
  Check,
  UserX,
  ThumbsDown,
  StickyNote,
  Pencil,
  Star,
} from "lucide-react";
import type { Annotation, Company } from "@/types";
import { formatRevenue, formatGrowth } from "@/lib/data";
import { ROLE_CATEGORY_META, CONFIDENCE_META } from "@/lib/constants";
import AnnotationModal from "./AnnotationModal";

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
        <div className="text-sm text-slate-800">{children}</div>
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
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
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
// Main modal
// ---------------------------------------------------------------------------

interface Props {
  company: Company | null;
  onClose: () => void;
  onAnnotationSave?: (companyId: string, annotation: Omit<Annotation, "companyId">) => void;
}

export default function CompanyDetailModal({ company, onClose, onAnnotationSave }: Props) {
  const [annotationOpen, setAnnotationOpen] = useState(false);

  if (!company) return null;

  const confMeta = CONFIDENCE_META[company.confidenza ?? ""] ?? CONFIDENCE_META[""];
  const roleMeta = ROLE_CATEGORY_META[company.cfoRuoloCategory];
  const ann = company.annotation;
  const hasAnn = ann?.contactLeft || ann?.lowQuality || !!ann?.note;

  return (
    <>
      <Dialog
        open={!!company}
        onOpenChange={(open) => {
          if (!open && !annotationOpen) onClose();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-1">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                <Building2 className="w-4 h-4 text-slate-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-base font-semibold text-slate-900 leading-tight">
                    {company.azienda}
                  </DialogTitle>
                  {company.dataOrigin === "imported" && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-600">
                      imported
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono">#{company.rank}</span>
                  <span className="text-slate-300">·</span>
                  <span>{company.country}</span>
                </p>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-1">
            {/* ── Company ── */}
            <Section title="Company" />
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
              {company.sitoWeb && company.sitoWeb !== "n/a" && (
                <Field icon={<Globe className="w-4 h-4" />} label="Website">
                  <a
                    href={
                      company.sitoWeb.startsWith("http")
                        ? company.sitoWeb
                        : `https://${company.sitoWeb}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors duration-150"
                  >
                    {company.sitoWeb}
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </Field>
              )}
              <Field icon={<LayoutGrid className="w-4 h-4" />} label="Sector">
                <span className="text-slate-700">{company.settore}</span>
              </Field>
              <Field icon={<MapPin className="w-4 h-4" />} label="Region">
                <span className="text-slate-700">{company.regione}</span>
              </Field>
              <Field icon={<Star className="w-4 h-4" />} label="Appearances in ranking">
                <span className="font-mono text-slate-700">{company.presenze}×</span>
              </Field>
            </div>

            {/* ── Financials ── */}
            <Section title="Financials" />
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
              <Field icon={<TrendingUp className="w-4 h-4" />} label="Growth Rate">
                <span className="font-bold text-slate-900">
                  {formatGrowth(company.tassoCrescita)}
                </span>
              </Field>
              <Field icon={<BarChart2 className="w-4 h-4" />} label="Revenue (base year)">
                <span className="font-mono text-slate-700">
                  {formatRevenue(company.ricavi2021)}
                </span>
              </Field>
              <Field icon={<BarChart2 className="w-4 h-4" />} label="Revenue '24">
                <span className="font-mono text-slate-700">
                  {formatRevenue(company.ricavi2024)}
                </span>
              </Field>
            </div>

            {/* ── CFO / Finance Contact ── */}
            <Section title="CFO / Finance Contact" />
            {company.cfoFound ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
                <Field icon={<UserRound className="w-4 h-4" />} label="Name">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{company.cfoNome}</span>
                    {company.confidenza && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: confMeta.bg, color: confMeta.color }}
                      >
                        {confMeta.label}
                      </span>
                    )}
                  </div>
                </Field>

                {company.cfoRuolo && (
                  <Field
                    icon={<BriefcaseBusiness className="w-4 h-4" />}
                    label="Role"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-700">{company.cfoRuolo}</span>
                      {company.cfoRuoloCategory !== "Not Found" && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            backgroundColor: roleMeta.color + "1a",
                            color: roleMeta.color,
                          }}
                        >
                          {roleMeta.label}
                        </span>
                      )}
                    </div>
                  </Field>
                )}

                {company.cfoLinkedin && (
                  <Field
                    icon={<Linkedin className="w-4 h-4 text-[#0A66C2]" />}
                    label="LinkedIn"
                  >
                    <a
                      href={company.cfoLinkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors duration-150 truncate max-w-[280px]"
                    >
                      {company.cfoLinkedin.replace(
                        "https://www.linkedin.com/in/",
                        "in/"
                      )}
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                  </Field>
                )}

                {company.cfoEmail && (
                  <Field icon={<Mail className="w-4 h-4" />} label="Email">
                    <span className="flex items-center gap-0.5">
                      <span className="text-slate-800">{company.cfoEmail}</span>
                      <CopyButton value={company.cfoEmail} />
                    </span>
                  </Field>
                )}

                {company.cfoTelefono && (
                  <Field icon={<Phone className="w-4 h-4" />} label="Phone">
                    <span className="flex items-center gap-0.5">
                      <span className="text-slate-800 font-mono">
                        {company.cfoTelefono}
                      </span>
                      <CopyButton value={company.cfoTelefono} />
                    </span>
                  </Field>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-400 italic">
                No contact found for this company.
              </div>
            )}

            {/* ── Annotations ── */}
            <div className="flex items-center justify-between mt-5 mb-1 px-0.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Annotations
              </p>
              <button
                onClick={() => setAnnotationOpen(true)}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 divide-y divide-slate-100">
              {hasAnn ? (
                <>
                  {ann?.contactLeft && (
                    <Field
                      icon={<UserX className="w-4 h-4 text-orange-500" />}
                      label="Contact Left"
                    >
                      <span className="text-orange-600 font-medium">
                        No longer at company
                      </span>
                    </Field>
                  )}
                  {ann?.lowQuality && (
                    <Field
                      icon={<ThumbsDown className="w-4 h-4 text-red-500" />}
                      label="Quality Flag"
                    >
                      <span className="text-red-600 font-medium">
                        Low quality / unverified
                      </span>
                    </Field>
                  )}
                  {ann?.note && (
                    <Field
                      icon={<StickyNote className="w-4 h-4 text-slate-400" />}
                      label="Note"
                    >
                      <span className="text-slate-700 whitespace-pre-wrap">
                        {ann.note}
                      </span>
                    </Field>
                  )}
                </>
              ) : (
                <div className="py-3 text-sm text-slate-400 italic">
                  No annotations yet.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AnnotationModal
        company={annotationOpen ? company : null}
        onClose={() => setAnnotationOpen(false)}
        onSave={(companyId, annotation) => {
          setAnnotationOpen(false);
          onAnnotationSave?.(companyId, annotation);
        }}
      />
    </>
  );
}
