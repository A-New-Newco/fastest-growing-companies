"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { FilterState } from "@/types";
import { DEFAULT_FILTER_STATE } from "@/lib/constants";

interface FilterContextValue {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTER_STATE });
  return (
    <FilterContext.Provider value={{ filters, setFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within FilterProvider");
  return ctx;
}
