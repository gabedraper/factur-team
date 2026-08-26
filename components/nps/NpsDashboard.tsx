"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CampaignSummary, ResponseDetail } from "@/lib/nps/reporting";

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

export function NpsDashboard({
  campaigns,
  responses,
  overall,
}: {
  campaigns: CampaignSummary[];
  responses: ResponseDetail[];
  overall: number | null;
}) {
  const [campaign, setCampaign] = useState<string>("all");
  const [band, setBand] = useState<string>("all");
  const [followUpsOnly, setFollowUpsOnly] = useState(false);

  const shown = useMemo(
    () =>
      responses.filter(
        (r) =>
          (campaign === "all" || r.campaignName === campaign) &&
          (band === "all" || r.band === band) &&
          (!followUpsOnly || r.followUpRequested === true)
      ),
    [responses, campaign, band, followUpsOnly]
  );

  const promoters = responses.filter((r) => r.band === "promoter").length;
  const detractors = responses.filter((r) => r.band === "detractor").length;
  const followUps = responses.filter((r) => r.followUpRequested === true).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="NPS" value={overall === null ? "—" : String(overall)} />
        <Stat label="Responses" value={String(responses.length)} />
        <Stat label="Promoters" value={String(promoters)} />
        <Stat label="Detractors" value={String(detractors)} />
        <Stat label="Follow-ups" value={String(followUps)} />
      </div>

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
