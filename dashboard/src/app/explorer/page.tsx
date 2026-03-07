"use client";

import { useEffect, useState, useMemo } from "react";
import {
  loadCompanies,
  filterCompanies,
  getUniqueSettori,
  getUniqueRegioni,
} from "@/lib/data";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";
import type { Company, FilterState } from "@/types";
import FilterBar from "@/components/explorer/FilterBar";
import CompanyTable from "@/components/explorer/CompanyTable";

export default function ExplorerPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTER_STATE });

  useEffect(() => {
    loadCompanies()
      .then(setCompanies)
      .finally(() => setLoading(false));
  }, []);

  const settori = useMemo(() => getUniqueSettori(companies), [companies]);
  const regioni = useMemo(() => getUniqueRegioni(companies), [companies]);

  const filtered = useMemo(
    () => filterCompanies(companies, filters),
    [companies, filters]
  );

  return (
    <div className="space-y-4">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Company Explorer
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Filter, sort, and search all 500 companies in the 2026 ranking.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-8 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-80 w-full bg-slate-100 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            settori={settori}
            regioni={regioni}
            resultCount={filtered.length}
            totalCount={companies.length}
          />
          <CompanyTable companies={filtered} />
        </>
      )}
    </div>
  );
}
