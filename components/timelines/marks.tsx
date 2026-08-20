import type { EventKind } from "@/lib/timelines/classify";

// Colour says who acted; shape says which channel. This is the vocabulary the
// prototype's README documents. The prototype had since grown hand-drawn glyph
// icons -- those are not ported; these are the shapes the docs describe.
export const MARKS: Record<string, { label: string; tone: "rep" | "prospect" | "stage" | "muted"; shape: string }> = {
  email_out: { label: "Email sent", tone: "rep", shape: "circle" },
  call: { label: "Call", tone: "rep", shape: "triangle" },
  sms: { label: "Text", tone: "rep", shape: "square" },
  meeting_invite: { label: "Meeting invited", tone: "rep", shape: "diamond-open" },
  meeting_booked: { label: "Meeting booked", tone: "rep", shape: "star" },
  email_in: { label: "Prospect email", tone: "prospect", shape: "diamond" },
  call_in: { label: "Inbound call", tone: "prospect", shape: "triangle" },
  meeting_declined: { label: "Meeting declined", tone: "prospect", shape: "cross" },
  stage_change: { label: "Stage change", tone: "stage", shape: "tick" },
  status_change: { label: "Status change", tone: "stage", shape: "tick-short" },
  other: { label: "Activity", tone: "muted", shape: "dot" },
};

export const LEGEND_ORDER: EventKind[] = [
  "email_out", "call", "meeting_invite", "meeting_booked", "email_in", "call_in",
];

const TONE_VAR: Record<string, string> = {
  rep: "var(--tl-rep)",
  prospect: "var(--tl-prospect)",
  stage: "var(--tl-stage)",
  muted: "var(--tl-muted)",
};

export function Mark({ kind, x, y }: { kind: string; x: number; y: number }) {
  const mark = MARKS[kind] ?? MARKS.other;
  const color = TONE_VAR[mark.tone];
  // A 1.5px surface-coloured ring keeps overlapping marks readable.
  const solid = { fill: color, stroke: "var(--tl-surface)", strokeWidth: 1.5 };
  const open = { fill: "none", stroke: color, strokeWidth: 2 };
  const t = `translate(${x},${y})`;

  switch (mark.shape) {
    case "circle": return <circle transform={t} r={4.5} {...solid} />;
    case "dot": return <circle transform={t} r={3.3} {...solid} />;
    case "square": return <rect transform={t} x={-5.2} y={-5.2} width={10.4} height={10.4} rx={2} {...solid} />;
    case "triangle": return <path transform={t} d="M0,-5.4 L4.9,3.4 L-4.9,3.4 Z" {...solid} />;
    case "diamond": return <path transform={t} d="M0,-5.6 L5.6,0 L0,5.6 L-5.6,0 Z" {...solid} />;
    case "diamond-open": return <path transform={t} d="M0,-5.6 L5.6,0 L0,5.6 L-5.6,0 Z" {...open} />;
    case "star": return <path transform={t} d="M0,-7 L1.9,-2.3 L7,-2.2 L2.9,1 L4.3,6 L0,3.1 L-4.3,6 L-2.9,1 L-7,-2.2 L-1.9,-2.3 Z" {...solid} />;
    case "cross": return <path transform={t} d="M-4,-4 L4,4 M4,-4 L-4,4" {...open} strokeLinecap="round" />;
    case "tick": return <rect transform={t} x={-1.6} y={-11} width={3.2} height={22} rx={1.6} {...solid} strokeWidth={0} />;
    case "tick-short": return <rect transform={t} x={-1.6} y={-7} width={3.2} height={14} rx={1.6} {...solid} strokeWidth={0} />;
    default: return <circle transform={t} r={3} {...solid} />;
  }
}
