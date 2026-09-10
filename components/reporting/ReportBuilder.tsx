"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { LoadFailed } from "@/components/list/EmptyState";
import { deleteReport, lookupValues, previewReport, saveReport } from "@/actions/reports";
import {
  AGGREGATE_FNS, AGGREGATE_LABELS, BUCKETS, BUCKET_LABELS, CHART_TYPES, OPERATORS,
  columnLabel, emptySpec, humanize, isSummary,
  type Aggregate, type Chart, type ChartType, type Filter, type Group, type Kind,
  type ObjectMeta, type ReportResult, type SavedReport, type Spec,
} from "@/lib/reporting/spec";
import { ReportChart } from "./ReportChart";
import { ResultTable } from "./ResultTable";
import {
  FIELD, FieldSelect, Labelled, RemoveButton, Segmented,
  decodeRef, encodeRef, kindOf, refLabel, starterColumns,
} from "./builder-bits";

/**
 * The report builder.
 *
 * Left: what to report on -- the object, the shape (rows or a summary), the
 * filters. Right: what it looks like, live. Every change re-runs the report
 * after a short pause, so the preview is always the thing that will be
 * saved; there is no separate "run" step to forget.
 *
 * Nothing here talks to the database. The spec goes to a server action,
 * which checks its shape and hands it to run_report(), which checks every
 * name in it. What comes back is drawn; what does not come back is said.
 */

const nf = new Intl.NumberFormat("en-US");

const CHART_LABELS: Record<ChartType, string> = {
  table: "Table only",
  bar: "Columns",
  hbar: "Bars",
  line: "Line",
  area: "Area",
  donut: "Donut",
  stat: "One figure",
};

const LIMITS = [100, 500, 1000, 2500, 5000];

type Mode = "rows" | "summary";

/** The spec as it will run: only the half the mode uses. */
function effective(spec: Spec, mode: Mode): Spec {
  return mode === "summary"
    ? { ...spec, columns: [] }
    : { ...spec, groups: [], aggregates: [] };
}

export function ReportBuilder({
  objects,
  initial,
  canDelete,
  copy = false,
}: {
  objects: ObjectMeta[];
  initial: SavedReport | null;
  /** Whether Delete is offered: the author, or org.manage on a shared one. */
  canDelete: boolean;
  /**
   * Start from `initial` but save as a new report. How somebody who may not
   * change a shared report still gets to adjust it -- a view is a starting
   * point, not a cage.
   */
  copy?: boolean;
}) {
  const editing = copy ? null : initial;
  const router = useRouter();
  const byName = useMemo(() => new Map(objects.map((o) => [o.name, o])), [objects]);

  const [spec, setSpec] = useState<Spec>(initial?.spec ?? emptySpec());
  const [mode, setMode] = useState<Mode>(initial && isSummary(initial.spec) ? "summary" : "rows");
  const [chart, setChart] = useState<Chart>(initial?.chart ?? { type: "table" });
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [objectQuery, setObjectQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(copy && initial ? `Copy of ${initial.name}` : initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [shared, setShared] = useState(editing?.shared ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, startSave] = useTransition();

  const object = byName.get(spec.object) ?? null;
  const ready = Boolean(object) && (mode === "summary"
    ? spec.groups.length > 0 || spec.aggregates.length > 0
    : spec.columns.length > 0);

  /* The live preview. Debounced, and a stale answer is dropped rather than
     drawn over a newer one. */
  const runId = useRef(0);
  useEffect(() => {
    if (!ready) { setResult(null); setError(null); return; }
    const id = ++runId.current;
    const handle = setTimeout(() => {
      startRun(async () => {
        const out = await previewReport(effective(spec, mode));
        if (id !== runId.current) return;
        if (out.ok) { setResult(out.result); setError(null); }
        else { setError(out.error); }
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [spec, mode, ready]);

  /* A chart needs an axis and a measure; pick the obvious ones when the
     result changes shape and the current choice no longer exists. */
  useEffect(() => {
    if (!result) return;
    const keys = new Set(result.columns.map((c) => c.key));
    const dims = result.columns.filter((c) => c.kind !== "number");
    const measures = result.columns.filter((c) => c.kind === "number");
    setChart((c) => {
      const next = { ...c };
      if (!next.x || !keys.has(next.x)) next.x = dims[0]?.key ?? null;
      if (!next.y || !keys.has(next.y)) next.y = measures[0]?.key ?? null;
      if (next.series && !keys.has(next.series)) next.series = null;
      return next;
    });
  }, [result]);

  // -- object -------------------------------------------------------------

  function changeObject(nameOf: string) {
    const o = byName.get(nameOf);
    setSpec({ ...emptySpec(nameOf), columns: o ? starterColumns(o) : [] });
    setChart({ type: "table" });
    setMode("rows");
    setResult(null);
    setError(null);
  }

  const shownObjects = useMemo(() => {
    const q = objectQuery.trim().toLowerCase();
    return q ? objects.filter((o) => o.name.includes(q)) : objects;
  }, [objects, objectQuery]);

  // -- columns / groups / measures ----------------------------------------

  const patch = (p: Partial<Spec>) => setSpec((s) => ({ ...s, ...p }));

  function addColumn(v: string) {
    if (!v) return;
    const ref = decodeRef(v);
    if (spec.columns.some((c) => encodeRef(c) === v)) return;
    patch({ columns: [...spec.columns, ref] });
  }

  function addGroup(v: string) {
    if (!v) return;
    const ref = decodeRef(v);
    const kind = kindOf(ref, object, byName);
    const group: Group = kind === "date" || kind === "datetime" ? { ...ref, bucket: "month" } : ref;
    patch({ groups: [...spec.groups, group] });
  }

  function updateAggregate(i: number, p: Partial<Aggregate>) {
    patch({ aggregates: spec.aggregates.map((a, j) => (j === i ? { ...a, ...p } : a)) });
  }

  // -- filters --------------------------------------------------------------

  function addFilter() {
    if (!object) return;
    const first = object.columns.find((c) => c.kind === "text") ?? object.columns[0];
    if (!first) return;
    const kind = first.kind;
    patch({ filters: [...spec.filters, { field: first.name, op: OPERATORS[kind][0].op, value: "" }] });
  }

  function updateFilter(i: number, p: Partial<Filter>) {
    patch({
      filters: spec.filters.map((f, j) => {
        if (j !== i) return f;
        const next = { ...f, ...p };
        // A new field may not accept the old operator; start it over.
        if (p.field !== undefined || p.lookup !== undefined) {
          const kind = kindOf(next, object, byName) ?? "text";
          next.op = OPERATORS[kind][0].op;
          next.value = "";
        }
        return next;
      }),
    });
  }

  /* Value suggestions for a text filter: the field's most common values,
     fetched once per field and offered as a datalist. */
  async function suggestFor(f: Filter) {
    const key = `${spec.object}:${encodeRef(f)}`;
    if (suggestions[key] || !object) return;
    const kind = kindOf(f, object, byName);
    if (kind !== "text" && kind !== "uuid") return;
    const rows = await lookupValues({ object: spec.object, field: f.field, lookup: f.lookup ?? null });
    setSuggestions((s) => ({ ...s, [key]: rows.map((r) => r.value) }));
  }

  // -- sort -----------------------------------------------------------------

  function onSort(key: string) {
    const current = spec.sort[0];
    const dir = current?.key === key && current.dir === "asc" ? "desc" : "asc";
    patch({ sort: [{ key, dir }] });
  }

  // -- save / delete --------------------------------------------------------

  function save() {
    setSaveError(null);
    startSave(async () => {
      const out = await saveReport({
        id: editing?.id ?? null,
        name,
        description,
        shared,
        spec: effective(spec, mode),
        chart: chart.type === "table" ? null : chart,
      });
      if (!out.success || !out.id) { setSaveError(out.error ?? "Couldn't save."); return; }
      setSaving(false);
      router.push(`/reports/r/${out.id}`);
      router.refresh();
    });
  }

  function remove() {
    if (!editing) return;
    if (!window.confirm(`Delete "${editing.name}"? Dashboards showing it will lose the tile.`)) return;
    startSave(async () => {
      const out = await deleteReport(editing.id);
      if (!out.success) { setSaveError(out.error ?? "Couldn't delete."); return; }
      router.push("/reports");
      router.refresh();
    });
  }

  // -- render ---------------------------------------------------------------

  const dims = result?.columns.filter((c) => c.kind !== "number") ?? [];
  const measures = result?.columns.filter((c) => c.kind === "number") ?? [];
  const chartable = mode === "summary" && measures.length > 0;

  return (
    <div className="space-y-4 p-section">
      <PageHeader
        eyebrow={<Link href="/reports" className="hover:text-foreground">Reports</Link>}
        title={copy && initial ? `Copy of ${initial.name}` : initial ? initial.name : "New report"}
        description={initial?.description ?? "Pick what to report on, shape it, and save it."}
        actions={
          <>
            {editing ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/reports/custom/${editing.id}/csv`} download>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden />
                  Download CSV
                </a>
              </Button>
            ) : null}
            {editing && canDelete ? (
              <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
                Delete report
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setSaving(true)} disabled={!ready}>
              {editing ? "Save changes" : "Save report"}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-3">
          <Surface title="Data" pad="tight">
            <div className="space-y-2">
              <Input
                type="search"
                value={objectQuery}
                onChange={(e) => setObjectQuery(e.target.value)}
                placeholder="Find a table"
                className="h-9"
              />
              <Labelled label="Table or view">
                <select value={spec.object} onChange={(e) => changeObject(e.target.value)} className={FIELD}>
                  <option value="">Choose…</option>
                  {shownObjects.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name} · {o.kind === "view" ? "view" : `${nf.format(o.rows)} rows`}
                    </option>
                  ))}
                </select>
              </Labelled>
              {object ? (
                <p className="text-meta text-muted-foreground">
                  {humanize(object.name)}: {object.columns.length} fields
                  {object.rows > 100000 ? " · large — filter before grouping" : ""}
                </p>
              ) : null}
            </div>
          </Surface>

          {object ? (
            <>
              <Surface
                title="Shape"
                pad="tight"
                actions={
                  <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[{ value: "rows", label: "Rows" }, { value: "summary", label: "Summary" }]}
                  />
                }
              >
                {mode === "rows" ? (
                  <div className="space-y-2">
                    <ul className="space-y-1">
                      {spec.columns.map((c, i) => (
                        <li key={encodeRef(c)} className="flex items-center gap-2">
                          <span className="flex-1 truncate text-body">{refLabel(c)}</span>
                          <RemoveButton
                            label={`Remove ${refLabel(c)}`}
                            onClick={() => patch({ columns: spec.columns.filter((_, j) => j !== i) })}
                          />
                        </li>
                      ))}
                    </ul>
                    <FieldSelect
                      object={object} byName={byName} value=""
                      onChange={addColumn} placeholder="+ Add a column"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="text-meta font-medium text-muted-foreground">Group by</div>
                      {spec.groups.map((g, i) => {
                        const kind = kindOf(g, object, byName);
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="flex-1 truncate text-body">{refLabel(g)}</span>
                            {kind === "date" || kind === "datetime" ? (
                              <select
                                value={g.bucket ?? ""}
                                onChange={(e) => patch({
                                  groups: spec.groups.map((x, j) =>
                                    j === i ? { ...x, bucket: (e.target.value || null) as Group["bucket"] } : x),
                                })}
                                className={`${FIELD} w-32`}
                              >
                                <option value="">exact date</option>
                                {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
                              </select>
                            ) : null}
                            <RemoveButton
                              label={`Remove ${refLabel(g)}`}
                              onClick={() => patch({ groups: spec.groups.filter((_, j) => j !== i) })}
                            />
                          </div>
                        );
                      })}
                      {spec.groups.length < 4 ? (
                        <FieldSelect
                          object={object} byName={byName} value=""
                          onChange={addGroup} placeholder="+ Add a group"
                          only={["text", "uuid", "date", "datetime", "boolean", "number"]}
                        />
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <div className="text-meta font-medium text-muted-foreground">Measures</div>
                      {spec.aggregates.map((a, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select
                            value={a.fn}
                            onChange={(e) => updateAggregate(i, { fn: e.target.value as Aggregate["fn"] })}
                            className={`${FIELD} w-40 shrink-0`}
                          >
                            {AGGREGATE_FNS.map((fn) => <option key={fn} value={fn}>{AGGREGATE_LABELS[fn]}</option>)}
                          </select>
                          {a.fn !== "count" ? (
                            <FieldSelect
                              object={object} byName={byName}
                              value={a.field ? encodeRef({ field: a.field, lookup: a.lookup }) : ""}
                              onChange={(v) => { const r = decodeRef(v); updateAggregate(i, { field: r.field, lookup: r.lookup ?? null }); }}
                              only={a.fn === "sum" || a.fn === "avg" ? ["number"] : undefined}
                            />
                          ) : <span className="flex-1" />}
                          <RemoveButton
                            label="Remove measure"
                            onClick={() => patch({ aggregates: spec.aggregates.filter((_, j) => j !== i) })}
                          />
                        </div>
                      ))}
                      {spec.aggregates.length < 8 ? (
                        <button
                          type="button"
                          onClick={() => patch({ aggregates: [...spec.aggregates, { fn: spec.aggregates.length ? "sum" : "count" }] })}
                          className="inline-flex items-center gap-1 text-body text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden /> Add a measure
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </Surface>

              <Surface
                title="Filters"
                pad="tight"
                actions={spec.filters.length > 1 ? (
                  <Segmented
                    value={spec.logic}
                    onChange={(logic) => patch({ logic })}
                    options={[{ value: "and", label: "All" }, { value: "or", label: "Any" }]}
                  />
                ) : null}
              >
                <div className="space-y-2">
                  {spec.filters.map((f, i) => {
                    const kind = (kindOf(f, object, byName) ?? "text") as Kind;
                    const ops = OPERATORS[kind];
                    const def = ops.find((o) => o.op === f.op) ?? ops[0];
                    const listId = `suggest-${i}`;
                    const suggest = suggestions[`${spec.object}:${encodeRef(f)}`];
                    const inputType = kind === "date" || kind === "datetime" ? "date" : kind === "number" ? "number" : "text";
                    return (
                      <div key={i} className="space-y-1 rounded-md bg-muted/50 p-2">
                        <div className="flex items-center gap-2">
                          <FieldSelect
                            object={object} byName={byName} value={encodeRef(f)}
                            onChange={(v) => { const r = decodeRef(v); updateFilter(i, { field: r.field, lookup: r.lookup ?? null }); }}
                          />
                          <RemoveButton
                            label="Remove filter"
                            onClick={() => patch({ filters: spec.filters.filter((_, j) => j !== i) })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={def.op}
                            onChange={(e) => updateFilter(i, { op: e.target.value, value: "" })}
                            className={`${FIELD} w-44 shrink-0`}
                          >
                            {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                          </select>
                          {def.value === "one" || def.value === "list" ? (
                            <>
                              <Input
                                type={def.value === "list" ? "text" : inputType}
                                value={f.value ?? ""}
                                onChange={(e) => updateFilter(i, { value: e.target.value })}
                                onFocus={() => suggestFor(f)}
                                placeholder={def.value === "list" ? "a, b, c" : "Value"}
                                list={suggest ? listId : undefined}
                                className="h-9"
                              />
                              {suggest ? (
                                <datalist id={listId}>
                                  {suggest.map((v) => <option key={v} value={v} />)}
                                </datalist>
                              ) : null}
                            </>
                          ) : def.value === "two" ? (
                            <Range kind={inputType} value={f.value ?? ""} onChange={(v) => updateFilter(i, { value: v })} />
                          ) : def.value === "days" ? (
                            <Input
                              type="number" min={1} max={9999}
                              value={f.value ?? ""}
                              onChange={(e) => updateFilter(i, { value: e.target.value })}
                              placeholder="Days"
                              className="h-9 w-24"
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {spec.filters.length < 20 ? (
                    <button
                      type="button"
                      onClick={addFilter}
                      className="inline-flex items-center gap-1 text-body text-muted-foreground transition-colors duration-fast ease-out hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Add a filter
                    </button>
                  ) : null}
                </div>
              </Surface>

              <Surface pad="tight">
                <Labelled label="At most">
                  <select
                    value={spec.limit}
                    onChange={(e) => patch({ limit: Number(e.target.value) })}
                    className={FIELD}
                  >
                    {LIMITS.map((n) => <option key={n} value={n}>{nf.format(n)} rows</option>)}
                  </select>
                </Labelled>
              </Surface>
            </>
          ) : null}
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="min-w-0 space-y-3">
          {!object ? (
            <Surface>
              <p className="text-body text-muted-foreground">
                Choose a table to start. Row security applies as it does everywhere
                in the app: a report shows what you may see, and nothing else.
              </p>
            </Surface>
          ) : null}

          {chartable ? (
            <Surface
              title="Chart"
              pad="tight"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={chart.type}
                    onChange={(e) => setChart({ ...chart, type: e.target.value as ChartType })}
                    className={`${FIELD} w-36`}
                  >
                    {CHART_TYPES.map((t) => <option key={t} value={t}>{CHART_LABELS[t]}</option>)}
                  </select>
                  {chart.type !== "table" && chart.type !== "stat" ? (
                    <select value={chart.x ?? ""} onChange={(e) => setChart({ ...chart, x: e.target.value || null })} className={`${FIELD} w-44`}>
                      {dims.map((c) => <option key={c.key} value={c.key}>Axis: {columnLabel(c)}</option>)}
                    </select>
                  ) : null}
                  {chart.type !== "table" ? (
                    <select value={chart.y ?? ""} onChange={(e) => setChart({ ...chart, y: e.target.value || null })} className={`${FIELD} w-44`}>
                      {measures.map((c) => <option key={c.key} value={c.key}>Measure: {columnLabel(c)}</option>)}
                    </select>
                  ) : null}
                  {(chart.type === "bar" || chart.type === "hbar" || chart.type === "line" || chart.type === "area") && dims.length > 1 ? (
                    <select value={chart.series ?? ""} onChange={(e) => setChart({ ...chart, series: e.target.value || null })} className={`${FIELD} w-44`}>
                      <option value="">No series</option>
                      {dims.filter((c) => c.key !== chart.x).map((c) => <option key={c.key} value={c.key}>Series: {columnLabel(c)}</option>)}
                    </select>
                  ) : null}
                  {chart.series && chart.type !== "line" && chart.type !== "donut" && chart.type !== "stat" ? (
                    <label className="inline-flex items-center gap-1.5 text-body">
                      <input type="checkbox" checked={Boolean(chart.stacked)} onChange={(e) => setChart({ ...chart, stacked: e.target.checked })} />
                      Stacked
                    </label>
                  ) : null}
                </div>
              }
            >
              {chart.type !== "table" && result ? <ReportChart chart={chart} result={result} /> : (
                <p className="text-meta text-muted-foreground">Pick a chart type to draw this summary.</p>
              )}
            </Surface>
          ) : null}

          {error ? <LoadFailed noun="rows" detail={error} /> : null}

          {result ? (
            <>
              <p className="text-meta text-muted-foreground" aria-live="polite">
                {running ? "Running… " : ""}
                {nf.format(result.total)} {mode === "summary" ? "groups" : "rows"}
                {result.truncated ? ` · showing the first ${nf.format(result.limit)}` : ""}
                {result.rows.length > 200 ? " · the first 200 are drawn below" : ""}
              </p>
              <ResultTable result={result} sort={spec.sort[0] ?? null} onSort={onSort} maxRows={200} />
            </>
          ) : object && ready && running ? (
            <p className="text-meta text-muted-foreground">Running…</p>
          ) : object && !ready ? (
            <Surface>
              <p className="text-body text-muted-foreground">
                {mode === "summary" ? "Add a group or a measure." : "Add at least one column."}
              </p>
            </Surface>
          ) : null}
        </div>
      </div>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Save changes" : "Save report"}</DialogTitle>
            <DialogDescription>
              A private report is yours alone. A shared one appears in everyone&apos;s
              library, and only you (or an administrator) can change it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Labelled label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Open pipeline by client" autoFocus />
            </Labelled>
            <Labelled label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What question this answers" />
            </Labelled>
            <label className="inline-flex items-center gap-2 text-body">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Share with everyone
            </label>
            {saveError ? <p className="text-body text-destructive">{saveError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaving(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {editing ? "Save changes" : "Save report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Two boxes that write "a,b", for between. */
function Range({ kind, value, onChange }: { kind: string; value: string; onChange: (v: string) => void }) {
  const [a, b] = value.split(",").map((s) => s.trim());
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Input type={kind} value={a ?? ""} onChange={(e) => onChange(`${e.target.value},${b ?? ""}`)} className="h-9" />
      <span className="text-meta text-muted-foreground">to</span>
      <Input type={kind} value={b ?? ""} onChange={(e) => onChange(`${a ?? ""},${e.target.value}`)} className="h-9" />
    </div>
  );
}
