import { createClient } from "@/lib/supabase/server";

export type CampaignSummary = {
  id: string;
  name: string;
  period: string;
  status: string;
  source: string;
  sent: number;
  responded: number;
  promoters: number;
  passives: number;
  detractors: number;
  followUps: number;
  averageScore: number | null;
  nps: number | null;
};

export type ResponseDetail = {
  id: string;
  clientId: string;
  clientName: string;
  score: number;
  comment: string | null;
  followUpRequested: boolean | null;
  collectedOn: string;
  respondent: string | null;
  respondentEmail: string | null;
  senderEmail: string | null;
  campaignName: string | null;
  band: "promoter" | "passive" | "detractor";
};

type CampaignRow = {
  id: string; name: string; period: string; status: string; source: string;
  sent: number; responded: number; promoters: number; passives: number;
  detractors: number; follow_ups: number; average_score: string | null;
  nps: string | null;
};

type ResponseRow = {
  id: string; client_id: string; client_name: string; score: number;
  comment: string | null; follow_up_requested: boolean | null;
  collected_on: string; respondent: string | null;
  respondent_email: string | null; sender_email: string | null;
  campaign_name: string | null; band: ResponseDetail["band"];
};

// The signed-in person's own connection, not the service key: both views are
// security_invoker, so they answer as whoever asked. See getClientHealth for
// the same reasoning.
export async function getNpsCampaigns(): Promise<CampaignSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nps_campaign_summary")
    .select("*")
    .order("period", { ascending: false });
  if (error) throw new Error(`NPS campaigns query failed: ${error.message}`);

  return ((data ?? []) as CampaignRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    period: r.period,
    status: r.status,
    source: r.source,
    sent: r.sent,
    responded: r.responded,
    promoters: r.promoters,
    passives: r.passives,
    detractors: r.detractors,
    followUps: r.follow_ups,
    // Postgres numerics arrive as strings; a bare Number() would turn null
    // -- "nobody has answered" -- into 0, which reads as a real middling score.
    averageScore: r.average_score === null ? null : Number(r.average_score),
    nps: r.nps === null ? null : Number(r.nps),
  }));
}

export async function getNpsResponses(): Promise<ResponseDetail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nps_response_detail")
    .select("*")
    .order("collected_on", { ascending: false });
  if (error) throw new Error(`NPS responses query failed: ${error.message}`);

  return ((data ?? []) as ResponseRow[]).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    score: r.score,
    comment: r.comment,
    followUpRequested: r.follow_up_requested,
    collectedOn: r.collected_on,
    respondent: r.respondent,
    respondentEmail: r.respondent_email,
    senderEmail: r.sender_email,
    campaignName: r.campaign_name,
    band: r.band,
  }));
}

/** Promoters minus detractors, as a percentage of everyone who answered. */
export function npsOf(responses: ResponseDetail[]): number | null {
  if (responses.length === 0) return null;
  const promoters = responses.filter((r) => r.band === "promoter").length;
  const detractors = responses.filter((r) => r.band === "detractor").length;
  return Math.round((100 * (promoters - detractors)) / responses.length);
}
