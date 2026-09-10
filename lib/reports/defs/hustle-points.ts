import { createClient } from "@/lib/supabase/server";
import { isoDaysAgo, today } from "../params";
import type { Report } from "../types";

/**
 * Hustle points per rep over a period, from the same function the scoreboard
 * reads. The function returns one row per rep per effort source; this adds
 * them up per rep and splits them the way the activities page does -- calls,
 * emails, meetings -- so a manager can see what the points are made of.
 *
 * The board is open (BOARD_MASKING.hustlePoints is false), so no name is
 * masked here either. If that ever changes, this report has to change with it.
 */

type Source = {
  rep_id: string;
  display_name: string;
  effort_source: string;
  activity_count: number | string | null;
  points: number | string | null;
};

type Row = {
  repId: string;
  name: string;
  calls: number;
  emails: number;
  meetings: number;
  activities: number;
  points: number;
};

/* The nine sources the leaderboard counts, grouped as rep_activity_detail groups them. */
const CATEGORY: Record<string, "calls" | "emails" | "meetings"> = {
  "Manual Call": "calls",
  "Automated Call (Power Dialer)": "calls",
  "Automated Call (Parallel Dialer)": "calls",
  "Manual SMS": "calls",
  "Sequence Email (Automated Send)": "emails",
  "Manual Email": "emails",
  "Internal Meeting": "meetings",
  "Client Meeting (Check-In)": "meetings",
  "Prospect Meeting": "meetings",
};

export const hustlePoints: Report<Row> = {
  key: "hustle-points",
  label: "Hustle points",
  description: "Activities and points per rep over a period, split into calls, emails and meetings.",
  group: "Sales",
  noun: "reps",
  permissions: ["scoreboard.view"],
  params: [
    { key: "from", label: "From", type: "date", default: () => isoDaysAgo(30) },
    { key: "to", label: "To", type: "date", default: today },
    {
      key: "source",
      label: "Activity type",
      type: "picklist",
      options: Object.keys(CATEGORY).map((s) => ({ value: s, label: s })),
    },
  ],
  search: (r) => r.name,
  columns: [
    {
      key: "rep", label: "Rep", type: "text", read: (r) => r.name,
      href: (r) => `/scoreboard/hustle-points/${r.repId}/activities`,
    },
    { key: "calls", label: "Calls", type: "number", read: (r) => r.calls, total: "sum" },
    { key: "emails", label: "Emails", type: "number", read: (r) => r.emails, total: "sum" },
    { key: "meetings", label: "Meetings", type: "number", read: (r) => r.meetings, total: "sum" },
    { key: "activities", label: "Activities", type: "number", read: (r) => r.activities, total: "sum" },
    { key: "points", label: "Points", type: "number", read: (r) => r.points, total: "sum" },
  ],
  rowKey: (r) => r.repId,
  defaultSort: { key: "points", dir: "desc" },
  run: async (v) => {
    // The session client: the function is security definer but gates on
    // is_factur_user(), which reads the caller's token.
    const db = await createClient();
    const { data, error } = await db.rpc("get_hustle_leaderboard_by_source", {
      p_start: v.from,
      p_end: v.to,
    });
    if (error) throw new Error(`Hustle points query failed: ${error.message}`);

    const byRep = new Map<string, Row>();
    for (const s of (data ?? []) as Source[]) {
      // The type filter narrows before the roll-up, so the totals are of the
      // chosen type alone rather than of everything with one column hidden.
      if (v.source && s.effort_source !== v.source) continue;
      const row = byRep.get(s.rep_id) ?? {
        repId: s.rep_id, name: s.display_name,
        calls: 0, emails: 0, meetings: 0, activities: 0, points: 0,
      };
      const n = Number(s.activity_count ?? 0);
      const cat = CATEGORY[s.effort_source];
      if (cat) row[cat] += n;
      row.activities += n;
      // Postgres numerics arrive as strings.
      row.points += Number(s.points ?? 0);
      byRep.set(s.rep_id, row);
    }
    return [...byRep.values()];
  },
};
