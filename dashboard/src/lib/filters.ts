import type { Company, ChartFilterState } from "@/types";

export const DEFAULT_CHART_FILTERS: ChartFilterState = {
  settori: [],
  regioni: [],
  cfoPresence: "all",
  growthRange: [0, 600],
};

export function applyChartFilters(
  companies: Company[],
  f: ChartFilterState
): Company[] {
  return companies.filter(
    (c) =>
      (f.settori.length === 0 || f.settori.includes(c.settore)) &&
      (f.regioni.length === 0 || f.regioni.includes(c.regione)) &&
      (f.cfoPresence === "all" ||
        (f.cfoPresence === "has" ? c.hasRealCfo : !c.hasRealCfo)) &&
      c.tassoCrescita >= f.growthRange[0] &&
      c.tassoCrescita <= f.growthRange[1]
  );
}

export function hasActiveFilters(f: ChartFilterState): boolean {
  return (
    f.settori.length > 0 ||
    f.regioni.length > 0 ||
    f.cfoPresence !== "all" ||
    f.growthRange[0] > 0 ||
    f.growthRange[1] < 600
  );
}
