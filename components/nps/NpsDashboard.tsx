"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CampaignSummary, LeadSummary, PersonSummary, ResponseDetail } from "@/lib/nps/reporting";
import { Surface } from "@/components/ui/surface";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

const BAND_LABEL: Record<ResponseDetail["band"], string> = {
  promoter: "Promoter",
  passive: "Passive",
  detractor: "Detractor",
};

const BAND_CLASS: Record<ResponseDetail["band"], string> = {
  promoter: "text-emerald-600 dark:text-emerald-400",
  passive: "text-muted-foreground",
  detractor: "text-red-600 dark:text-red-400",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Surface pad="tight">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </Surface>
  );
}

/** Promoters minus detractors over everyone who answered, or nothing yet. */
function npsFrom(promoters: number, detractors: number, responded: number) {
  return responded === 0 ? null : Math.round((100 * (promoters - detractors)) / responded);
}

const PERSON_ROLE_LABEL: Record<string, string> = {
  resolved_team_lead: "Team lead",
  account_manager: "Account manager",
  sdr: "SDR",
  marketing_strategist: "Marketing strategist",
  data_analyst: "Data analyst",
  data_engineer: "Data engineer",
};

export function NpsDashboard({
  campaigns,
  leads,
  people,
  responses,
  overall,
}: {
  campaigns: CampaignSummary[];
  leads: LeadSummary[];
  people: PersonSummary[];
  responses: ResponseDetail[];
  overall: number | null;
}) {
  const [campaign, setCampaign] = useState<string>("all");
  const [band, setBand] = useState<string>("all");
  const [lead, setLead] = useState<string>("all");
  const [followUpsOnly, setFollowUpsOnly] = useState(false);
  const [personRole, setPersonRole] = useState("account_manager");

  const shown = useMemo(
    () =>
      responses.filter(
        (r) =>
          (campaign === "all" || r.campaignName === campaign) &&
          (band === "all" || r.band === band) &&
          (lead === "all" || r.teamLead === lead) &&
          (!followUpsOnly || r.followUpRequested === true)
      ),
    [responses, campaign, band, lead, followUpsOnly]
  );

  // Whoever a response would land on today, not whoever sent it -- leads change.
  const leadNames = Array.from(
    new Set(responses.map((r) => r.teamLead).filter((n): n is string => !!n))
  ).sort();

  /*
   * Frozen attribution, so these totals do not move when a client changes
   * hands. Summed across campaigns for the one selected, NPS recomputed from
   * the counts rather than averaged.
   */
  const byPerson = useMemo(() => {
    const totals = new Map<string, PersonSummary>();
    for (const row of people) {
      if (row.field !== personRole) continue;
      if (campaign !== "all" && row.campaignName !== campaign) continue;
      const running = totals.get(row.memberName);
      totals.set(row.memberName, {
        ...row,
        sent: (running?.sent ?? 0) + row.sent,
        responded: (running?.responded ?? 0) + row.responded,
        promoters: (running?.promoters ?? 0) + row.promoters,
        passives: (running?.passives ?? 0) + row.passives,
        detractors: (running?.detractors ?? 0) + row.detractors,
        followUps: (running?.followUps ?? 0) + row.followUps,
      });
    }
    return [...totals.values()].sort((a, b) => b.sent - a.sent);
  }, [people, personRole, campaign]);

  const personRoles = Array.from(new Set(people.map((p) => p.field)))
    .filter((f) => f in PERSON_ROLE_LABEL)
    .sort((a, b) => (PERSON_ROLE_LABEL[a] ?? a).localeCompare(PERSON_ROLE_LABEL[b] ?? b));

  const promoters = responses.filter((r) => r.band === "promoter").length;
  const detractors = responses.filter((r) => r.band === "detractor").length;
  const followUps = responses.filter((r) => r.followUpRequested === true).length;

  /*
   * One row per lead for whatever campaign is selected, adding the campaigns up
   * when none is. Counts are summed and the NPS recomputed from them --
   * averaging each campaign's NPS would weight a campaign of three the same as
   * one of a hundred.
   */
  const byLead = useMemo(() => {
    const totals = new Map<string, LeadSummary>();
    for (const row of leads) {
      if (campaign !== "all" && row.campaignName !== campaign) continue;
      const running = totals.get(row.teamLead);
      totals.set(row.teamLead, {
        ...row,
        sent: (running?.sent ?? 0) + row.sent,
        responded: (running?.responded ?? 0) + row.responded,
        promoters: (running?.promoters ?? 0) + row.promoters,
        passives: (running?.passives ?? 0) + row.passives,
        detractors: (running?.detractors ?? 0) + row.detractors,
        followUps: (running?.followUps ?? 0) + row.followUps,
      });
    }
    return [...totals.values()].sort((a, b) => b.sent - a.sent);
  }, [leads, campaign]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="NPS" value={overall === null ? "—" : String(overall)} />
        <Stat label="Responses" value={String(responses.length)} />
        <Stat label="Promoters" value={String(promoters)} />
        <Stat label="Detractors" value={String(detractors)} />
        <Stat label="Follow-ups" value={String(followUps)} />
      </div>

      {byLead.length > 0 && (
        <Surface pad="none" className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Team lead</TH>
                <TH numeric>Sent</TH>
                <TH numeric>Responded</TH>
                <TH numeric>Rate</TH>
                <TH numeric>Promoters</TH>
                <TH numeric>Passives</TH>
                <TH numeric>Detractors</TH>
                <TH numeric>NPS</TH>
                <TH numeric>Follow-ups</TH>
              </TR>
            </THead>
            <TBody>
              {byLead.map((l) => {
                const score = npsFrom(l.promoters, l.detractors, l.responded);
                return (
                  <TR key={l.teamLead} >
                    <TD>
                      <button
                        onClick={() => setLead(lead === l.teamLead ? "all" : l.teamLead)}
                        className={`hover:underline ${lead === l.teamLead ? "font-semibold" : ""}`}
                      >
                        {l.teamLead}
                      </button>
                    </TD>
                    <TD numeric>{l.sent}</TD>
                    <TD numeric>{l.responded}</TD>
                    <TD numeric>
                      {l.sent === 0 ? "—" : `${Math.round((100 * l.responded) / l.sent)}%`}
                    </TD>
                    <TD numeric className="text-emerald-600 dark:text-emerald-400">
                      {l.promoters || "—"}
                    </TD>
                    <TD numeric className="text-muted-foreground">
                      {l.passives || "—"}
                    </TD>
                    <TD numeric className="text-red-600 dark:text-red-400">
                      {l.detractors || "—"}
                    </TD>
                    <TD numeric className="font-semibold">
                      {score === null ? "—" : score}
                    </TD>
                    <TD numeric>{l.followUps || "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Surface>
      )}

      {byPerson.length > 0 && (
        <div className="space-y-2">
          <select
            value={personRole}
            onChange={(e) => setPersonRole(e.target.value)}
            className="h-8 rounded-md border bg-field px-2 text-sm"
          >
            {personRoles.map((f) => (
              <option key={f} value={f}>{PERSON_ROLE_LABEL[f]}</option>
            ))}
          </select>
          <Surface pad="none" className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>{PERSON_ROLE_LABEL[personRole]}</TH>
                  <TH numeric>Sent</TH>
                  <TH numeric>Responded</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Promoters</TH>
                  <TH numeric>Detractors</TH>
                  <TH numeric>NPS</TH>
                </TR>
              </THead>
              <TBody>
                {byPerson.map((p) => {
                  const score = npsFrom(p.promoters, p.detractors, p.responded);
                  return (
                    <TR key={p.memberName} >
                      <TD>{p.memberName}</TD>
                      <TD numeric>{p.sent}</TD>
                      <TD numeric>{p.responded}</TD>
                      <TD numeric>
                        {p.sent === 0 ? "—" : `${Math.round((100 * p.responded) / p.sent)}%`}
                      </TD>
                      <TD numeric className="text-emerald-600 dark:text-emerald-400">
                        {p.promoters || "—"}
                      </TD>
                      <TD numeric className="text-red-600 dark:text-red-400">
                        {p.detractors || "—"}
                      </TD>
                      <TD numeric className="font-semibold">
                        {score === null ? "—" : score}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Surface>
        </div>
      )}

      {campaigns.length > 0 && (
        <Surface pad="none" className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Campaign</TH>
                <TH>Period</TH>
                <TH numeric>Sent</TH>
                <TH numeric>Responded</TH>
                <TH numeric>Rate</TH>
                <TH numeric>NPS</TH>
                <TH numeric>Follow-ups</TH>
              </TR>
            </THead>
            <TBody>
              {campaigns.map((c) => (
                <TR key={c.id} >
                  <TD>{c.name}</TD>
                  <TD className="tabular-nums text-muted-foreground">{c.period}</TD>
                  <TD numeric>{c.sent}</TD>
                  <TD numeric>{c.responded}</TD>
                  <TD numeric>
                    {c.sent === 0 ? "—" : `${Math.round((100 * c.responded) / c.sent)}%`}
                  </TD>
                  <TD numeric className="font-semibold">
                    {c.nps === null ? "—" : c.nps}
                  </TD>
                  <TD numeric>{c.followUps || "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Surface>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          value={band}
          onChange={(e) => setBand(e.target.value)}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
          <option value="all">All scores</option>
          <option value="promoter">Promoters</option>
          <option value="passive">Passives</option>
          <option value="detractor">Detractors</option>
        </select>
        <select
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          className="h-8 rounded-md border bg-field px-2 text-sm"
        >
          <option value="all">All team leads</option>
          {leadNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={followUpsOnly}
            onChange={(e) => setFollowUpsOnly(e.target.checked)}
          />
          Asked for follow-up ({followUps})
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {responses.length}
        </span>
      </div>

      <div className="space-y-2">
        {shown.map((r) => (
          <Surface key={r.id} pad="tight">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tabular-nums">{r.score}</span>
              <span className={`text-xs uppercase tracking-wide ${BAND_CLASS[r.band]}`}>
                {BAND_LABEL[r.band]}
              </span>
              <Link
                href={`/clients/${r.clientId}`}
                className="font-medium hover:underline"
              >
                {r.clientName}
              </Link>
              {r.respondent && (
                <span className="text-sm text-muted-foreground">{r.respondent}</span>
              )}
              {r.teamLead && (
                <span className="text-sm text-muted-foreground">· {r.teamLead}</span>
              )}
              {r.followUpRequested && (
                <span className="rounded-full border border-amber-400 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                  Wants follow-up
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {r.collectedOn}
              </span>
            </div>
            {r.comment && (
              <p className="mt-2 whitespace-pre-line text-sm">{r.comment}</p>
            )}
          </Surface>
        ))}
        {shown.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing matches those filters.</p>
        )}
      </div>
    </div>
  );
}
