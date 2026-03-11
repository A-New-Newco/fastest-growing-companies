import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

  let query = supabase
    .from("companies_full")
    .select("id, name, sector, region, cfo_nome, cfo_ruolo, cfo_linkedin")
    .eq("year", year)
    .order("rank", { ascending: true })
    .limit(limit);

  if (q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`);
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
      cfo_nome: row.cfo_nome,
      cfo_ruolo: row.cfo_ruolo,
      cfo_linkedin: row.cfo_linkedin,
    }))
  );
}
