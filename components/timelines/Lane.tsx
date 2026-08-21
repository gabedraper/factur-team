"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, StageSpan } from "@/lib/timelines/leads";
import { Mark, markSide, markSentence } from "./marks";
import { DEAD_BUCKETS, FIRST_RESPONSE_TARGET_H } from "@/lib/timelines/classify";
import { hoursUntilEndOfDay } from "@/lib/timelines/business-day";

export type ViewKey = "quick" | "week" | "life";

// Re-exported so the board keeps importing it from the lane it draws on.
export { FIRST_RESPONSE_TARGET_H };

// Marks closer together than this are nudged apart rather than stacked.
const MARK_PITCH = 15;
// Cap on that nudge: on a lane with more activity than room, marks stay at
// their true position rather than cascading right into a lie.
const MAX_DRIFT = MARK_PITCH * 2;

export const VIEW_WINDOW: Record<ViewKey, number | null> = { quick: 1, week: 7, life: null };
// The quick view draws no gridlines: the axis labels above give the scale, and
// the only line worth having on it is the end of the lead's arrival day.
const GLOBAL_TICKS: Record<ViewKey, number[] | null> = {
  quick: [],
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
  const H = perRow ? 70 : 62;
  const y = H / 2;
  // Far enough off the line that a glyph clears it rather than sitting on it.
  const OFFSET = 15;
  const LINE_W = 6;

  if (!w) return <div ref={host} style={{ height: H }} />;

  const windowEnd = perRow ? rowMax(lead) : (VIEW_WINDOW[view] as number);
  const px = (days: number) => (days / windowEnd) * w;

  const spanDays = lead.metrics.spanHours / 24;
  const openStage = !lead.stage.startsWith("Closed");
  // The lane runs to today for an open lead, or to its last event once closed.
  const laneEnd = Math.min(openStage ? spanDays + lead.metrics.daysSinceLastEvent : spanDays, windowEnd);

  const ticks = perRow ? niceTicks(rowMax(lead)) : (GLOBAL_TICKS[view] as number[]);
  const endOfDay = hoursUntilEndOfDay(lead.created);

  // Stage dots and the DQ skull hold their true positions -- they mark where the
  // line changes -- so the activity marks are what move around them.
  const reserved: number[] = [];

  // The line runs to the last activity and stops. Beyond that there is nothing
  // to draw, and the empty stretch to the right edge is itself the silence.
  const segments: { x1: number; x2: number; bucket: string }[] = [];
  const spans: StageSpan[] = lead.stageSpans;
  const drawnEnd = Math.min(laneEnd, spanDays);
  for (let i = 0; i < spans.length; i++) {
    const from = spans[i].fromHours / 24;
    if (from >= drawnEnd) break;
    const to = i + 1 < spans.length ? spans[i + 1].fromHours / 24 : drawnEnd;
    const a = Math.max(0, from), b = Math.min(to, drawnEnd);
    if (b <= a) continue;
    segments.push({ x1: px(a), x2: px(b), bucket: spans[i].bucket });
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

  /*
   * Two marks at the same moment sit side by side rather than on top of each
   * other -- but only against the marks sharing their side of the line. A call
   * out and a reply in at the same hour no longer shove each other along,
   * because they are no longer in each other's way.
   *
   * Marks that straddle the line still step clear of the stage dots and the
   * skull, which sit on it.
   */
  type Placed = { ev: (typeof inWindow)[number]; x: number; side: -1 | 0 | 1 };
  const placeRow = (row: typeof inWindow, side: -1 | 0 | 1): Placed[] => {
    const out: Placed[] = [];
    let prev = -Infinity;
    for (const ev of row) {
      const trueX = px(ev.hours / 24);
      let at = Math.max(trueX, prev + MARK_PITCH);
      if (side === 0) {
        for (let guard = 0; guard < reserved.length; guard++) {
          const clash = reserved.find((rx) => Math.abs(at - rx) < MARK_PITCH);
          if (clash === undefined) break;
          at = clash + MARK_PITCH;
        }
      }
      // Past this much drift the mark would be lying about when it happened,
      // so it goes back to its true position and overlaps instead.
      if (at - trueX > MAX_DRIFT) at = trueX;
      out.push({ ev, x: at, side });
      prev = at;
    }
    return out;
  };

  const placed: Placed[] = ([-1, 0, 1] as const).flatMap((side) =>
    placeRow(inWindow.filter((e) => markSide(e.kind) === side), side)
  );

  return (
    <div ref={host}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
        {ticks.map((d) => (
          <g key={`t${d}`}>
            {d > 0 && (
              <line className="gridline" x1={px(d)} x2={px(d)} y1={perRow ? 14 : 0} y2={H} />
            )}
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

        {/* End of the arrival day. A first touch left of this was same-day. */}
        {view === "quick" && endOfDay !== null && (
          <g>
            <line className="eodline" x1={px(endOfDay / 24)} x2={px(endOfDay / 24)} y1={0} y2={H} />
            <title>5pm Central on the day the lead arrived — a touch before this is same-day</title>
          </g>
        )}

        {/* A round cap reaches half the stroke width past its endpoint, so at
            day zero the line would poke out to the left of the arrival marker.
            Starting it half a width in puts the cap's outer edge exactly on
            zero, which is where the line should appear to begin. */}
        {segments.map((s, i) => (
          <line key={`s${i}`} x1={Math.max(s.x1, LINE_W / 2)} x2={s.x2} y1={y} y2={y}
                stroke={`var(--st-${s.bucket})`} strokeWidth={LINE_W} strokeLinecap="round" />
        ))}

        {/* Every stage change gets a two-tone dot: the colour it left on the
            left half, the colour it entered on the right. */}
        {stageDots.map((d, i) => (
          <g key={`d${i}`}>
            <path d={`M${d.cx},${y - 7.5} A7.5,7.5 0 0 0 ${d.cx},${y + 7.5} Z`}
                  fill={`var(--st-${d.from.bucket})`} stroke="var(--surface-1)" strokeWidth={1.2} />
            <path d={`M${d.cx},${y - 7.5} A7.5,7.5 0 0 1 ${d.cx},${y + 7.5} Z`}
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
        <line x1={1} x2={1} y1={y - 14} y2={y + 14} stroke="var(--border-strong)" strokeWidth={2} />

        {placed.map(({ ev, x: mx, side }) => {
          const my = y + side * OFFSET;
          return (
          <a key={ev.id} href={ev.url} target="_blank" rel="noopener noreferrer" style={{ cursor: "pointer" }}>
            <Mark kind={ev.kind} x={mx} y={my} />
            <circle cx={mx} cy={my} r={10} fill="transparent" />
            <title>{markSentence(ev.kind, ev.actor, fmtDateTime(ev.at))}</title>
          </a>
          );
        })}

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
