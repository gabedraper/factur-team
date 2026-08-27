"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CampaignSummary, LeadSummary, PersonSummary, ResponseDetail } from "@/lib/nps/reporting";

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
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
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
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Team lead</th>
                <th className="px-3 py-2 text-right font-medium">Sent</th>
                <th className="px-3 py-2 text-right font-medium">Responded</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Promoters</th>
                <th className="px-3 py-2 text-right font-medium">Passives</th>
                <th className="px-3 py-2 text-right font-medium">Detractors</th>
                <th className="px-3 py-2 text-right font-medium">NPS</th>
                <th className="px-3 py-2 text-right font-medium">Follow-ups</th>
              </tr>
            </thead>
            <tbody>
              {byLead.map((l) => {
                const score = npsFrom(l.promoters, l.detractors, l.responded);
                return (
                  <tr key={l.teamLead} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setLead(lead === l.teamLead ? "all" : l.teamLead)}
                        className={`hover:underline ${lead === l.teamLead ? "font-semibold" : ""}`}
                      >
                        {l.teamLead}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.sent}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.responded}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.sent === 0 ? "—" : `${Math.round((100 * l.responded) / l.sent)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {l.promoters || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {l.passives || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                      {l.detractors || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {score === null ? "—" : score}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.followUps || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{PERSON_ROLE_LABEL[personRole]}</th>
                  <th className="px-3 py-2 text-right font-medium">Sent</th>
                  <th className="px-3 py-2 text-right font-medium">Responded</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Promoters</th>
                  <th className="px-3 py-2 text-right font-medium">Detractors</th>
                  <th className="px-3 py-2 text-right font-medium">NPS</th>
                </tr>
              </thead>
              <tbody>
                {byPerson.map((p) => {
                  const score = npsFrom(p.promoters, p.detractors, p.responded);
                  return (
                    <tr key={p.memberName} className="border-b last:border-0">
                      <td className="px-3 py-2">{p.memberName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.sent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.responded}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.sent === 0 ? "—" : `${Math.round((100 * p.responded) / p.sent)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {p.promoters || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                        {p.detractors || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {score === null ? "—" : score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Sent</th>
                <th className="px-3 py-2 text-right font-medium">Responded</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">NPS</th>
                <th className="px-3 py-2 text-right font-medium">Follow-ups</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.period}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.sent}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.responded}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.sent === 0 ? "—" : `${Math.round((100 * c.responded) / c.sent)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {c.nps === null ? "—" : c.nps}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.followUps || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <div key={r.id} className="rounded-md border bg-card px-4 py-3">
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
          </div>
        ))}
        {shown.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing matches those filters.</p>
        )}
      </div>
    </div>
  );
}
