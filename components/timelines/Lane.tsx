"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, StageSpan } from "@/lib/timelines/leads";
import { Mark, MARKS } from "./marks";
import { DEAD_BUCKETS, FIRST_RESPONSE_TARGET_H } from "@/lib/timelines/classify";

export type ViewKey = "quick" | "week" | "life";

// Re-exported so the board keeps importing it from the lane it draws on.
export { FIRST_RESPONSE_TARGET_H };

// Marks closer together than this are nudged apart rather than stacked.
const MARK_PITCH = 15;
// Cap on that nudge: on a lane with more activity than room, marks stay at
// their true position rather than cascading right into a lie.
const MAX_DRIFT = MARK_PITCH * 2;

export const VIEW_WINDOW: Record<ViewKey, number | null> = { quick: 1, week: 7, life: null };
const GLOBAL_TICKS: Record<ViewKey, number[] | null> = {
  quick: [0, 4, 8, 12, 16, 20, 24].map((h) => h / 24),
  week: [0, 1, 2, 3, 4, 5, 6, 7],
  life: null,
};

function lifetimeDays(lead: Lead): number {
  const span = lead.metrics.spanHours / 24;
  const open = !lead.stage.startsWith("Closed");
  if (open) return span + lead.metrics.daysSinceLastEvent;
  // A closed lead's final stage change lands on its last event, so the terminal
  // colour would get no width at all. Leave a tail for it to show.
  return span * 1.12;
}

function rowMax(lead: Lead): number {
  // Floor of 1h keeps a lead with a single same-minute event from dividing by
  // zero, and the 4% pad keeps the final mark off the right edge.
  return Math.max(1 / 24, lifetimeDays(lead)) * 1.04;
}

// Steps run from an hour to a quarter so the same routine serves a lane that is
// two hours wide and one that is six months wide.
const TICK_STEPS = [1 / 24, 2 / 24, 3 / 24, 6 / 24, 12 / 24, 1, 2, 3, 7, 14, 30, 60, 90];
function niceTicks(maxDays: number, target = 6): number[] {
  const step = TICK_STEPS.find((s) => s >= maxDays / target) ?? 90;
  const out: number[] = [];
  for (let d = 0; d <= maxDays * 0.995; d += step) out.push(d);
  return out;
}

const tickLabel = (d: number) => (d === 0 ? "" : d < 1 ? `${Math.round(d * 24)}h` : `${+d.toFixed(d < 3 ? 1 : 0)}d`);

function spanLabel(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 60) return `${Math.round(days)} days`;
  return `${Math.round(days / 30.4)} months`;
}

const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function dur(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const d = hours / 24;
  return d < 100 ? `${d.toFixed(d < 10 ? 1 : 0)}d` : `${Math.round(d)}d`;
}

export function Lane({ lead, view }: { lead: Lead; view: ViewKey }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  // Marks are glyphs at a fixed pixel size and the nudging works in pixels, so
  // the lane is drawn 1:1 against its measured width rather than stretched from
  // a fixed viewBox -- which would squash every glyph horizontally.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const perRow = VIEW_WINDOW[view] === null;
  const H = perRow ? 54 : 46;
  const y = H / 2;

  if (!w) return <div ref={host} style={{ height: H }} />;

  const windowEnd = perRow ? rowMax(lead) : (VIEW_WINDOW[view] as number);
  const px = (days: number) => (days / windowEnd) * w;

  const spanDays = lead.metrics.spanHours / 24;
  const openStage = !lead.stage.startsWith("Closed");
  // The lane runs to today for an open lead, or to its last event once closed.
  const laneEnd = Math.min(openStage ? spanDays + lead.metrics.daysSinceLastEvent : spanDays, windowEnd);

  const ticks = perRow ? niceTicks(rowMax(lead)) : (GLOBAL_TICKS[view] as number[]);

  // Stage dots and the DQ skull hold their true positions -- they mark where the
  // line changes -- so the activity marks are what move around them.
  const reserved: number[] = [];

  const segments: { x1: number; x2: number; bucket: string; silent: boolean }[] = [];
  const spans: StageSpan[] = lead.stageSpans;
  for (let i = 0; i < spans.length; i++) {
    const from = spans[i].fromHours / 24;
    if (from >= laneEnd) break;
    const to = i + 1 < spans.length ? spans[i + 1].fromHours / 24 : laneEnd;
    const a = Math.max(0, from), b = Math.min(to, laneEnd);
    if (b <= a) continue;
    // A segment can straddle the last touch, so the live and silent parts are
    // drawn separately rather than letting one style win the whole span.
    for (const [s, e, silent] of [
      [a, Math.min(b, spanDays), false],
      [Math.max(a, spanDays), b, true],
    ] as [number, number, boolean][]) {
      if (e <= s) continue;
      segments.push({ x1: px(s), x2: px(e), bucket: spans[i].bucket, silent });
    }
  }

  const stageDots: { cx: number; from: StageSpan; to: StageSpan; at: number }[] = [];
  for (let i = 1; i < spans.length; i++) {
    const at = spans[i].fromHours / 24;
    if (at > laneEnd) continue;
    const cx = px(at);
    reserved.push(cx);
    stageDots.push({ cx, from: spans[i - 1], to: spans[i], at });
  }

  const skulls: { x: number; stage: string | null }[] = [];
  for (const s of spans) {
    if (!DEAD_BUCKETS.has(s.bucket)) continue;
    const at = s.fromHours / 24;
    if (at > laneEnd) continue;
    const sx = px(at) + MARK_PITCH;
    reserved.push(sx);
    skulls.push({ x: sx, stage: s.stage });
  }

  // Stage changes are the lane's colour now, so they no longer get a mark.
  // Whichever change kind drives this pipeline's spans is already drawn as the
  // two-tone dots on the line, so it is not also drawn as a tick.
  const spanKind = lead.pipeline === "prospecting" ? "status_change" : "stage_change";
  const marks = lead.events.filter((e) => e.kind !== spanKind);
  const inWindow = marks.filter((e) => e.hours / 24 <= windowEnd);
  const beyond = marks.length - inWindow.length;

  // Two marks at the same moment sit side by side instead of on top of each
  // other, stepping clear of any stage dot or skull they would land on.
  const placed: [(typeof inWindow)[number], number][] = [];
  let prev = -Infinity;
  for (const ev of inWindow) {
    const trueX = px(ev.hours / 24);
    let at = Math.max(trueX, prev + MARK_PITCH);
    for (let guard = 0; guard < reserved.length; guard++) {
      const clash = reserved.find((rx) => Math.abs(at - rx) < MARK_PITCH);
      if (clash === undefined) break;
      at = clash + MARK_PITCH;
    }
    if (at - trueX > MAX_DRIFT) at = trueX;
    placed.push([ev, at]);
    prev = at;
  }

  return (
    <div ref={host}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
        {ticks.map((d) => (
          <g key={`t${d}`}>
            <line className="gridline" x1={px(d)} x2={px(d)} y1={perRow ? 14 : 0} y2={H} />
            {perRow && d > 0 && (
              <text className="ticktext" x={px(d) + 3} y={11}>{tickLabel(d)}</text>
            )}
          </g>
        ))}

        {perRow && (
          <text className="ticktext strong" x={w} y={11} textAnchor="end">
            {spanLabel(lifetimeDays(lead))}
          </text>
        )}

        {view === "quick" && (
          <line className="goalline" x1={px(FIRST_RESPONSE_TARGET_H / 24)}
                x2={px(FIRST_RESPONSE_TARGET_H / 24)} y1={0} y2={H} />
        )}

        {segments.map((s, i) => (
          <line key={`s${i}`} x1={s.x1} x2={s.x2} y1={y} y2={y}
                stroke={`var(--st-${s.bucket})`} strokeWidth={s.silent ? 2 : 3}
                strokeLinecap={s.silent ? "butt" : "round"}
                strokeDasharray={s.silent ? "3 4" : undefined} />
        ))}

        {/* Every stage change gets a two-tone dot: the colour it left on the
            left half, the colour it entered on the right. */}
        {stageDots.map((d, i) => (
          <g key={`d${i}`}>
            <path d={`M${d.cx},${y - 5.5} A5.5,5.5 0 0 0 ${d.cx},${y + 5.5} Z`}
                  fill={`var(--st-${d.from.bucket})`} stroke="var(--surface-1)" strokeWidth={1.2} />
            <path d={`M${d.cx},${y - 5.5} A5.5,5.5 0 0 1 ${d.cx},${y + 5.5} Z`}
                  fill={`var(--st-${d.to.bucket})`} stroke="var(--surface-1)" strokeWidth={1.2} />
            <circle cx={d.cx} cy={y} r={10} fill="transparent" />
            <title>
              {`Stage change: ${d.from.stage ?? "unknown stage"} → ${d.to.stage}` +
               (d.to.at ? ` · ${fmtDateTime(d.to.at)}` : "") +
               ` · day ${d.at.toFixed(1)}` + (d.to.actor ? ` · ${d.to.actor}` : "")}
            </title>
          </g>
        ))}

        {/* A DQ gets a skull where the lead entered it, set clear of the dot. */}
        {skulls.map((s, i) => (
          <g key={`k${i}`}>
            <Mark kind="dead_end" x={s.x} y={y} />
            <title>{`DQ: ${s.stage ?? ""}`}</title>
          </g>
        ))}

        {/* Lead arrival. */}
        <line x1={0.5} x2={0.5} y1={y - 11} y2={y + 11} stroke="var(--border-strong)" strokeWidth={2} />

        {placed.map(([ev, mx]) => (
          <a key={ev.id} href={ev.url} target="_blank" rel="noopener noreferrer" style={{ cursor: "pointer" }}>
            <Mark kind={ev.kind} x={mx} y={y} />
            <circle cx={mx} cy={y} r={10} fill="transparent" />
            <title>
              {`${MARKS[ev.kind]?.label ?? ev.kind} · ${ev.detail.slice(0, 180)} · ` +
               `${fmtDateTime(ev.at)} · ${dur(ev.hours)} in` +
               (ev.actor ? ` · ${ev.actor}` : "") +
               (ev.sequence ? ` · Sequence: ${ev.sequence}` : "")}
            </title>
          </a>
        ))}

        {/* Everything past the window is summarised rather than dropped, so a
            row never implies a lead went quiet when it ran on past the goal. */}
        {beyond > 0 && (
          <g>
            <path d={`M${w - 15},${y - 4.5} L${w - 10},${y} L${w - 15},${y + 4.5}`} fill="none"
                  stroke="var(--text-muted)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            <text className="ticktext" x={w - 18} y={y + 3.5} textAnchor="end">+{beyond}</text>
            <rect x={w - 52} y={0} width={52} height={H} fill="transparent" />
            <title>{`${beyond} more activit${beyond === 1 ? "y" : "ies"} after the window, through day ${Math.round(spanDays)} — switch to Full lead life to see them`}</title>
          </g>
        )}
      </svg>
    </div>
  );
}
