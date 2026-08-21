"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/timelines/leads";
import { Lane, FIRST_RESPONSE_TARGET_H, type ViewKey } from "./Lane";
import { useSort, SortHeader } from "@/components/ui/sortable";
import { PROSPECTING_KEY } from "@/lib/timelines/classify";
import { ALL_REPS, DISPLAY_DAYS, type RepSummary } from "@/lib/timelines/assemble";


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
  view, leads, reps, clients, summaries = {}, held, generated, coldAfterDays = 14, total,
  showRepFilter = true, scope = "all", canManageOrg = false,
}: {
  view: ViewKey; leads: Lead[]; reps: { id: string; name: string }[]; clients: string[];
  summaries?: Record<string, RepSummary>; held?: number;
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

  /*
   * BDMs and SDRs sell Factur's own services: their progress lives in
   * Prospecting Lead Status, not Stage, and every one of their opportunities is
   * for the same client -- "Factur Outsourced Prospecting" -- so a Client
   * column would repeat one value down the page.
   *
   * Which pipeline is on screen follows the rep filter, not the other
   * controls: it should track *who* is being looked at, and taking the client
   * filter into account here would be circular, since that filter is one of the
   * things this decides to show. A mixed set falls back to Stage, the only
   * field both halves share.
   */
  const inScope = useMemo(
    () => (rep ? leads.filter((l) => l.ownerId === rep) : leads),
    [leads, rep]
  );
  const prospecting = inScope.length > 0 && inScope.every((l) => l.pipeline === "prospecting");
  const stageLabel = prospecting ? "Prospecting Lead Status" : "Stage";
  const stageKey = prospecting ? PROSPECTING_KEY : STAGE_KEY;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = leads.filter(
      (l) =>
        (!rep || l.ownerId === rep) &&
        // The client picker is hidden in the prospecting pipeline, so a value
        // left over from before must stop filtering with it.
        (prospecting || !client || l.client === client) &&
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
  }, [leads, rep, client, outcome, search, sort, prospecting]);

  // Column sorting sits on top of the Sort control: with no column chosen the
  // rows keep whatever order that control asked for. Only the table view has
  // headers to click, so the lane views are unaffected until one is used.
  const { sorted: tableRows, sortProps } = useSort(rows, {
    lead: (l) => l.contact,
    client: (l) => l.client,
    rep: (l) => l.rep,
    stage: (l) => l.outcomeLabel,
    first: (l) => l.metrics.firstTouchHours,
    reply: (l) => l.metrics.respondHours,
    touches: (l) => l.metrics.touches,
    // The cell shows calls and emails separately; the column sorts on how much
    // outreach there was in total.
    activity: (l) => l.metrics.calls + l.metrics.emails,
    gap: (l) => l.metrics.medianGapDays,
    silent: (l) => l.metrics.daysSinceLastEvent,
  });

  /*
   * The tiles are the rep's record over everything held, not a description of
   * the rows below them. Those are two different questions -- "how did this
   * week's leads arrive" and "how does this rep work leads" -- and the second
   * one should not move when you search the first.
   *
   * Summarised on the server, per rep, because a median cannot be recombined
   * after the fact: picking a rep swaps to their set rather than recomputing.
   */
  const summary = summaries[rep || ALL_REPS];

  const tiles: [string, string | number, string][] = useMemo(() => {
    if (!summary) return [];
    const s = summary;
    const n = s.leads;

    if (view === "quick") {
      return [
        ["Leads", n, `${s.touches} rep touches`],
        [`Hit ${FIRST_RESPONSE_TARGET_H}h target`, pct(s.hitTarget, n), `${s.hitTarget} of ${n} leads`],
        ["Touched same day", pct(s.sameDay, n), "first touch inside 24h"],
        ["Never touched", s.neverTouched, "no rep outreach at all"],
        ["Median time to first touch", dur(s.medianFirstTouch), "lead created → first outreach"],
        ["Median reply to prospect", dur(s.medianRespond), "prospect replies → rep responds"],
      ];
    }
    if (view === "week") {
      return [
        ["Leads", n, `${s.touches} rep touches`],
        ["Touched every day", pct(s.touchedEveryDay, n), "no missed day in week one"],
        ["Untouched all week", pct(s.untouchedAllWeek, n), "zero rep touches in week one"],
        ["Median days touched", s.medianDaysTouched ?? "—", "of the first seven"],
        ["Median gap between touches", s.medianGap !== null ? `${s.medianGap}d` : "—", "across the whole lead"],
        ["Median time to first touch", dur(s.medianFirstTouch), "lead created → first outreach"],
      ];
    }
    return [
      ["Leads", n, `${s.touches} rep touches`],
      ["Median time to first touch", dur(s.medianFirstTouch), "lead created → first outreach"],
      ["Median reply to prospect", dur(s.medianRespond), "prospect replies → rep responds"],
      ["Median touches", s.medianTouches ?? "—", "per lead"],
      ["Meetings booked", s.meetings, s.meetings === 1 ? "lead with a confirmed invite" : "leads with a confirmed invite"],
      ["Gone quiet", s.goneQuiet, `open, no touch in ${coldAfterDays}+ days`],
    ];
  }, [summary, view, coldAfterDays]);

  const v = VIEWS[view];

  return (
    <div className="tl">
      <div className="wrap">
        <header>
          <h1>Lead Response</h1>
          <p>
            {VIEWS[view].blurb}. One row per lead; left to right is time since the
            lead arrived, so follow-up speed reads straight down the page.
          </p>
          <p>
            Below: leads that arrived in the last {DISPLAY_DAYS} days, newest first.
            The figures above cover {rep ? "this rep" : "everyone"} across all
            {held ? ` ${held} ` : " "}leads held, so filtering the board does not move them.
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
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </>
          )}
          {!prospecting && (
            <>
              <label htmlFor="f-client">Client</label>
              <select id="f-client" value={client} onChange={(e) => setClient(e.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c}>{c}</option>)}
              </select>
            </>
          )}
          <label htmlFor="f-outcome">{stageLabel}</label>
          <select id="f-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">{prospecting ? "All statuses" : "All stages"}</option>
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
            {stageKey.map(([label, bucket]) => (
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
              <div className="head">{v.goal ? "" : stageLabel}</div>
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
                    <div className="name">
                      <a href={lead.url} target="_blank" rel="noopener noreferrer">
                        {lead.contact || lead.name}
                      </a>
                      {lead.account && <span className="co"> — {lead.account}</span>}
                    </div>
                    <div className="sub">
                      {lead.rep}
                      {/* Every lead in the prospecting pipeline is for the same
                          client, so naming it on each row says nothing. */}
                      {!prospecting && lead.client && <> — {lead.client}</>}
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
                  <SortHeader {...sortProps("lead")}>Lead</SortHeader>
                  {!prospecting && <SortHeader {...sortProps("client")}>Client</SortHeader>}
                  <SortHeader {...sortProps("rep")}>Rep</SortHeader>
                  <SortHeader {...sortProps("stage")}>{stageLabel}</SortHeader>
                  <SortHeader align="right" {...sortProps("first")}>1st touch</SortHeader>
                  <SortHeader align="right" {...sortProps("reply")}>Reply</SortHeader>
                  <SortHeader align="right" {...sortProps("touches")}>Touches</SortHeader>
                  <SortHeader align="right" {...sortProps("activity")}>Calls / emails</SortHeader>
                  <SortHeader align="right" {...sortProps("gap")}>Median gap</SortHeader>
                  <SortHeader align="right" {...sortProps("silent")}>Silent</SortHeader>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((l) => (
                  <tr key={l.id}>
                    <td><a href={l.url} target="_blank" rel="noopener noreferrer">{l.contact}</a></td>
                    {!prospecting && <td>{l.client || "—"}</td>}
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
