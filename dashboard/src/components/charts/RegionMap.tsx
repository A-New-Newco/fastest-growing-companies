"use client";

import { useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company } from "@/types";
import { formatGrowth } from "@/lib/data";

const GEO_URL = "/geo/italy-regions.json";

// Mapping from GeoJSON reg_name aliases to canonical region names
const GEO_ALIASES: Record<string, string> = {
  "Valle d'Aosta/Vallée d'Aoste": "Valle d'Aosta",
  "Trentino-Alto Adige/Südtirol": "Trentino-Alto Adige",
};

const REGION_TRANSLATIONS: Record<string, string> = {
  Lombardia: "Lombardy",
  Piemonte: "Piedmont",
  Puglia: "Apulia",
  Sardegna: "Sardinia",
  Sicilia: "Sicily",
  Toscana: "Tuscany",
  "Trentino-Alto Adige": "Trentino-South Tyrol",
  "Valle d'Aosta": "Aosta Valley",
};

function normalizeGeoName(geoName: string): string {
  const canonical = GEO_ALIASES[geoName] ?? geoName;
  return REGION_TRANSLATIONS[canonical] ?? canonical;
}

interface RegionMapProps {
  companies: Company[];
}

interface RegionData {
  count: number;
  avgGrowth: number;
}

interface TooltipState {
  name: string;
  data: RegionData | null;
  x: number;
  y: number;
}

export default function RegionMap({ companies }: RegionMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const regionStats = useMemo(() => {
    const map = new Map<string, RegionData>();
    for (const c of companies) {
      const existing = map.get(c.regione);
      if (!existing) {
        map.set(c.regione, { count: 1, avgGrowth: c.tassoCrescita });
      } else {
        const total = existing.avgGrowth * existing.count + c.tassoCrescita;
        const newCount = existing.count + 1;
        map.set(c.regione, {
          count: newCount,
          avgGrowth: total / newCount,
        });
      }
    }
    return map;
  }, [companies]);

  const maxCount = useMemo(
    () => Math.max(...Array.from(regionStats.values()).map((d) => d.count)),
    [regionStats]
  );

  function getColor(regionName: string): string {
    const csvName = normalizeGeoName(regionName);
    const data = regionStats.get(csvName);
    if (!data) return "#f1f5f9";
    const intensity = data.count / maxCount;
    // Indigo palette: from #e0e7ff (low) to #312e81 (high)
    const r = Math.round(224 - intensity * (224 - 49));
    const g = Math.round(231 - intensity * (231 - 46));
    const b = Math.round(255 - intensity * (255 - 129));
    return `rgb(${r},${g},${b})`;
  }

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">
          Companies by Italian Region
        </CardTitle>
        <p className="text-xs text-slate-500">
          Color intensity = number of companies. Hover for details.
        </p>
      </CardHeader>
      <CardContent className="relative">
        <div className="w-full" style={{ height: 480 }}>
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              center: [12.5, 42],
              scale: 2200,
            }}
            style={{ width: "100%", height: "100%" }}
          >
            <ZoomableGroup center={[12.5, 42]} zoom={1}>
              <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const geoName = geo.properties.reg_name as string;
                    const csvName = normalizeGeoName(geoName);
                    const data = regionStats.get(csvName);
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={getColor(geoName)}
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
                            name: csvName,
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
