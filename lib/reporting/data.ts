import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  SpecSchema, ChartSchema, TileSchema,
  type Dashboard, type ObjectMeta, type ReportResult, type SavedReport, type Spec,
} from "./spec";

/**
 * Reads behind the report builder.
 *
 * Everything goes through the signed-in person's connection. The three
 * database functions are security invoker and the two tables carry row
 * security, so what comes back is what this person may see -- there is no
 * service-key path here and there must not be one.
 */

/** Every table and view the person may report on, with columns. Once per request. */
export const listObjects = cache(async (): Promise<ObjectMeta[]> => {
  const db = await createClient();
  const { data, error } = await db.rpc("report_objects");
  if (error) throw new Error(`Couldn't read the data catalogue: ${error.message}`);
  return (data ?? []) as ObjectMeta[];
});

export async function runSpec(spec: Spec): Promise<ReportResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("run_report", { p_spec: spec });
  if (error) throw new Error(error.message);
  return data as ReportResult;
}

export async function fieldValues(
  object: string, field: string, lookup: string | null, query: string,
): Promise<{ value: string; n: number }[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("report_field_values", {
    p_object: object, p_field: field, p_lookup: lookup, p_query: query || null, p_limit: 50,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as { value: string; n: number }[];
}

/*
 * A saved row's spec and chart are parsed on the way out, so a report saved
 * by an older build -- or edited by hand -- degrades to something the page
 * can draw rather than something it crashes on.
 */
type ReportRow = Omit<SavedReport, "spec" | "chart"> & { spec: unknown; chart: unknown };

function toReport(r: ReportRow): SavedReport | null {
  const spec = SpecSchema.safeParse(r.spec);
  if (!spec.success) return null;
  const chart = r.chart ? ChartSchema.safeParse(r.chart) : null;
  return { ...r, spec: spec.data, chart: chart?.success ? chart.data : null };
}

export async function listReports(): Promise<SavedReport[]> {
  const db = await createClient();
  const { data, error } = await db.from("reports").select("*").order("name");
  if (error) throw new Error(`Couldn't list reports: ${error.message}`);
  return ((data ?? []) as ReportRow[]).map(toReport).filter((r): r is SavedReport => r !== null);
}

export async function getReport(id: string): Promise<SavedReport | null> {
  const db = await createClient();
  const { data, error } = await db.from("reports").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't read the report: ${error.message}`);
  return data ? toReport(data as ReportRow) : null;
}

type DashboardRow = Omit<Dashboard, "tiles"> & { tiles: unknown };

function toDashboard(d: DashboardRow): Dashboard {
  const tiles = Array.isArray(d.tiles)
    ? d.tiles.map((t) => TileSchema.safeParse(t)).flatMap((p) => (p.success ? [p.data] : []))
    : [];
  return { ...d, tiles };
}

export async function listDashboards(): Promise<Dashboard[]> {
  const db = await createClient();
  const { data, error } = await db.from("dashboards").select("*").order("name");
  if (error) throw new Error(`Couldn't list dashboards: ${error.message}`);
  return ((data ?? []) as DashboardRow[]).map(toDashboard);
}

export async function getDashboard(id: string): Promise<Dashboard | null> {
  const db = await createClient();
  const { data, error } = await db.from("dashboards").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Couldn't read the dashboard: ${error.message}`);
  return data ? toDashboard(data as DashboardRow) : null;
}

/** Whether this person may change a saved thing: their own, or a shared one with org.manage. */
export function canEdit(
  row: { owner_member_id: string; shared: boolean },
  memberId: string | null,
  perms: Set<string>,
): boolean {
  if (memberId && row.owner_member_id === memberId) return true;
  return row.shared && perms.has("org.manage");
}
