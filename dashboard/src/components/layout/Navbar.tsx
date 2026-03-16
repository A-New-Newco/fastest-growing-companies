"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Globe,
  LayoutDashboard,
  Table2,
  Send,
  Sparkles,
  Activity,
  Linkedin,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
      <rect width="28" height="28" rx="6" fill="#4f46e5" />
      <rect x="5" y="17" width="4" height="7" rx="1" fill="white" fillOpacity="0.45" />
      <rect x="11" y="12" width="4" height="12" rx="1" fill="white" fillOpacity="0.65" />
      <rect x="17" y="7" width="4" height="17" rx="1" fill="white" fillOpacity="0.85" />
      <polyline
        points="4,20 11,13 17,8 24,4"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
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
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/explorer", label: "Explorer", icon: Table2 },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/enrichment", label: "Enrichment", icon: Sparkles },
  { href: "/cfo-monitor", label: "CFO Monitor", icon: Activity },
  { href: "/linkedin-monitor", label: "LI Monitor", icon: Linkedin },
];

const ADMIN_LINKS = [
  { href: "/admin/team", label: "Team", icon: Users },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAdmin, signOut } = useAuth();
  const { filters, setFilters } = useFilters();
  const [countries, setCountries] = useState<string[]>([DEFAULT_COUNTRY]);
  const [collapsed, setCollapsed] = useState(false);

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
    return () => { cancelled = true; };
  }, [user]);

  const selectedCountry =
    filters.country === ALL_COUNTRIES_VALUE
      ? ALL_COUNTRIES_VALUE
      : normalizeCountryCode(filters.country);

  const countryOptions = useMemo(() => {
    const codes = new Set(countries.map((c) => normalizeCountryCode(c)));
    if (selectedCountry !== ALL_COUNTRIES_VALUE) codes.add(selectedCountry);
    return [ALL_COUNTRIES_VALUE, ...Array.from(codes).sort()];
  }, [countries, selectedCountry]);

  function handleCountryChange(value: string) {
    const country =
      value === ALL_COUNTRIES_VALUE ? ALL_COUNTRIES_VALUE : normalizeCountryCode(value);
    setFilters({ ...DEFAULT_FILTER_STATE, country });
  }

  const userInitial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex flex-col flex-shrink-0 bg-slate-900 border-r border-slate-700/60 h-screen overflow-y-auto overflow-x-hidden transition-all duration-200",
          collapsed ? "w-14" : "w-52"
        )}
      >
        {/* Top: logo + collapse toggle */}
        <div className={cn("flex items-center h-14 flex-shrink-0 px-3", collapsed ? "justify-center" : "justify-start")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/" className="transition-transform hover:scale-105 duration-150">
                  <LogoMark />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Leaders of Growth 2026</TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/" className="flex items-center gap-2.5 group min-w-0">
              <div className="transition-transform group-hover:scale-105 duration-150 flex-shrink-0">
                <LogoMark />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-white font-semibold text-sm leading-tight truncate">
                  Leaders of Growth
                </span>
                <span className="inline-flex items-center rounded-full bg-indigo-600/20 border border-indigo-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300 tracking-wider w-fit mt-0.5">
                  2026
                </span>
              </div>
            </Link>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center rounded-md text-sm transition-all duration-150",
                      collapsed ? "justify-center p-2" : "gap-3 px-3 py-2 border-l-2 pl-[10px]",
                      isActive
                        ? collapsed
                          ? "bg-white/10 text-white"
                          : "bg-white/10 text-white font-medium border-indigo-500"
                        : collapsed
                          ? "text-slate-400 hover:text-white hover:bg-white/5"
                          : "text-slate-400 hover:text-white hover:bg-white/5 border-transparent"
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && label}
                  </Link>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">{label}</TooltipContent>
                )}
              </Tooltip>
            );
          })}

          {isAdmin && ADMIN_LINKS.length > 0 && (
            <>
              <div className={cn("my-2 border-t border-slate-700/60", collapsed ? "mx-1" : "mx-3")} />
              {ADMIN_LINKS.map(({ href, label, icon: Icon }) => {
                const isActive = pathname.startsWith(href);
                return (
                  <Tooltip key={href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={href}
                        className={cn(
                          "flex items-center rounded-md text-sm transition-all duration-150",
                          collapsed ? "justify-center p-2" : "gap-3 px-3 py-2 border-l-2 pl-[10px]",
                          isActive
                            ? collapsed
                              ? "bg-white/10 text-white"
                              : "bg-white/10 text-white font-medium border-indigo-500"
                            : collapsed
                              ? "text-slate-400 hover:text-white hover:bg-white/5"
                              : "text-slate-400 hover:text-white hover:bg-white/5 border-transparent"
                        )}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {!collapsed && label}
                      </Link>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right">{label}</TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </>
          )}
        </nav>

        {/* Bottom: country + user + expand toggle */}
        <div className={cn("border-t border-slate-700/60 space-y-1 py-3", collapsed ? "px-2" : "px-3")}>
          {/* Country selector */}
          {user && (
            collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setCollapsed(false)}
                    className="w-full flex justify-center p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                    aria-label="Country selector"
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{getCountryLabel(selectedCountry)}</TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-2 pb-1">
                <Globe className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <Select value={selectedCountry} onValueChange={handleCountryChange}>
                  <SelectTrigger className="h-8 flex-1 border-slate-700 bg-slate-800/80 text-slate-100 text-xs focus:ring-indigo-500 focus:ring-offset-slate-900">
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
            )
          )}

          {/* User */}
          {user && (
            collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => signOut()}
                    className="w-full flex justify-center p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                    aria-label="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {user.email} — Sign out
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-slate-500 truncate px-1">{user.email}</p>
                <button
                  onClick={() => signOut()}
                  className="w-full text-left text-xs text-slate-400 hover:text-white px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            )
          )}

          {/* Collapse / expand toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCollapsed((v) => !v)}
                className={cn(
                  "w-full flex p-2 rounded-md text-slate-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer mt-1",
                  collapsed ? "justify-center" : "justify-start gap-2"
                )}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <>
                    <PanelLeftClose className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs">Collapse</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            )}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
