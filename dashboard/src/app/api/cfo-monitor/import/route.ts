import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CompanyResult } from "@/lib/enrichment-client";

interface ImportBody {
  dataset_id: string;
  country_code: string;
  year: number;
  companies: CompanyResult[];
}

// POST /api/cfo-monitor/import
// Updates CFO fields on existing imported_companies records (matched by
// national_rank + year + country_code). Does NOT create new company records.
// Also cleans up any legacy "cfo-monitor-*" standalone records from prior runs.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: "Not a team member" }, { status: 403 });

  const body = (await req.json()) as ImportBody;
  const { dataset_id, country_code, year, companies } = body;

  if (!country_code || !year || !Array.isArray(companies) || companies.length === 0) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const normalizedCountry = country_code.toUpperCase().slice(0, 2);

  // Update CFO fields on existing imported_companies rows matched by rank+year+country
  const results = await Promise.all(
    companies.map((c) =>
      admin
        .from("imported_companies")
        .update({
          cfo_nome: c.cfo_nome ?? null,
          cfo_ruolo: c.cfo_ruolo ?? null,
          cfo_linkedin: c.cfo_linkedin ?? null,
          cfo_confidenza: c.confidenza ?? null,
        })
        .eq("team_id", membership.team_id)
        .eq("national_rank", c.rank)
        .eq("year", year)
        .eq("country_code", normalizedCountry)
    )
  );

  const updated = results.filter((r) => !r.error).length;

  // Clean up any legacy standalone records created by the old insert-based logic
  if (dataset_id) {
    const legacySourceName = `cfo-monitor-${dataset_id}`;
    await admin
      .from("imported_companies")
      .delete()
      .eq("team_id", membership.team_id)
      .eq("source_name", legacySourceName);
    await admin
      .from("import_batches")
      .delete()
      .eq("team_id", membership.team_id)
      .eq("source_name", legacySourceName);
  }

  return NextResponse.json({ updated });
}

// GET /api/cfo-monitor/import?country_code=DE&year=2026
// Returns national_rank values of existing imported_companies that already have CFO data.
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const countryCode = req.nextUrl.searchParams.get("country_code");
  const year = req.nextUrl.searchParams.get("year");
  if (!countryCode || !year) {
    return NextResponse.json({ error: "country_code and year required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("imported_companies")
    .select("national_rank")
    .eq("country_code", countryCode.toUpperCase().slice(0, 2))
    .eq("year", Number(year))
    .not("cfo_nome", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    imported_ranks: (data ?? []).map((r) => r.national_rank as number).filter(Boolean),
  });
}
