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
  teamLead: string | null;
  teamLeadEmail: string | null;
  campaignName: string | null;
  band: "promoter" | "passive" | "detractor";
};

export type LeadSummary = {
  campaignId: string;
  campaignName: string;
  teamLead: string;
  teamLeadEmail: string | null;
  sent: number;
  responded: number;
  promoters: number;
  passives: number;
  detractors: number;
  followUps: number;
};

type LeadRow = {
  campaign_id: string; campaign_name: string;
  team_lead: string | null; team_lead_email: string | null;
  sent: number; responded: number; promoters: number; passives: number;
  detractors: number; follow_ups: number;
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
  team_lead: string | null; team_lead_email: string | null;
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
    teamLead: r.team_lead,
    teamLeadEmail: r.team_lead_email,
    campaignName: r.campaign_name,
    band: r.band,
  }));
}

/**
 * Every campaign split by team lead.
 *
 * Rows are per campaign *and* per lead so the page can honour its campaign
 * filter and still add up correctly across all of them. Counts rather than a
 * ready-made NPS, because an NPS is a ratio and ratios do not add -- it has to
 * be recomputed at whatever level it is shown.
 */
export async function getNpsLeads(): Promise<LeadSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nps_lead_summary")
    .select("*")
    .order("sent", { ascending: false });
  if (error) throw new Error(`NPS lead summary failed: ${error.message}`);

  return ((data ?? []) as LeadRow[])
    // A send whose client has no lead cannot be attributed to anyone, and a
    // row labelled "null" in a per-person table is worse than no row.
    .filter((r) => r.team_lead)
    .map((r) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      teamLead: r.team_lead as string,
      teamLeadEmail: r.team_lead_email,
      sent: r.sent,
      responded: r.responded,
      promoters: r.promoters,
      passives: r.passives,
      detractors: r.detractors,
      followUps: r.follow_ups,
    }));
}

export type PersonSummary = {
  field: string;
  memberName: string;
  campaignName: string;
  sent: number;
  responded: number;
  promoters: number;
  passives: number;
  detractors: number;
  followUps: number;
};

/**
 * NPS attributed to whoever was on the account when the survey went out.
 *
 * Reads nps_send_team, which is frozen at campaign build, so this does not move
 * when a client changes hands. That is the difference from getNpsLeads, which
 * resolves the lead live -- one answers "who did this work", the other "whose
 * problem is it now", and the two legitimately disagree.
 */
export async function getNpsByPerson(): Promise<PersonSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nps_by_person")
    .select("field,member_name,campaign_name,sent,responded,promoters,passives,detractors,follow_ups")
    .order("sent", { ascending: false });
  if (error) throw new Error(`NPS by person failed: ${error.message}`);

  return ((data ?? []) as {
    field: string; member_name: string | null; campaign_name: string;
    sent: number; responded: number; promoters: number; passives: number;
    detractors: number; follow_ups: number;
  }[])
    .filter((r) => r.member_name)
    .map((r) => ({
      field: r.field,
      memberName: r.member_name as string,
      campaignName: r.campaign_name,
      sent: r.sent,
      responded: r.responded,
      promoters: r.promoters,
      passives: r.passives,
      detractors: r.detractors,
      followUps: r.follow_ups,
    }));
}

/** Promoters minus detractors, as a percentage of everyone who answered. */
export function npsOf(responses: ResponseDetail[]): number | null {
  if (responses.length === 0) return null;
  const promoters = responses.filter((r) => r.band === "promoter").length;
  const detractors = responses.filter((r) => r.band === "detractor").length;
  return Math.round((100 * (promoters - detractors)) / responses.length);
}
