import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ALL_COUNTRIES_VALUE, normalizeCountryCode } from "@/lib/constants";

// GET /api/companies/search?search=acme&limit=30&year=2026
export async function GET(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "30"), 100);
  const year = Number(req.nextUrl.searchParams.get("year") ?? "2026");
  const rawCountry = req.nextUrl.searchParams.get("country");
  const country =
    rawCountry && rawCountry !== ALL_COUNTRIES_VALUE
      ? normalizeCountryCode(rawCountry)
      : null;

  const hasCfo = req.nextUrl.searchParams.get("hasCfo") === "true";
  const noLinkedin = req.nextUrl.searchParams.get("noLinkedin") === "true";

  let query = supabase
    .from("all_companies")
    .select("id, name, sector, region, country, website, cfo_nome, cfo_ruolo, cfo_linkedin, data_origin")
    .eq("year", year)
    .order("rank", { ascending: true })
    .limit(limit);

  if (country) {
    query = query.eq("country", country);
  }

  if (q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`);
  }

  if (hasCfo) {
    query = query.not("cfo_nome", "is", null);
  }

  if (noLinkedin) {
    query = query.is("cfo_linkedin", null);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    (data ?? []).map((row) => ({
      id: row.id,
      azienda: row.name,
      settore: row.sector,
      regione: row.region,
      country: row.country,
      sito_web: row.website ?? null,
      cfo_nome: row.cfo_nome,
      cfo_ruolo: row.cfo_ruolo,
      cfo_linkedin: row.cfo_linkedin,
      data_origin: row.data_origin ?? "curated",
    }))
  );
}
