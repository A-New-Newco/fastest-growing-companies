"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/explorer", label: "Explorer" },
  { href: "/charts", label: "Charts" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full bg-slate-900 border-b border-slate-700/60">
      <div className="mx-auto max-w-screen-xl px-6 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-indigo-600 group-hover:bg-indigo-500 transition-colors">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">
            Leader della Crescita
          </span>
          <span className="ml-0.5 inline-flex items-center rounded-full bg-indigo-600/20 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 tracking-wider">
            2026
          </span>
        </Link>

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
        </nav>
      </div>
    </header>
  );
}
