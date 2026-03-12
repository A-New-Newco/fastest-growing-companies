"use client";

import { AuthProvider } from "@/lib/auth-context";
import { FilterProvider } from "@/lib/filter-context";
import type { ReactNode } from "react";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <FilterProvider>{children}</FilterProvider>
    </AuthProvider>
  );
}
