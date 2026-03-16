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

  // Check which IDs exist in imported_companies
  const ids = body.items.map((i) => i.id);
  const { data: importedRows } = await admin
    .from("imported_companies")
    .select("id")
    .in("id", ids);
  const importedIds = new Set((importedRows ?? []).map((r) => r.id as string));

  for (const item of body.items) {
    if (!item.linkedin_url) continue;

    if (importedIds.has(item.id)) {
      // Imported company — update directly
      const { error } = await admin
        .from("imported_companies")
        .update({ cfo_linkedin: item.linkedin_url })
        .eq("id", item.id);
      if (!error) updated++;
    } else {
      // Curated company — update contacts table
      const { data: rows, error: updateErr } = await admin
        .from("contacts")
        .update({ linkedin: item.linkedin_url })
        .eq("company_id", item.id)
        .select("id");

      if (!updateErr && rows && rows.length > 0) {
        updated++;
      } else if (!updateErr) {
        // No contacts row — insert minimal one
        const { error: insertErr } = await admin.from("contacts").insert({
          company_id: item.id,
          linkedin: item.linkedin_url,
        });
        if (!insertErr) updated++;
      }
    }
  }

  return NextResponse.json({ updated });
}
