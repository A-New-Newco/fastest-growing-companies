import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

interface ImportItem {
  id: string;
  linkedin_url: string;
}

// POST /api/linkedin-monitor/import
// Bulk-saves LinkedIn URLs found by the LinkedIn enricher agent back to the DB.
// Each item has { id (company UUID), linkedin_url }.
// Determines curated vs imported by checking which table the id belongs to.
export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { items: ImportItem[] };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  let updated = 0;

  const ids = body.items.map((i) => i.id);

  // Check which IDs exist in imported_companies
  const { data: importedRows } = await admin
    .from("imported_companies")
    .select("id")
    .in("id", ids);
  const importedIds = new Set((importedRows ?? []).map((r) => r.id as string));

  // Check which IDs exist in curated companies
  const { data: curatedRows } = await admin
    .from("companies")
    .select("id")
    .in("id", ids);
  const curatedIds = new Set((curatedRows ?? []).map((r) => r.id as string));

  // Resolve IDs that belong to enrichment_session_companies → real company_id
  const unresolvedIds = ids.filter((id) => !importedIds.has(id) && !curatedIds.has(id));
  const escMap = new Map<string, { companyId: string; origin: string }>();
  if (unresolvedIds.length > 0) {
    const { data: escRows } = await admin
      .from("enrichment_session_companies")
      .select("id, company_id, company_origin")
      .in("id", unresolvedIds);
    for (const r of escRows ?? []) {
      escMap.set(r.id as string, {
        companyId: r.company_id as string,
        origin: r.company_origin as string,
      });
    }
  }

  for (const item of body.items) {
    if (!item.linkedin_url) continue;

    // Resolve the actual company ID and origin
    let companyId = item.id;
    let isImported = importedIds.has(item.id);

    if (!isImported && !curatedIds.has(item.id) && escMap.has(item.id)) {
      const resolved = escMap.get(item.id)!;
      companyId = resolved.companyId;
      isImported = resolved.origin === "imported";
    }

    if (isImported) {
      // Imported company — update directly
      const { error } = await admin
        .from("imported_companies")
        .update({ cfo_linkedin: item.linkedin_url })
        .eq("id", companyId);
      if (!error) updated++;
    } else {
      // Curated company — update contacts table
      const { data: rows, error: updateErr } = await admin
        .from("contacts")
        .update({ linkedin: item.linkedin_url })
        .eq("company_id", companyId)
        .select("id");

      if (!updateErr && rows && rows.length > 0) {
        updated++;
      } else if (!updateErr) {
        // No contacts row — insert minimal one
        const { error: insertErr } = await admin.from("contacts").insert({
          company_id: companyId,
          enrichment_source: "linkedin-monitor",
          linkedin: item.linkedin_url,
        });
        if (!insertErr) updated++;
      }
    }
  }

  return NextResponse.json({ updated });
}
