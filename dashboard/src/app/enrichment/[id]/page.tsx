import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import EnrichmentMonitor from "@/components/enrichment/EnrichmentMonitor";
import type { EnrichmentSession, EnrichmentSessionCompany } from "@/types";

type Params = { params: { id: string } };

function toSessionShape(row: Record<string, unknown>): EnrichmentSession {
  return {
    id: row.id as string,
    teamId: row.team_id as string,
    name: row.name as string,
    status: row.status as EnrichmentSession["status"],
    modelConfig: row.model_config as EnrichmentSession["modelConfig"],
    tokensInput: Number(row.tokens_input ?? 0),
    tokensOutput: Number(row.tokens_output ?? 0),
    tokensTotal: Number(row.tokens_total ?? 0),
    totalCompanies: Number(row.total_companies ?? 0),
    completedCount: Number(row.completed_count ?? 0),
    foundCount: Number(row.found_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    lastHeartbeat: row.last_heartbeat as string | null,
    createdBy: row.created_by as string,
    enrichmentCategory: (row.enrichment_category as string ?? "cfo") as EnrichmentSession["enrichmentCategory"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toCompanyShape(row: Record<string, unknown>): EnrichmentSessionCompany {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    companyId: row.company_id as string,
    companyOrigin: row.company_origin as "curated" | "imported",
    companyName: row.company_name as string,
    companyWebsite: row.company_website as string | null,
    companyCountry: row.company_country as string | null,
    status: row.status as EnrichmentSessionCompany["status"],
    resultNome: row.result_nome as string | null,
    resultRuolo: row.result_ruolo as string | null,
    resultLinkedin: row.result_linkedin as string | null,
    resultConfidenza: row.result_confidenza as "high" | "medium" | "low" | null,
    logs: (row.logs ?? []) as EnrichmentSessionCompany["logs"],
    tokensInput: Number(row.tokens_input ?? 0),
    tokensOutput: Number(row.tokens_output ?? 0),
    modelUsed: row.model_used as string | null,
    errorMessage: row.error_message as string | null,
    appliedAt: row.applied_at as string | null,
    appliedBy: row.applied_by as string | null,
    contactNome: row.contact_nome as string | null,
    contactRuolo: row.contact_ruolo as string | null,
    position: Number(row.position ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export default async function EnrichmentDetailPage({ params }: Params) {
  const supabase = createServerSupabaseClient();

  const [sessionResult, companiesResult] = await Promise.all([
    supabase
      .from("enrichment_sessions")
      .select("*")
      .eq("id", params.id)
      .single(),
    supabase
      .from("enrichment_session_companies")
      .select("*")
      .eq("session_id", params.id)
      .order("position", { ascending: true }),
  ]);

  if (sessionResult.error || !sessionResult.data) {
    notFound();
  }

  const session = toSessionShape(sessionResult.data as unknown as Record<string, unknown>);
  const companies = (companiesResult.data ?? []).map((r) =>
    toCompanyShape(r as unknown as Record<string, unknown>)
  );

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8">
      <EnrichmentMonitor initialSession={session} initialCompanies={companies} />
    </div>
  );
}
