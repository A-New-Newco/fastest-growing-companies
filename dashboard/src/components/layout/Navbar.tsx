"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadAvailableCountries } from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import { useFilters } from "@/lib/filter-context";
import {
  ALL_COUNTRIES_VALUE,
  DEFAULT_COUNTRY,
  DEFAULT_FILTER_STATE,
  getCountryLabel,
  normalizeCountryCode,
} from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function LogoMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Background rounded square */}
      <rect width="28" height="28" rx="6" fill="#4f46e5" />

      {/* Bar chart columns — ascending left to right */}
      <rect x="5" y="17" width="4" height="7" rx="1" fill="white" fillOpacity="0.45" />
      <rect x="11" y="12" width="4" height="12" rx="1" fill="white" fillOpacity="0.65" />
      <rect x="17" y="7" width="4" height="17" rx="1" fill="white" fillOpacity="0.85" />

      {/* Trend arrow: line + arrowhead going up-right over the bars */}
      <polyline
        points="4,20 11,13 17,8 24,4"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Arrowhead tip */}
      <polyline
        points="20,3 24,4 23,8"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/explorer", label: "Explorer" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/enrichment", label: "Enrichment" },
];

const ADMIN_LINKS = [
  { href: "/admin/team", label: "Team" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAdmin, signOut } = useAuth();
  const { filters, setFilters } = useFilters();
  const [countries, setCountries] = useState<string[]>([DEFAULT_COUNTRY]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    loadAvailableCountries()
      .then((rows) => {
        if (cancelled) return;
        setCountries(rows.length > 0 ? rows : [DEFAULT_COUNTRY]);
      })
      .catch(() => {
        if (!cancelled) {
          setCountries((prev) => (prev.length > 0 ? prev : [DEFAULT_COUNTRY]));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectedCountry =
    filters.country === ALL_COUNTRIES_VALUE
      ? ALL_COUNTRIES_VALUE
      : normalizeCountryCode(filters.country);

  const countryOptions = useMemo(() => {
    const codes = new Set(countries.map((c) => normalizeCountryCode(c)));
    if (selectedCountry !== ALL_COUNTRIES_VALUE) {
      codes.add(selectedCountry);
    }
    return [ALL_COUNTRIES_VALUE, ...Array.from(codes).sort()];
  }, [countries, selectedCountry]);

  function handleCountryChange(value: string) {
    const country =
      value === ALL_COUNTRIES_VALUE ? ALL_COUNTRIES_VALUE : normalizeCountryCode(value);
    // Country switch resets local filters to avoid stale sector/region criteria.
    setFilters({ ...DEFAULT_FILTER_STATE, country });
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-slate-900 border-b border-slate-700/60">
      <div className="mx-auto max-w-screen-xl px-6 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="transition-transform group-hover:scale-105 duration-150">
            <LogoMark />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">
            Leaders of Growth
          </span>
          <span className="ml-0.5 inline-flex items-center rounded-full bg-indigo-600/20 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 tracking-wider">
            2026
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => {
              const isActive =
                href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative px-3.5 py-1.5 text-sm rounded-md transition-all duration-150",
                    isActive
                      ? "text-white bg-white/10 font-medium"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  {label}
                  {isActive && (
                    <span className="absolute inset-x-3.5 -bottom-[1px] h-[2px] bg-indigo-500 rounded-full" />
                  )}
                </Link>
              );
            })}

            {isAdmin &&
              ADMIN_LINKS.map(({ href, label }) => {
                const isActive = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "relative px-3.5 py-1.5 text-sm rounded-md transition-all duration-150",
                      isActive
                        ? "text-white bg-white/10 font-medium"
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    {label}
                    {isActive && (
                      <span className="absolute inset-x-3.5 -bottom-[1px] h-[2px] bg-indigo-500 rounded-full" />
                    )}
                  </Link>
                );
              })}
          </nav>

          {/* Country selector */}
          {user && (
            <div className="hidden md:flex items-center gap-2 ml-3 pl-3 border-l border-slate-700">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <Select value={selectedCountry} onValueChange={handleCountryChange}>
                <SelectTrigger className="h-8 w-[156px] border-slate-700 bg-slate-800/80 text-slate-100 text-xs focus:ring-indigo-500 focus:ring-offset-slate-900">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
                  {countryOptions.map((code) => (
                    <SelectItem
                      key={code}
                      value={code}
                      className="text-xs text-slate-100 focus:bg-slate-800 focus:text-white"
                    >
                      {getCountryLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* User menu */}
          {user && (
            <div className="flex items-center gap-2 ml-3 pl-3 border-l border-slate-700">
              <span className="text-xs text-slate-400 max-w-[160px] truncate hidden sm:block">
                {user.email}
              </span>
              <button
                onClick={() => signOut()}
                className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-md hover:bg-white/5 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
