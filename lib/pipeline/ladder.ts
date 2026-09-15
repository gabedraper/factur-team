import type { StageFields } from "@/lib/pipeline/targets";
import type { ListField } from "@/lib/pipeline/list-views";

/*
 * The ladder a viewer reads, and what it changes.
 *
 * A pursuit carries two progress fields. Stage is the deal's ladder and belongs
 * to the people serving clients; Prospecting Lead Status is the prospector's
 * and belongs to the BDMs and SDRs selling Factur's own services. The role
 * says which (org_roles.stage_field, read through my_stage_fields()), and
 * everything on an opportunity screen -- the default columns, the board's
 * lanes, the filters offered, what "active" means -- follows that answer.
 *
 * Pure functions, safe on either side of the server boundary. Reading the
 * viewer's ladder is in ladder-server.ts.
 */

export type Ladder = "stage" | "lead_status" | "both";

export type ProgressKey = "stage" | "lead_status";
export type ActiveColumn = "active_by_stage" | "active_by_lead_status";

export function ladderOf(f: StageFields | null | undefined): Ladder {
  if (!f) return "both";
  if (f.show_stage && !f.show_lead_status) return "stage";
  if (f.show_lead_status && !f.show_stage) return "lead_status";
  return "both";
}

/**
 * The one progress field a viewer works, where only one will do: a board has
 * one set of lanes, a default column list has one progress column. Somebody
 * who reads both gets the deal ladder, since that is the one with an ordered
 * pipeline to move things along.
 */
export function primaryField(ladder: Ladder): ProgressKey {
  return ladder === "lead_status" ? "lead_status" : "stage";
}

export const PROGRESS_LABEL: Record<ProgressKey, string> = {
  stage: "Stage",
  lead_status: "Lead status",
};

/** Whether this viewer reads a field. Anything that is not a ladder, always. */
export function readsField(ladder: Ladder, key: string): boolean {
  if (key === "stage") return ladder !== "lead_status";
  if (key === "lead_status") return ladder !== "stage";
  return true;
}

/**
 * A column list as this viewer should see it: the other ladder's column
 * becomes theirs, once. A shared view an admin saved with Stage in it shows a
 * BDM their Lead status in that spot rather than a column that means nothing
 * to them.
 */
export function columnsForLadder(columns: string[], ladder: Ladder): string[] {
  if (ladder === "both") return columns;
  const mine = primaryField(ladder);
  const out: string[] = [];
  for (const c of columns) {
    const k = c === "stage" || c === "lead_status" ? mine : c;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** The catalogue narrowed to what this viewer reads, for editors and pickers. */
export function fieldsForLadder(fields: ListField[], ladder: Ladder): ListField[] {
  return fields.filter((f) => readsField(ladder, f.key));
}

/** The flag column(s) "active" means on this ladder. */
export function activeColumns(ladder: Ladder): ActiveColumn[] {
  if (ladder === "stage") return ["active_by_stage"];
  if (ladder === "lead_status") return ["active_by_lead_status"];
  return ["active_by_stage", "active_by_lead_status"];
}

/**
 * The "Active" field pointed at this viewer's flag column(s). For somebody who
 * reads both ladders it selects both, and the cell shows active when either
 * is -- a pursuit still moving on one ladder is still moving.
 */
export function resolveForLadder(fields: ListField[], ladder: Ladder): ListField[] {
  return fields.map((f) => {
    if (f.key !== "active") return f;
    const [path, ...extraSelect] = activeColumns(ladder);
    return { ...f, path, extraSelect };
  });
}
