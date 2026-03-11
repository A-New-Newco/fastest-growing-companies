"use client";

import { useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCountryLabel, normalizeCountryCode } from "@/lib/constants";
import type { Company } from "@/types";
import { formatGrowth } from "@/lib/data";

interface RegionMapProps {
  companies: Company[];
}

interface RegionData {
  count: number;
  avgGrowth: number;
  displayName: string;
}

interface TooltipState {
  name: string;
  data: RegionData | null;
  x: number;
  y: number;
}

interface RegionRankDatum {
  label: string;
  region: string;
  country: string;
  count: number;
  avgGrowth: number;
}

interface CountryMapConfig {
  geoUrl: string;
  center: [number, number];
  scale: number;
  geoNameProp: string;
  title: string;
  subtitle: string;
}

const COUNTRY_MAP_CONFIGS: Record<string, CountryMapConfig> = {
  IT: {
    geoUrl: "/geo/italy-regions.json",
    center: [12.5, 42],
    scale: 2200,
    geoNameProp: "reg_name",
    title: "Companies by Italian Region",
    subtitle: "Color intensity = number of companies. Hover for details.",
  },
  DE: {
    geoUrl: "/geo/germany-regions.json",
    center: [10.4, 51.2],
    scale: 3000,
    geoNameProp: "name",
    title: "Companies by German State",
    subtitle: "Color intensity = number of companies. Hover for details.",
  },
};

const IT_REGION_ALIASES: Record<string, string> = {
  "Valle d'Aosta/Vallée d'Aoste": "Aosta Valley",
  "Trentino-Alto Adige/Südtirol": "Trentino-South Tyrol",
  Lombardia: "Lombardy",
  Piemonte: "Piedmont",
  Puglia: "Apulia",
  Sardegna: "Sardinia",
  Sicilia: "Sicily",
  Toscana: "Tuscany",
  "Trentino-Alto Adige": "Trentino-South Tyrol",
  "Valle d'Aosta": "Aosta Valley",
};

const DE_REGION_ALIASES: Record<string, string> = {
  "Baden-Württemberg": "Baden-Wurttemberg",
  "Baden Wurttemberg": "Baden-Wurttemberg",
  Bayern: "Bavaria",
  Hessen: "Hesse",
  Niedersachsen: "Lower Saxony",
  "Nordrhein-Westfalen": "North Rhine-Westphalia",
  "Rheinland-Pfalz": "Rhineland-Palatinate",
  "Mecklenburg-Vorpommern": "Mecklenburg-Western Pomerania",
  Sachsen: "Saxony",
  "Sachsen-Anhalt": "Saxony-Anhalt",
  Thüringen: "Thuringia",
  Thuringen: "Thuringia",
  "North Rhine Westphalia": "North Rhine-Westphalia",
  "Rhineland Palatinate": "Rhineland-Palatinate",
  "Lower-Saxony": "Lower Saxony",
  "Mecklenburg Western Pomerania": "Mecklenburg-Western Pomerania",
};

const REGION_ALIAS_BY_COUNTRY: Record<string, Record<string, string>> = {
  IT: IT_REGION_ALIASES,
  DE: DE_REGION_ALIASES,
};

function normalizeRegionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAliasMap(countryCode: string): Record<string, string> {
  const raw = REGION_ALIAS_BY_COUNTRY[countryCode] ?? {};
  const normalized: Record<string, string> = {};
  for (const [from, to] of Object.entries(raw)) {
    normalized[normalizeRegionKey(from)] = to;
  }
  return normalized;
}

function normalizeRegionName(countryCode: string, raw: string): string {
  const value = raw.trim();
  if (!value) return "Unknown";
  const aliases = getAliasMap(countryCode);
  return aliases[normalizeRegionKey(value)] ?? value;
}

function getGeoRegionName(
  countryCode: string,
  geo: { properties?: Record<string, unknown> },
  fallback: string
): string {
  const config = COUNTRY_MAP_CONFIGS[countryCode];
  const rawValue = config ? geo.properties?.[config.geoNameProp] : null;
  const raw = typeof rawValue === "string" && rawValue.trim() ? rawValue : fallback;
  return normalizeRegionName(countryCode, raw);
}

function RegionRankingTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d: RegionRankDatum = payload[0]?.payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2.5 text-xs">
      <p className="font-semibold text-slate-900 mb-1">{label}</p>
      <p className="text-slate-600">
        <span className="font-medium">{d?.count}</span> companies
      </p>
      <p className="text-slate-600">
        Avg. growth: <span className="font-medium">{formatGrowth(d?.avgGrowth ?? 0)}</span>
      </p>
      <p className="text-slate-500 mt-1">{getCountryLabel(d?.country ?? "")}</p>
    </div>
  );
}

export default function RegionMap({ companies }: RegionMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const countries = useMemo(
    () => [...new Set(companies.map((c) => normalizeCountryCode(c.country)))],
    [companies]
  );

  const selectedCountry = countries.length === 1 ? countries[0] : null;
  const mapConfig = selectedCountry ? COUNTRY_MAP_CONFIGS[selectedCountry] : null;

  const regionStats = useMemo(() => {
    const map = new Map<string, RegionData>();

    for (const c of companies) {
      const countryCode = normalizeCountryCode(c.country);
      const normalizedName = normalizeRegionName(countryCode, c.regione || "Unknown");
      const key = normalizeRegionKey(normalizedName);

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          count: 1,
          avgGrowth: c.tassoCrescita,
          displayName: normalizedName,
        });
      } else {
        const total = existing.avgGrowth * existing.count + c.tassoCrescita;
        const newCount = existing.count + 1;
        map.set(key, {
          ...existing,
          count: newCount,
          avgGrowth: total / newCount,
        });
      }
    }

    return map;
  }, [companies]);

  const maxCount = useMemo(() => {
    const counts = Array.from(regionStats.values()).map((d) => d.count);
    return counts.length > 0 ? Math.max(...counts) : 1;
  }, [regionStats]);

  const regionRankingData = useMemo<RegionRankDatum[]>(() => {
    const map = new Map<
      string,
      { region: string; country: string; count: number; growthSum: number }
    >();

    for (const c of companies) {
      const country = normalizeCountryCode(c.country);
      const region = normalizeRegionName(country, c.regione || "Unknown");
      const key = `${country}::${normalizeRegionKey(region)}`;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, { region, country, count: 1, growthSum: c.tassoCrescita });
      } else {
        map.set(key, {
          ...existing,
          count: existing.count + 1,
          growthSum: existing.growthSum + c.tassoCrescita,
        });
      }
    }

    const multiCountry = countries.length > 1;

    return Array.from(map.values())
      .map((entry) => ({
        region: entry.region,
        country: entry.country,
        count: entry.count,
        avgGrowth: entry.growthSum / entry.count,
        label: multiCountry ? `${entry.country} · ${entry.region}` : entry.region,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [companies, countries.length]);

  function getColor(regionName: string): string {
    const key = normalizeRegionKey(regionName);
    const data = regionStats.get(key);
    if (!data) return "#f1f5f9";

    const intensity = data.count / maxCount;
    // Indigo palette: from #e0e7ff (low) to #312e81 (high)
    const r = Math.round(224 - intensity * (224 - 49));
    const g = Math.round(231 - intensity * (231 - 46));
    const b = Math.round(255 - intensity * (255 - 129));
    return `rgb(${r},${g},${b})`;
  }

  if (!mapConfig || !selectedCountry) {
    const countryScope =
      countries.length === 1 ? getCountryLabel(countries[0]) : "selected countries";

    return (
      <Card className="border-slate-200 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-900">
            Companies by Region
          </CardTitle>
          <p className="text-xs text-slate-500">
            Regional map is available for Italy and Germany. Showing ranking for {countryScope}.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={Math.max(320, regionRankingData.length * 30)}>
            <BarChart
              data={regionRankingData}
              layout="vertical"
              margin={{ top: 4, right: 42, bottom: 4, left: 8 }}
              barCategoryGap="25%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={170}
              />
              <Tooltip content={<RegionRankingTooltip />} />
              <Bar dataKey="count" fill="#4f46e5" radius={[0, 4, 4, 0]} fillOpacity={0.85}>
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fontSize: 10, fill: "#94a3b8" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          {mapConfig.title}
        </CardTitle>
        <p className="text-xs text-slate-500">{mapConfig.subtitle}</p>
      </CardHeader>
      <CardContent className="relative">
        <div className="w-full" style={{ height: 480 }}>
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              center: mapConfig.center,
              scale: mapConfig.scale,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <ZoomableGroup center={mapConfig.center} zoom={1}>
              <Geographies geography={mapConfig.geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const regionName = getGeoRegionName(
                      selectedCountry,
                      geo as { properties?: Record<string, unknown> },
                      (geo as { id?: string }).id ?? "Unknown"
                    );
                    const data = regionStats.get(normalizeRegionKey(regionName));

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={getColor(regionName)}
                        stroke="#ffffff"
                        strokeWidth={0.8}
                        style={{
                          default: { outline: "none", cursor: "pointer" },
                          hover: {
                            outline: "none",
                            fill: "#4f46e5",
                            fillOpacity: 0.7,
                          },
                          pressed: { outline: "none" },
                        }}
                        onMouseEnter={(e) => {
                          setTooltip({
                            name: regionName,
                            data: data ?? null,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onMouseMove={(e) => {
                          setTooltip((prev) =>
                            prev ? { ...prev, x: e.clientX, y: e.clientY } : null
                          );
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  })
                }
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>
        </div>

        {/* Color scale legend */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-slate-400">Fewer companies</span>
          <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-[#e0e7ff] to-[#312e81]" />
          <span className="text-xs text-slate-400">More companies</span>
        </div>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-xs pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}
          >
            <p className="font-semibold text-slate-900 mb-1">{tooltip.name}</p>
            {tooltip.data ? (
              <>
                <p className="text-slate-600">
                  <span className="font-medium">{tooltip.data.count}</span>{" "}
                  companies
                </p>
                <p className="text-slate-600">
                  Avg. growth:{" "}
                  <span className="font-medium">
                    {formatGrowth(tooltip.data.avgGrowth)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-slate-400">No companies</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
