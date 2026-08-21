import type { EventKind } from "@/lib/timelines/classify";

// Glyph paths ported from the prototype. Each is drawn centred on the origin at
// roughly 11px, so placing a mark is just a translate. `solid` parts take the
// mark colour as a fill; `knockout` strokes sit on top of a solid body and take
// the surface colour so they read as cut out of it.
type Part = { d: string; solid?: boolean; knockout?: boolean; wide?: boolean };

const ICONS: Record<string, Part[]> = {
  envelope: [
    { d: "M-5.4,-3.9 h10.8 v7.8 h-10.8 Z" },
    { d: "M-5.4,-3.9 L0,0.7 L5.4,-3.9" },
  ],
  "envelope-solid": [
    { d: "M-5.4,-3.9 h10.8 v7.8 h-10.8 Z", solid: true },
    { d: "M-5.4,-3.9 L0,0.7 L5.4,-3.9", knockout: true },
  ],
  phone: [
    {
      d:
        "M-4.6,-3.7 c0,-1.1 0.9,-1.9 2,-1.6 l1.1,0.3 c0.7,0.2 1.1,0.9 0.8,1.6 " +
        "l-0.4,1 c1,1.5 2.3,2.8 3.8,3.8 l1,-0.4 c0.7,-0.3 1.4,0.1 1.6,0.8 " +
        "l0.3,1.1 c0.3,1.1 -0.5,2 -1.6,2 C0.6,6.6 -4.6,1.4 -4.6,-3.7 Z",
    },
  ],
  skull: [
    { d: "M-6.2,1.4 L6.2,6 M6.2,1.4 L-6.2,6" },
    {
      d:
        "M0,-6.4 a4.3,4.3 0 0 1 4.3,4.3 v1.1 a1.7,1.7 0 0 1 -1.7,1.7 h-5.2 " +
        "a1.7,1.7 0 0 1 -1.7,-1.7 v-1.1 A4.3,4.3 0 0 1 0,-6.4 Z",
      solid: true,
    },
    { d: "M-1.9,-2.6 h0.01 M1.9,-2.6 h0.01", knockout: true, wide: true },
  ],
  calendar: [
    { d: "M-5,-3.6 h10 v8.2 h-10 Z" },
    { d: "M-5,-1.1 h10" },
    { d: "M-2.6,-5.5 v2.3 M2.6,-5.5 v2.3" },
  ],
  "calendar-solid": [
    { d: "M-5,-3.6 h10 v8.2 h-10 Z", solid: true },
    { d: "M-5,-1.1 h10", knockout: true },
    { d: "M-2.6,-5.5 v2.3 M2.6,-5.5 v2.3" },
  ],
};

// Colour says who acted; shape says which channel.
export const MARKS: Record<string, { label: string; color: string; shape: string }> = {
  email_out: { label: "Email sent", color: "var(--rep)", shape: "envelope" },
  call: { label: "Call", color: "var(--rep)", shape: "phone" },
  sms: { label: "Text", color: "var(--rep)", shape: "square" },
  meeting_invite: { label: "Meeting invited", color: "var(--rep)", shape: "calendar" },
  meeting_booked: { label: "Meeting booked", color: "var(--rep)", shape: "calendar-solid" },
  email_in: { label: "Prospect email", color: "var(--prospect)", shape: "envelope-solid" },
  call_in: { label: "Inbound call", color: "var(--prospect)", shape: "phone" },
  meeting_declined: { label: "Meeting declined", color: "var(--prospect)", shape: "calendar" },
  stage_change: { label: "Stage change", color: "var(--stage)", shape: "tick" },
  status_change: { label: "Status change", color: "var(--stage)", shape: "tick-short" },
  dead_end: { label: "DQ", color: "var(--st-dead)", shape: "skull" },
  other: { label: "Activity", color: "var(--text-muted)", shape: "dot" },
};

/**
 * Which side of the line a mark sits on: -1 above, 1 below, 0 straddling it.
 *
 * Taken from the mark's colour rather than from the REP_TOUCH / PROSPECT_SIGNAL
 * sets, because the colour is what a reader actually sees -- orange above, red
 * below, matching the key. The two disagree on one kind: a booked meeting is a
 * signal from the prospect but is drawn in Factur's orange, and it belongs with
 * the colour it is drawn in.
 *
 * Stage marks and the skull straddle the line: they are not activity by either
 * side, they are the lead's own state changing.
 */
export function markSide(kind: string): -1 | 0 | 1 {
  const mark = MARKS[kind] ?? MARKS.other;
  if (mark.color === "var(--prospect)") return 1;
  if (mark.color === "var(--rep)") return -1;
  return 0;
}

export const LEGEND_ORDER: EventKind[] = [
  "email_out", "call", "meeting_invite", "meeting_booked", "email_in", "call_in",
];

// Glyphs are drawn on an 11px grid; this is how much bigger they render.
const ICON_SCALE = 1.3;

export function Mark({ kind, x, y }: { kind: string; x: number; y: number }) {
  const mark = MARKS[kind] ?? MARKS.other;
  const icon = ICONS[mark.shape];

  if (icon) {
    return (
      <g transform={`translate(${x},${y}) scale(${ICON_SCALE})`}>
        {icon.map((part, i) => (
          <path
            key={i}
            d={part.d}
            fill={part.solid ? mark.color : "none"}
            stroke={part.knockout ? "var(--surface-1)" : mark.color}
            strokeWidth={part.wide ? 1.9 : part.solid ? 1.1 : 1.35}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  }

  const t = `translate(${x},${y})`;
  // A 1.5px surface ring keeps overlapping marks readable.
  const solid = { fill: mark.color, stroke: "var(--surface-1)", strokeWidth: 1.5 };
  switch (mark.shape) {
    case "square":
      return <rect transform={t} x={-5.2} y={-5.2} width={10.4} height={10.4} rx={2} {...solid} />;
    case "tick":
      return <rect transform={t} x={-1.6} y={-15} width={3.2} height={30} rx={1.6} fill={mark.color} />;
    case "tick-short":
      return <rect transform={t} x={-1.6} y={-8.5} width={3.2} height={17} rx={1.6} fill={mark.color} />;
    default:
      return <circle transform={t} r={3} {...solid} />;
  }
}
