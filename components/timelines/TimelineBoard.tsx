"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/timelines/leads";
import { Lane, FIRST_RESPONSE_TARGET_H, type ViewKey } from "./Lane";


export type { ViewKey };

const VIEWS: Record<ViewKey, {
  label: string; blurb: string; goal: string | null;
  windowDays: number | null; ticks: number[] | null;
}> = {
  quick: {
    label: "Quick response", blurb: `First 24 hours · goal: reply inside ${FIRST_RESPONSE_TARGET_H}h`,
    goal: `first touch inside ${FIRST_RESPONSE_TARGET_H}h`,
    windowDays: 1, ticks: [0, 4, 8, 12, 16, 20, 24].map((h) => h / 24),
  },
  week: {
    label: "Lead follow up", blurb: "First week · goal: a touch every day",
    goal: "a touch every day of week one",
    windowDays: 7, ticks: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  life: {
    label: "Full lead life", blurb: "Everything, through to the outcome",
    goal: null, windowDays: null, ticks: null,
  },
};

const STAGE_KEY: [string, string][] = [
  ["Cold", "cold"], ["Lead generated", "generated"], ["Warm", "warm"],
  ["Hot", "hot"], ["LT follow up", "ltfu"], ["DQ", "dead"],
];

function dur(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const d = hours / 24;
  return d < 100 ? `${d.toFixed(d < 10 ? 1 : 0)}d` : `${Math.round(d)}d`;
}

function tickLabel(days: number): string {
  return days < 1 ? `${Math.round(days * 24)}h` : `${days}d`;
}

function spanLabel(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 60) return `${days.toFixed(days < 10 ? 1 : 0)}d`;
  return `${Math.round(days / 30.4)}mo`;
}

function median(xs: (number | null)[]): number | null {
  const s = xs.filter((v): v is number => v !== null && v !== undefined).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

function verdictFor(view: ViewKey, l: Lead) {
  if (view === "quick") {
    const h = l.metrics.firstTouchHours;
    if (h === null) return { text: "never touched", status: "critical" };
    if (h <= FIRST_RESPONSE_TARGET_H) return { text: `1st in ${dur(h)}`, status: "good" };
    if (h <= 24) return { text: `1st in ${dur(h)}`, status: "warning" };
    return { text: `1st in ${dur(h)}`, status: "critical" };
  }
  if (view === "week") {
    const { firstWeekDaysTouched: hit, firstWeekDaysElapsed: of } = l.metrics;
    const text = `${hit} of ${of} day${of === 1 ? "" : "s"} touched`;
    if (hit >= of) return { text, status: "good" };
    if (hit === 0) return { text, status: "critical" };
    return { text, status: "warning" };
  }
  return null;
}

export function TimelineBoard({
  view, leads, reps, clients, generated, coldAfterDays = 14, total,
  showRepFilter = true, scope = "all", canManageOrg = false,
}: {
  view: ViewKey; leads: Lead[]; reps: string[]; clients: string[];
  generated: string; coldAfterDays?: number; total?: number;
  showRepFilter?: boolean;
  scope?: "all" | "scoped" | "unlinked";
  canManageOrg?: boolean;
}) {
  const [rep, setRep] = useState("");
  const [client, setClient] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [mode, setMode] = useState<"timeline" | "table">("timeline");

  const outcomes = useMemo(
    () => [...new Set(leads.map((l) => l.outcomeLabel))]
      .sort((a, b) => a.localeCompare(b)),
    [leads]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter(
      (l) =>
        (!rep || l.rep === rep) && (!client || l.client === client) &&
        (!outcome || l.outcomeLabel === outcome) &&
        (!term || l.contact.toLowerCase().includes(term) || (l.account ?? "").toLowerCase().includes(term))
    );
    const by: Record<string, (a: Lead, b: Lead) => number> = {
      recent: (a, b) => (a.created < b.created ? 1 : -1),
      slowest_reply: (a, b) => (b.metrics.respondHours ?? -1) - (a.metrics.respondHours ?? -1),
      slowest_first: (a, b) => (b.metrics.firstTouchHours ?? 1e9) - (a.metrics.firstTouchHours ?? 1e9),
      longest_silence: (a, b) => b.metrics.daysSinceLastEvent - a.metrics.daysSinceLastEvent,
      fewest_touches: (a, b) => a.metrics.touches - b.metrics.touches,
    };
    return [...out].sort(by[sort] ?? by.recent);
  }, [leads, rep, client, outcome, search, sort]);

  // The headline tiles follow the active view, so the numbers on screen always
  // answer the question the view is asking.
  const tiles: [string, string | number, string][] = useMemo(() => {
    const n = rows.length;
    const touches = rows.reduce((a, l) => a + l.metrics.touches, 0);
    const hit = rows.filter((l) => l.metrics.firstTouchHours !== null && l.metrics.firstTouchHours <= FIRST_RESPONSE_TARGET_H).length;
    if (view === "quick") {
      return [
        ["Leads", n, `${touches} rep touches`],
        [`Hit ${FIRST_RESPONSE_TARGET_H}h target`, pct(hit, n), `${hit} of ${n} leads`],
        ["Touched same day", pct(rows.filter((l) => l.metrics.firstDayTouches > 0).length, n), "first touch inside 24h"],
        ["Never touched", rows.filter((l) => l.metrics.firstTouchHours === null).length, "no rep outreach at all"],
        ["Median time to first touch", dur(median(rows.map((l) => l.metrics.firstTouchHours))), "lead created → first outreach"],
        ["Median reply to prospect", dur(median(rows.map((l) => l.metrics.respondHours))), "prospect replies → rep responds"],
      ];
    }
    if (view === "week") {
      const gap = median(rows.map((l) => l.metrics.medianGapDays));
      return [
        ["Leads", n, `${touches} rep touches`],
        ["Touched every day", pct(rows.filter((l) => l.metrics.firstWeekDaysTouched >= l.metrics.firstWeekDaysElapsed).length, n), "no missed day in week one"],
        ["Untouched all week", pct(rows.filter((l) => l.metrics.firstWeekDaysTouched === 0).length, n), "zero rep touches in week one"],
        ["Median days touched", median(rows.map((l) => l.metrics.firstWeekDaysTouched)) ?? "—", "of the first seven"],
        ["Median gap between touches", gap !== null ? `${gap}d` : "—", "across the whole lead"],
        ["Median time to first touch", dur(median(rows.map((l) => l.metrics.firstTouchHours))), "lead created → first outreach"],
      ];
    }
    const meetings = rows.filter((l) => l.metrics.meetings > 0).length;
    return [
      ["Leads", n, `${touches} rep touches`],
      ["Median time to first touch", dur(median(rows.map((l) => l.metrics.firstTouchHours))), "lead created → first outreach"],
      ["Median reply to prospect", dur(median(rows.map((l) => l.metrics.respondHours))), "prospect replies → rep responds"],
      ["Median touches", median(rows.map((l) => l.metrics.touches)) ?? "—", "per lead"],
      ["Meetings booked", meetings, meetings === 1 ? "lead with a confirmed invite" : "leads with a confirmed invite"],
      ["Gone quiet", rows.filter((l) => l.outcome === "cold").length, `open, no touch in ${coldAfterDays}+ days`],
    ];
  }, [rows, view, coldAfterDays]);

  const v = VIEWS[view];

  return (
    <div className="tl">
      <div className="wrap">
        <header>
          <h1>Opportunity Timelines</h1>
          <p>
            {VIEWS[view].blurb}. One row per lead; left to right is time since the
            lead arrived, so follow-up speed reads straight down the page.
          </p>
        </header>

        <div className="tiles">
          {tiles.map(([label, value, sub]) => (
            <div className="tile" key={label}>
              <div className="label">{label}</div>
              <div className="value">{value}</div>
              <div className="sub">{sub}</div>
            </div>
          ))}
        </div>

        <div className="controls">
          {showRepFilter && (
            <>
              <label htmlFor="f-rep">Rep</label>
              <select id="f-rep" value={rep} onChange={(e) => setRep(e.target.value)}>
                <option value="">All reps</option>
                {reps.map((r) => <option key={r}>{r}</option>)}
              </select>
            </>
          )}
          <label htmlFor="f-client">Client</label>
          <select id="f-client" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label htmlFor="f-outcome">Stage</label>
          <select id="f-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All stages</option>
            {outcomes.map((o) => <option key={o}>{o}</option>)}
          </select>
          <input type="search" placeholder="Search contact or company…" value={search}
                 onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <span className="spacer" />
          <div className="sortgroup">
            <label htmlFor="f-sort">Sort</label>
            <select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Lead arrival (newest)</option>
              <option value="slowest_reply">Slowest reply to prospect</option>
              <option value="slowest_first">Slowest first touch</option>
              <option value="longest_silence">Longest silence</option>
              <option value="fewest_touches">Fewest touches</option>
            </select>
            <div className="toggle" role="group" aria-label="View">
              <button aria-pressed={mode === "timeline"} onClick={() => setMode("timeline")}>Timeline</button>
              <button aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>
            </div>
          </div>
        </div>

        <div className="legend">
          <span className="item">
            <b style={{ color: "var(--rep)" }}>Orange = Factur</b> ·{" "}
            <b style={{ color: "var(--prospect)" }}>Red = Prospect</b>
          </span>
          <span className="stagekey">
            line:
            {STAGE_KEY.map(([label, bucket]) => (
              <span className="sw" key={bucket}>
                <i style={{ background: `var(--st-${bucket})` }} />{label}
              </span>
            ))}
          </span>
        </div>

        {mode === "timeline" ? (
          <div className="board">
            <div className="axis">
              <div className="head">Lead</div>
              <div className="ticks">
                {v.windowDays === null ? (
                  <>
                    <span style={{ left: 0, transform: "none" }}>lead in</span>
                    <span style={{ right: 0, left: "auto", transform: "none" }}>today / closed →</span>
                  </>
                ) : (
                  v.ticks!.map((d) =>
                    d === 0 ? (
                      <span key={d} style={{ left: 0, transform: "none" }}>lead in</span>
                    ) : (
                      <span key={d} style={{ left: `${(d / v.windowDays!) * 100}%` }}>{tickLabel(d)}</span>
                    )
                  )
                )}
              </div>
              <div className="head">{v.goal ? "Against goal" : "Outcome"}</div>
            </div>

            {rows.length === 0 && (
              <div className="empty">
                {scope === "unlinked" ? (
                  <>
                    <p><b>Your account isn&apos;t linked to Salesforce yet.</b></p>
                    <p className="mt-1">
                      Leads are attributed through Salesforce, so until yours is linked there is
                      nothing here to show — this isn&apos;t a fault.{" "}
                      {canManageOrg
                        ? "Link it under Settings → Salesforce accounts."
                        : "Ask an administrator to link it under Settings → Salesforce accounts."}
                    </p>
                  </>
                ) : leads.length === 0 ? (
                  <>
                    <p><b>No leads are assigned to you.</b></p>
                    <p className="mt-1">
                      Opportunities created in the last 30 days and owned by you appear here.
                    </p>
                  </>
                ) : (
                  "No leads match these filters."
                )}
              </div>
            )}

            {rows.map((lead) => {
              const verdict = verdictFor(view, lead);
              const m = lead.metrics;
              return (
                <div className="row" key={lead.id}>
                  <div className="who">
                    <a href={lead.url} target="_blank" rel="noopener noreferrer">{lead.contact || lead.name}</a>
                    <div className="sub">
                      {lead.account}{lead.title && <> · <em>{lead.title}</em></>}
                    </div>
                    <div className="sub">
                      <em>for</em> {lead.client || "—"} · <em>by</em> {lead.rep}
                    </div>
                    <div className="sub">
                      <em>arrived</em>{" "}
                      {new Date(lead.created).toLocaleDateString(undefined, {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="lane"><Lane lead={lead} view={view} /></div>
                  <div className="meta">
                    {verdict ? (
                      <>
                        <span className={`chip ${verdict.status}`}>{verdict.text}</span>
                        <div className="nums">{lead.outcomeLabel} · <b>{m.touches}</b> touch{m.touches === 1 ? "" : "es"}</div>
                      </>
                    ) : (
                      <>
                        <span className={`chip ${lead.status}`}>{lead.outcomeLabel}</span>
                        <div className="nums">
                          <b>{m.touches}</b> touch{m.touches === 1 ? "" : "es"} · 1st in <b>{dur(m.firstTouchHours)}</b>
                          {m.respondHours !== null && <> · reply in <b>{dur(m.respondHours)}</b></>}
                          {" · "}<b>{spanLabel(m.spanHours / 24)}</b> span
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="board">
            <table>
              <thead>
                <tr>
                  <th>Lead</th><th>Client</th><th>Rep</th><th>Outcome</th>
                  <th>1st touch</th><th>Reply</th><th>Touches</th>
                  <th>Calls / emails</th><th>Median gap</th><th>Silent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td><a href={l.url} target="_blank" rel="noopener noreferrer">{l.contact}</a></td>
                    <td>{l.client || "—"}</td>
                    <td>{l.rep}</td>
                    <td>{l.outcomeLabel}</td>
                    <td className="num">{dur(l.metrics.firstTouchHours)}</td>
                    <td className="num">{dur(l.metrics.respondHours)}</td>
                    <td className="num">{l.metrics.touches}</td>
                    <td className="num">{l.metrics.calls} / {l.metrics.emails}</td>
                    <td className="num">{l.metrics.medianGapDays !== null ? `${l.metrics.medianGapDays}d` : "—"}</td>
                    <td className="num">{l.metrics.daysSinceLastEvent}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="foot">
          {rows.length} of {total ?? leads.length} leads · {v.label}
          {v.goal && <> — goal: {v.goal}</>} · data through {new Date(generated).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
