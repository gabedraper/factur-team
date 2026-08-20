"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/lib/timelines/leads";
import { Mark, MARKS, LEGEND_ORDER } from "./marks";

const FIRST_RESPONSE_TARGET_H = 1;
const W = 900;      // lane viewBox width; scales to fit via CSS
const PAD = 10;
const ROW_H = 44;

type ViewKey = "quick" | "week" | "life";

const VIEWS: Record<ViewKey, { label: string; goal: string | null; windowDays: number | null; ticks: number[] | null }> = {
  quick: { label: "Quick response", goal: `first touch inside ${FIRST_RESPONSE_TARGET_H}h`, windowDays: 1, ticks: [0, 4, 8, 12, 16, 20, 24].map((h) => h / 24) },
  week: { label: "Lead follow up", goal: "a touch every day of week one", windowDays: 7, ticks: [0, 1, 2, 3, 4, 5, 6, 7] },
  life: { label: "Full lead life", goal: null, windowDays: null, ticks: null },
};

const STATUS_CLASS: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  critical: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  serious: "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-200",
  neutral: "bg-muted text-muted-foreground",
};

function dur(hours: number | null): string {
  if (hours === null || hours === undefined) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const d = hours / 24;
  return d < 100 ? `${d.toFixed(d < 10 ? 1 : 0)}d` : `${Math.round(d)}d`;
}

function verdictFor(view: ViewKey, l: Lead): { text: string; status: string } | null {
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

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function Lane({ lead, view }: { lead: Lead; view: ViewKey }) {
  const v = VIEWS[view];
  // Life view gives every row its own scale, so a lead that arrived yesterday
  // gets an hours-wide lane and an older one gets a weeks-wide lane.
  const maxDays = v.windowDays ?? Math.max(0.5, lead.metrics.spanHours / 24) * 1.04;
  const x = (days: number) => PAD + (days / maxDays) * (W - PAD * 2);
  const mid = ROW_H / 2;

  const inWindow = lead.events.filter((e) => e.hours / 24 <= maxDays);
  const overflow = lead.events.length - inWindow.length;

  // Week view shades any day that got no rep touch -- the gaps are the point.
  const missedDays: number[] = [];
  if (view === "week") {
    const touched = new Set(
      lead.events
        .filter((e) => ["email_out", "call", "sms", "meeting_invite"].includes(e.kind))
        .map((e) => Math.floor(e.hours / 24))
    );
    for (let d = 0; d < lead.metrics.firstWeekDaysElapsed; d++) {
      if (!touched.has(d)) missedDays.push(d);
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${ROW_H}`} className="w-full" style={{ height: ROW_H }} role="img"
         aria-label={`${lead.events.length} activities`}>
      {missedDays.map((d) => (
        <rect key={`miss-${d}`} x={x(d)} y={6} width={x(d + 1) - x(d) - 1} height={ROW_H - 12}
              fill="var(--tl-miss)" fillOpacity={0.45} rx={2} />
      ))}

      {lead.stageSpans.map((span, i) => {
        const from = span.fromHours / 24;
        const to = i + 1 < lead.stageSpans.length ? lead.stageSpans[i + 1].fromHours / 24 : maxDays;
        if (from >= maxDays) return null;
        return (
          <rect key={`span-${i}`} x={x(from)} y={mid - 3}
                width={Math.max(1, x(Math.min(to, maxDays)) - x(from))} height={6} rx={3}
                fill={`var(--tl-${span.bucket})`}>
            <title>{span.stage ?? "stage before this window"}</title>
          </rect>
        );
      })}

      {v.ticks?.map((d) => (
        <line key={`tick-${d}`} x1={x(d)} x2={x(d)} y1={ROW_H - 6} y2={ROW_H - 2}
              stroke="var(--tl-lane)" strokeWidth={1} />
      ))}

      {view === "quick" && (
        <line x1={x(FIRST_RESPONSE_TARGET_H / 24)} x2={x(FIRST_RESPONSE_TARGET_H / 24)}
              y1={4} y2={ROW_H - 4} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="3 3" />
      )}

      {inWindow.map((e) => (
        <g key={e.id}>
          <Mark kind={e.kind} x={x(e.hours / 24)} y={mid} />
          <title>{`${MARKS[e.kind]?.label ?? e.kind} · ${dur(e.hours)} in · ${e.detail}`}</title>
        </g>
      ))}

      {overflow > 0 && (
        <text x={W - 4} y={mid + 4} textAnchor="end" fontSize={11} fill="var(--tl-muted)">
          +{overflow} →
        </text>
      )}
    </svg>
  );
}

export function TimelineBoard({
  leads, reps, clients, generated,
}: {
  leads: Lead[]; reps: string[]; clients: string[]; generated: string;
}) {
  const [view, setView] = useState<ViewKey>("quick");
  const [rep, setRep] = useState("");
  const [client, setClient] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");

  const outcomes = useMemo(
    () => [...new Set(leads.map((l) => l.outcomeLabel))].sort(),
    [leads]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let out = leads.filter(
      (l) =>
        (!rep || l.rep === rep) &&
        (!client || l.client === client) &&
        (!outcome || l.outcomeLabel === outcome) &&
        (!term ||
          l.contact.toLowerCase().includes(term) ||
          (l.account ?? "").toLowerCase().includes(term))
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

  const tiles = useMemo(() => {
    const firsts = rows.map((l) => l.metrics.firstTouchHours).filter((h): h is number => h !== null);
    const replies = rows.map((l) => l.metrics.respondHours).filter((h): h is number => h !== null);
    const never = rows.filter((l) => l.metrics.firstTouchHours === null).length;
    const inTarget = firsts.filter((h) => h <= FIRST_RESPONSE_TARGET_H).length;
    return [
      { label: "Leads", value: String(rows.length) },
      { label: "Median first touch", value: dur(median(firsts)) },
      { label: `First touch ≤ ${FIRST_RESPONSE_TARGET_H}h`, value: firsts.length ? `${Math.round((inTarget / rows.length) * 100)}%` : "—" },
      { label: "Never touched", value: String(never) },
      { label: "Median reply to prospect", value: dur(median(replies)) },
      { label: "Median touches", value: String(median(rows.map((l) => l.metrics.touches)) ?? "—") },
    ];
  }, [rows]);

  const select = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Opportunity Timelines</h1>
        <p className="text-sm text-muted-foreground">
          One row per lead, left to right by time since it arrived.{" "}
          {VIEWS[view].goal && <>Goal: {VIEWS[view].goal}.</>} Data through{" "}
          {new Date(generated).toLocaleString()}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Rep">
          <option value="">All reps</option>
          {reps.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select className={select} value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={select} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
          <option value="">All outcomes</option>
          {outcomes.map((o) => <option key={o}>{o}</option>)}
        </select>
        <input className={`${select} min-w-52`} type="search" placeholder="Search contact or company…"
               value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select className={select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="slowest_reply">Slowest reply to prospect</option>
          <option value="slowest_first">Slowest first touch</option>
          <option value="longest_silence">Longest silence</option>
          <option value="fewest_touches">Fewest touches</option>
        </select>
        <div className="ml-auto flex rounded-md border p-0.5">
          {(Object.keys(VIEWS) as ViewKey[]).map((k) => (
            <button key={k} onClick={() => setView(k)}
                    className={`rounded px-2.5 py-1 text-sm ${view === k ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
              {VIEWS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="text-lg font-semibold">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {LEGEND_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width={16} height={16} viewBox="0 0 16 16"><Mark kind={k} x={8} y={8} /></svg>
            {MARKS[k].label}
          </span>
        ))}
        {view === "week" && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: "var(--tl-miss)" }} />
            day with no rep touch
          </span>
        )}
      </div>

      <div className="rounded-md border bg-card divide-y">
        {rows.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No leads match these filters.</p>
        )}
        {rows.map((lead) => {
          const verdict = verdictFor(view, lead);
          return (
            <div key={lead.id} className="grid grid-cols-[minmax(180px,15rem)_1fr_minmax(120px,10rem)] items-center gap-3 px-3 py-1.5">
              <div className="min-w-0">
                <a href={lead.url} target="_blank" rel="noreferrer"
                   className="block truncate text-sm font-medium hover:underline">
                  {lead.contact}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {[lead.account, lead.client, lead.rep].filter(Boolean).join(" · ")}
                </p>
              </div>

              <Lane lead={lead} view={view} />

              <div className="text-right">
                {verdict ? (
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${STATUS_CLASS[verdict.status]}`}>
                    {verdict.text}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {dur(lead.metrics.spanHours)} span
                  </span>
                )}
                <p className="text-xs text-muted-foreground">
                  {lead.outcomeLabel} · {lead.metrics.touches} touch{lead.metrics.touches === 1 ? "" : "es"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
