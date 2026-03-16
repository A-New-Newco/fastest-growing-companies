"use client";

import { useEffect, useState, useMemo } from "react";
import {
  loadCompanies,
  filterCompanies,
  getUniqueSettori,
  getUniqueRegioni,
  getUniqueSourceNames,
} from "@/lib/data";
import type { Annotation, Company } from "@/types";
import { useFilters } from "@/lib/filter-context";
import { cn } from "@/lib/utils";
import { TableIcon, BarChart2, CheckSquare, Upload } from "lucide-react";
import FileUploadWizard from "@/components/imports/FileUploadWizard";
import SidebarFilter from "@/components/explorer/SidebarFilter";
import CompanyTable from "@/components/explorer/CompanyTable";
import CompanyDetailModal from "@/components/explorer/CompanyDetailModal";
import CfoPresenceBySettore from "@/components/charts/CfoPresenceBySettore";
import CfoPresenceByRegione from "@/components/charts/CfoPresenceByRegione";
import GrowthByCfoPresence from "@/components/charts/GrowthByCfoPresence";
import RevenueByCfoPresence from "@/components/charts/RevenueByCfoPresence";
import TopSectorsBar from "@/components/charts/TopSectorsBar";
import RoleDistributionPie from "@/components/charts/RoleDistributionPie";
import ConfidenceBar from "@/components/charts/ConfidenceBar";
import GrowthRevenueScatter from "@/components/charts/GrowthRevenueScatter";
import RegionMap from "@/components/charts/RegionMap";

type View = "table" | "charts";

function SidebarSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {[80, 32, 64, 64, 32, 32, 32].map((w, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-16 bg-slate-100 rounded" />
          <div className={`h-8 bg-slate-100 rounded`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[420, 340, 340, 380, 320, 460, 320, 320, 420, 520].map((h, i) => (
        <div key={i} className="w-full bg-slate-100 rounded-lg" style={{ height: h }} />
      ))}
    </div>
  );
}

function ChartsView({ companies }: { companies: Company[] }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
          CFO Presence Analysis
        </h2>
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CfoPresenceBySettore companies={companies} />
            <CfoPresenceByRegione companies={companies} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GrowthByCfoPresence companies={companies} />
            <RevenueByCfoPresence companies={companies} />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
          General Analytics
        </h2>
        <div className="space-y-6">
          <GrowthRevenueScatter companies={companies} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RoleDistributionPie companies={companies} />
            <ConfidenceBar companies={companies} />
          </div>
          <TopSectorsBar companies={companies} />
          <RegionMap companies={companies} />
        </div>
      </div>
    </div>
  );
}

export default function ExplorerPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("table");
  const [selectionMode, setSelectionMode] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const { filters, setFilters } = useFilters();

  function handleImportComplete(importedCount: number) {
    // Reload companies to include newly imported data
    loadCompanies(2026, filters.country)
      .then(setCompanies)
      .catch(console.error);
    console.log(`Import complete: ${importedCount} companies added`);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    loadCompanies(2026, filters.country)
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.country]);

  function handleAnnotationSave(
    companyId: string,
    annotation: Omit<Annotation, "companyId">
  ) {
    const updated = { companyId, ...annotation };
    setCompanies((prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, annotation: updated } : c))
    );
    setSelectedCompany((prev) =>
      prev?.id === companyId ? { ...prev, annotation: updated } : prev
    );
  }

  function handleCompaniesDeleted(companyIds: string[]) {
    const deletedSet = new Set(companyIds);
    setCompanies((prev) => prev.filter((c) => !deletedSet.has(c.id)));
  }

  function handleLinkedInUpdate(companyId: string, linkedinUrl: string) {
    setCompanies((prev) =>
      prev.map((c) => (c.id === companyId ? { ...c, cfoLinkedin: linkedinUrl } : c))
    );
  }

  const settori = useMemo(() => getUniqueSettori(companies), [companies]);
  const regioni = useMemo(() => getUniqueRegioni(companies), [companies]);
  const sourceNames = useMemo(() => getUniqueSourceNames(companies), [companies]);

  const filtered = useMemo(
    () => filterCompanies(companies, filters),
    [companies, filters]
  );

  return (
    <div className="flex h-full">
      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-[250px] xl:w-[270px] flex-shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        {loading ? (
          <SidebarSkeleton />
        ) : (
          <SidebarFilter
            filters={filters}
            onChange={setFilters}
            settori={settori}
            regioni={regioni}
            sourceNames={sourceNames}
            resultCount={filtered.length}
            totalCount={companies.length}
          />
        )}
      </aside>

      {/* ── Right content area ────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* View-toggle bar */}
        <div className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-3">
          <div className="flex items-center rounded-md border border-slate-200 overflow-hidden bg-slate-50 p-0.5 gap-0.5">
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-all",
                view === "table"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <TableIcon className="w-3.5 h-3.5" />
              Table
            </button>
            <button
              onClick={() => setView("charts")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-all",
                view === "charts"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Charts
            </button>
          </div>

          {/* Selection mode toggle (table view only) */}
          {view === "table" && (
            <button
              onClick={() => setSelectionMode((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all",
                selectionMode
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300"
              )}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {selectionMode ? "Selecting" : "Select"}
            </button>
          )}

          <span className="text-xs text-slate-400 tabular-nums ml-auto">
            <span className="font-semibold text-slate-700">{filtered.length}</span>
            {" / "}
            {companies.length} companies
          </span>

          {/* Import data button */}
          <button
            onClick={() => setImportWizardOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            Import data
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            view === "table" ? (
              <div className="h-80 bg-slate-100 rounded animate-pulse" />
            ) : (
              <ChartsSkeleton />
            )
          ) : view === "table" ? (
            <CompanyTable
              companies={filtered}
              onAnnotationSave={handleAnnotationSave}
              onCompaniesDeleted={handleCompaniesDeleted}
              onLinkedInUpdate={handleLinkedInUpdate}
              onCompanyClick={setSelectedCompany}
              selectionMode={selectionMode}
            />
          ) : (
            <ChartsView companies={filtered} />
          )}
        </div>
      </div>

      <FileUploadWizard
        open={importWizardOpen}
        onClose={() => setImportWizardOpen(false)}
        onImportComplete={handleImportComplete}
      />

      <CompanyDetailModal
        company={selectedCompany}
        onClose={() => setSelectedCompany(null)}
        onAnnotationSave={handleAnnotationSave}
      />
    </div>
  );
}
