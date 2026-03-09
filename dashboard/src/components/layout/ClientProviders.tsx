"use client";

import { FilterProvider } from "@/lib/filter-context";
import type { ReactNode } from "react";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return <FilterProvider>{children}</FilterProvider>;
}
